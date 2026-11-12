"use strict";

const { parseRepository, githubRepoPath } = require("./github-api");
const {
  extractClosingIssueNumbers,
  releaseMentionsPull,
  compareConfirmsAncestry,
  isFullCommitSha,
  validReleaseTag,
} = require("./trace-evidence");

const MAX_PULL_REQUESTS = 30;
const MAX_COMPARE_CHECKS = 40;

async function createConstraints(session) {
  for (const query of [
    "CREATE CONSTRAINT github_pr_id_unique IF NOT EXISTS FOR (p:PullRequest) REQUIRE p.id IS UNIQUE",
    "CREATE CONSTRAINT github_commit_id_unique IF NOT EXISTS FOR (c:Commit) REQUIRE c.id IS UNIQUE",
    "CREATE CONSTRAINT github_release_id_unique IF NOT EXISTS FOR (r:Release) REQUIRE r.id IS UNIQUE",
  ]) {
    await session.run(query);
  }
}

async function importRealReleaseTrace({
  db, session, github, repository, logger = console,
  maxPullRequests = MAX_PULL_REQUESTS,
}) {
  if (!Number.isSafeInteger(maxPullRequests) || maxPullRequests < 1 || maxPullRequests > MAX_PULL_REQUESTS) {
    throw new Error("maxPullRequests must be between 1 and " + MAX_PULL_REQUESTS);
  }

  const parsed = parseRepository(repository);
  const metadata = await github.request(githubRepoPath(parsed));
  if (metadata.private || metadata.visibility === "private") {
    throw new Error("Only public GitHub repositories can be imported.");
  }
  if (!Number.isSafeInteger(metadata.id)) {
    throw new Error("Missing public GitHub repository ID.");
  }

  const repoId = "gh:" + metadata.id;
  const recorded = await db.collection("repositories").findOne({
    _id: repoId, visibility: "public", source: "github",
  });
  if (!recorded) {
    throw new Error("First run npm run import:github -- " + parsed.fullName);
  }
  const releases = await db.collection("releases").find({
    repository_id: repoId, source: "github",
  }).limit(20).toArray();

  await createConstraints(session);
  const allPulls = await github.list(githubRepoPath(parsed) + "/pulls", {
    max: maxPullRequests,
    query: { state: "closed", sort: "updated", direction: "desc" },
  });

  const report = {
    repository_id: repoId, repository: parsed.fullName,
    pull_requests_examined: allPulls.length,
    merged_pull_requests: 0,
    graph_pull_requests: 0,
    imported_issue_links: 0,
    release_edges_verified: 0,
    compare_checks: 0,
    release_notes_matches: 0,
  };

  for (const pull of allPulls) {
    if (!pull.merged_at || !Number.isSafeInteger(pull.number) ||
        !isFullCommitSha(pull.merge_commit_sha)) continue;
    report.merged_pull_requests++;

    const prId = repoId + ":pr:" + pull.number;
    const commitId = repoId + ":commit:" + pull.merge_commit_sha;
    const closingNumbers = extractClosingIssueNumbers(pull.body || "", parsed.fullName);
    const linkedIssues = await db.collection("issues").find({
      repository_id: repoId,
      number: { $in: closingNumbers },
      source: "github",
    }).project({ _id: 1, number: 1 }).toArray();

    const matchingReleases = [];
    for (const release of releases) {
      if (!validReleaseTag(release.tag)) continue;
      if (!releaseMentionsPull(release.body, parsed.fullName, pull.number)) continue;
      report.release_notes_matches++;
      if (report.compare_checks >= MAX_COMPARE_CHECKS) {
        throw new Error("Maximum GitHub compare checks reached. Try a smaller import batch.");
      }
      report.compare_checks++;
      let ancestry;
      try {
        ancestry = await github.request(
          githubRepoPath(parsed) +
          "/compare/" + pull.merge_commit_sha + "..." +
          encodeURIComponent(release.tag)
        );
      } catch (error) {
        // A missing GitHub comparison is inconclusive, not a license to
        // guess. API authentication/rate-limit failures remain fatal.
        if (/GitHub API HTTP (404|422)(?:\b|:)/.test(error.message)) {
          logger.warn("Could not verify ancestry for PR #" + pull.number + " and " + release.tag);
          continue;
        }
        throw error;
      }
      if (compareConfirmsAncestry(ancestry)) matchingReleases.push(release);
    }

    await db.collection("pull_requests").updateOne(
      { _id: prId },
      {
        $set: {
          repository_id: repoId,
          number: pull.number,
          title: pull.title || "",
          body: pull.body || "",
          source_url: pull.html_url,
          merge_commit_sha: pull.merge_commit_sha,
          merged_at: new Date(pull.merged_at),
          evidence_issue_numbers: closingNumbers,
          evidence_release_ids: matchingReleases.map(release => release._id),
          source: "github",
          imported_at: new Date(),
        },
      },
      { upsert: true }
    );

    await session.executeWrite(async (tx) => {
      await tx.run(
        [
          "MERGE (repo:Repository {id: $repoId})",
          "SET repo.name = $repoName",
          "MERGE (pr:PullRequest {id: $prId})",
          "SET pr.number = $number, pr.title = $title,",
          "    pr.repository_id = $repoId, pr.source_url = $url",
          "MERGE (c:Commit {id: $commitId})",
          "SET c.sha = $sha, c.repository_id = $repoId,",
          "    c.message = $message",
          "MERGE (pr)-[:INCLUDES]->(c)",
          "RETURN pr.id AS id",
        ].join("\n"),
        {
          repoId, repoName: recorded.name,
          prId, number: pull.number, title: pull.title || "", url: pull.html_url,
          commitId, sha: pull.merge_commit_sha,
          message: "Merge commit for PR #" + pull.number,
        }
      );

      for (const issue of linkedIssues) {
        const result = await tx.run(
          [
            "MATCH (i:Issue {id: $issueId, repository_id: $repoId})",
            "MATCH (pr:PullRequest {id: $prId})",
            "MERGE (i)-[rel:FIXED_BY]->(pr)",
            "SET rel.evidence = 'merged_pr_closing_reference',",
            "    rel.source_url = $prUrl",
            "RETURN i.id AS id",
          ].join("\n"),
          { repoId, prId, issueId: issue._id, prUrl: pull.html_url }
        );
        if (result.records.length > 0) report.imported_issue_links++;
      }

      for (const release of matchingReleases) {
        await tx.run(
          [
            "MATCH (c:Commit {id: $commitId})",
            "MERGE (r:Release {id: $releaseId})",
            "SET r.tag = $tag, r.repository_id = $repoId,",
            "    r.source_url = $url",
            "MERGE (c)-[rel:INCLUDED_IN]->(r)",
            "SET rel.evidence = 'release_notes_and_github_compare'",
            "RETURN r.id AS id",
          ].join("\n"),
          {
            commitId, releaseId: release._id, tag: release.tag,
            repoId, url: release.source_url || "",
          }
        );
        report.release_edges_verified++;
      }
    });

    report.graph_pull_requests++;
  }

  logger.log("Evidence-based trace import completed:", report);
  return report;
}

module.exports = { importRealReleaseTrace, MAX_PULL_REQUESTS };
