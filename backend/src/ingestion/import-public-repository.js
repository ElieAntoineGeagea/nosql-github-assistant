"use strict";

const { randomUUID } = require("node:crypto");
const { parseRepository, githubRepoPath } = require("./github-api");
const { chunkMarkdown, stableId } = require("./chunk-markdown");

const DEFAULT_LIMITS = Object.freeze({
  issues: 40,
  comments: 60,
  releases: 10,
  documents: 8,
});

function isoDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

async function ensureIndexes(db, elasticsearch) {
  await db.collection("issues").createIndex(
    { repository_id: 1, number: 1 }, { unique: true }
  );
  await db.collection("documents").createIndex(
    { repository_id: 1, path: 1 }, { unique: true }
  );

  if (!(await elasticsearch.indices.exists({ index: "knowledge_chunks" }))) {
    await elasticsearch.indices.create({
      index: "knowledge_chunks",
      mappings: {
        properties: {
          repository_id: { type: "keyword" },
          document_id: { type: "keyword" },
          title: { type: "text" },
          section: { type: "text" },
          content: { type: "text" },
          revision: { type: "integer" },
          source_revision: { type: "keyword" },
          source_url: { type: "keyword" },
          release_ids: { type: "keyword" },
          chunk_index: { type: "integer" },
          start_line: { type: "integer" },
          end_line: { type: "integer" },
          is_current: { type: "boolean" },
        },
      },
    });
  }

  if (!(await elasticsearch.indices.exists({ index: "issue_activity" }))) {
    await elasticsearch.indices.create({
      index: "issue_activity",
      mappings: {
        properties: {
          record_id: { type: "keyword" },
          record_type: { type: "keyword" },
          repository_id: { type: "keyword" },
          number: { type: "integer" },
          title: { type: "text" },
          body: { type: "text" },
          content: { type: "text" },
          status: { type: "keyword" },
          labels: { type: "keyword" },
          source_version: { type: "integer" },
          created_at: { type: "date" },
          updated_at: { type: "date" },
        },
      },
    });
  }
}

async function saveIssue({ db, client, repoId, raw }) {
  if (raw.pull_request || !Number.isSafeInteger(raw.number)) return "skipped";
  const issueId = repoId + ":issue:" + raw.number;
  const issueStatus = raw.state === "closed" ? "closed" : "open";
  const labels = (raw.labels || []).map(x => x.name).filter(Boolean);
  const session = client.startSession();
  let outcome = "unchanged";

  try {
    await session.withTransaction(async () => {
      const existing = await db.collection("issues").findOne(
        { _id: issueId }, { session }
      );
      const same = existing &&
        existing.github_updated_at === raw.updated_at &&
        existing.title === raw.title &&
        existing.body === (raw.body || "") &&
        existing.status === issueStatus &&
        JSON.stringify(existing.labels || []) === JSON.stringify(labels);

      if (same) return;

      const version = (existing?.current_revision || 0) + 1;
      const now = new Date();
      const changes = {
        repository_id: repoId,
        number: raw.number,
        title: raw.title || "(Untitled issue)",
        body: raw.body || "",
        status: issueStatus,
        labels,
        author_id: raw.user?.login || "unknown",
        current_revision: version,
        created_at: isoDate(raw.created_at),
        updated_at: isoDate(raw.updated_at),
        github_updated_at: raw.updated_at,
        source_url: raw.html_url,
        source: "github",
      };
      await db.collection("issues").updateOne(
        { _id: issueId },
        { $set: changes },
        { session, upsert: true }
      );

      let eventType = "issue.opened";
      if (existing) {
        eventType = existing.status !== issueStatus
          ? (issueStatus === "closed" ? "issue.closed" : "issue.reopened")
          : "issue.updated";
      }

      const eventId = "evt_" + randomUUID();
      await db.collection("outbox_events").insertOne({
        _id: eventId,
        topic: "issue.events",
        event_key: repoId,
        event_type: eventType,
        aggregate_id: issueId,
        aggregate_version: version,
        status: "pending",
        attempts: 0,
        created_at: now,
        published_at: null,
        payload: {
          event_id: eventId,
          event_type: eventType,
          repository_id: repoId,
          issue_id: issueId,
          issue_number: raw.number,
          entity_version: version,
          occurred_at: now.toISOString(),
          source: "github_import",
        },
      }, { session });
      outcome = existing ? "updated" : "created";
    });
  } finally {
    await session.endSession();
  }
  return outcome;
}

async function saveDocument({ db, elasticsearch, repositoryId, id, path, title,
  content, revision, sourceUrl, releaseIds = [] }) {
  if (!content || typeof content !== "string") return 0;
  const chunks = chunkMarkdown(content.slice(0, 300000));
  const now = new Date();

  // Existing knowledge_chunks records use a numeric revision.
  // Keep that schema while retaining GitHub's SHA/identifier separately.
  const documents = db.collection("documents");
  const existing = await documents.findOne({ _id: id });
  const documentRevision = existing?.source_revision === String(revision)
    ? (existing.revision || 1)
    : (existing?.revision || 0) + 1;

  await documents.updateOne(
    { _id: id },
    {
      $set: {
        repository_id: repositoryId,
        path, title, content: content.slice(0, 300000),
        revision: documentRevision,
        source_revision: String(revision),
        source_url: sourceUrl, release_ids: releaseIds,
        is_current: true, updated_at: now,
      },
    },
    { upsert: true }
  );

  const operations = [];
  for (const chunk of chunks) {
    operations.push({ index: {
      _index: "knowledge_chunks",
      _id: "chunk_" + stableId(id, String(chunk.chunk_index)),
    } });
    operations.push({
      repository_id: repositoryId,
      document_id: id,
      title,
      section: path,
      content: chunk.content,
      revision: documentRevision,
      source_revision: String(revision),
      source_url: sourceUrl,
      release_ids: releaseIds,
      is_current: true,
      ...chunk,
    });
  }

  if (operations.length) {
    const result = await elasticsearch.bulk({ operations, refresh: "wait_for" });
    if (result.errors) throw new Error("Elasticsearch failed to index one or more document chunks.");
  }

  // Remove chunks that belonged to an older, longer revision of this document.
  await elasticsearch.deleteByQuery({
    index: "knowledge_chunks",
    conflicts: "proceed",
    refresh: true,
    query: {
      bool: {
        filter: [
          { term: { repository_id: repositoryId } },
          { term: { document_id: id } },
          { range: { chunk_index: { gte: chunks.length } } },
        ],
      },
    },
  });
  return chunks.length;
}

async function saveComment({ db, elasticsearch, repositoryId, raw }) {
  const match = /\/issues\/(\d+)$/.exec(raw.issue_url || "");
  if (!match || !raw.id) return false;
  const id = repositoryId + ":comment:" + raw.id;
  const record = {
    _id: id,
    repository_id: repositoryId,
    issue_number: Number(match[1]),
    author_id: raw.user?.login || "unknown",
    body: raw.body || "",
    source_url: raw.html_url,
    source: "github",
    created_at: isoDate(raw.created_at),
    updated_at: isoDate(raw.updated_at),
  };
  await db.collection("discussions").updateOne(
    { _id: id }, { $set: record }, { upsert: true }
  );
  await elasticsearch.index({
    index: "issue_activity",
    id,
    refresh: "wait_for",
    document: {
      record_id: id,
      record_type: "comment",
      repository_id: repositoryId,
      number: record.issue_number,
      title: "Comment on issue #" + record.issue_number,
      body: record.body,
      content: record.body,
      status: "published",
      labels: [],
      source_version: 1,
      created_at: record.created_at,
      updated_at: record.updated_at,
      source_url: record.source_url,
    },
  });
  return true;
}

function decodeGithubContent(item) {
  if (!item || item.encoding !== "base64" || typeof item.content !== "string") {
    throw new Error("Expected base64-encoded GitHub file content.");
  }
  if (item.size > 300000) return "";
  return Buffer.from(item.content.replace(/\s/g, ""), "base64").toString("utf8");
}

async function importPublicRepository({
  db, client, elasticsearch, github, repository, limits = DEFAULT_LIMITS,
  logger = console,
}) {
  const parsed = parseRepository(repository);
  const base = githubRepoPath(parsed);
  const metadata = await github.request(base);

  // This importer has no identity-based authorization model. Public only.
  if (metadata.private || metadata.visibility === "private") {
    throw new Error("Private repositories are not supported by this importer.");
  }
  if (!Number.isSafeInteger(metadata.id) || !metadata.owner?.login) {
    throw new Error("GitHub returned incomplete repository metadata.");
  }

  const repoId = "gh:" + metadata.id;
  const now = new Date();
  await ensureIndexes(db, elasticsearch);
  await db.collection("repositories").updateOne(
    { _id: repoId },
    {
      $set: {
        name: metadata.name,
        full_name: metadata.full_name,
        organization_id: metadata.owner.login,
        visibility: "public",
        default_branch: metadata.default_branch || "main",
        description: metadata.description || "",
        github_id: metadata.id,
        source_url: metadata.html_url,
        source: "github",
        imported_at: now,
      },
      $setOnInsert: { created_at: isoDate(metadata.created_at) },
    },
    { upsert: true }
  );

  const summary = {
    repository_id: repoId, full_name: metadata.full_name,
    issues_created: 0, issues_updated: 0,
    comments_imported: 0, releases_imported: 0, documents_imported: 0,
    chunks_indexed: 0,
  };

  logger.log("Importing public repository:", metadata.full_name);

  // GitHub's /issues endpoint also returns pull requests, which we exclude.
  const issues = await github.list(base + "/issues", {
    max: limits.issues,
    query: { state: "all", sort: "updated", direction: "desc" },
  });
  for (const item of issues) {
    const outcome = await saveIssue({ db, client, repoId, raw: item });
    if (outcome === "created") summary.issues_created++;
    if (outcome === "updated") summary.issues_updated++;
  }

  const comments = await github.list(base + "/issues/comments", {
    max: limits.comments,
    query: { sort: "updated", direction: "desc" },
  });
  for (const item of comments) {
    if (await saveComment({ db, elasticsearch, repositoryId: repoId, raw: item })) {
      summary.comments_imported++;
    }
  }

  const releases = await github.list(base + "/releases", { max: limits.releases });
  for (const item of releases) {
    const releaseId = repoId + ":release:" + item.id;
    await db.collection("releases").updateOne(
      { _id: releaseId },
      { $set: {
        repository_id: repoId, tag: item.tag_name,
        title: item.name || item.tag_name,
        body: item.body || "", source_url: item.html_url,
        published_at: isoDate(item.published_at || item.created_at),
        target_commitish: item.target_commitish,
        source: "github",
      } },
      { upsert: true }
    );
    summary.releases_imported++;
    summary.chunks_indexed += await saveDocument({
      db, elasticsearch, repositoryId: repoId,
      id: releaseId + ":notes",
      path: "releases/" + item.tag_name,
      title: item.name || "Release " + item.tag_name,
      content: item.body || "",
      revision: String(item.id),
      sourceUrl: item.html_url,
      releaseIds: [releaseId],
    });
  }

  // Import README.md and a bounded set of top-level docs/*.md files.
  let readme = null;
  try { readme = await github.request(base + "/readme"); }
  catch (error) { if (!/HTTP 404/.test(error.message)) throw error; }
  if (readme) {
    const content = decodeGithubContent(readme);
    if (content) {
      summary.documents_imported++;
      summary.chunks_indexed += await saveDocument({
        db, elasticsearch, repositoryId: repoId,
        id: repoId + ":doc:" + readme.path,
        path: readme.path,
        title: readme.name,
        content,
        revision: readme.sha,
        sourceUrl: readme.html_url,
      });
    }
  }

  let docs = [];
  try {
    const result = await github.request(base + "/contents/docs", {
      ref: metadata.default_branch || "main",
    });
    if (Array.isArray(result)) docs = result;
  } catch (error) {
    if (!/HTTP 404/.test(error.message)) throw error;
  }

  const markdownFiles = docs.filter(item =>
    item.type === "file" &&
    /\.mdx?$/i.test(item.name) &&
    item.size <= 300000
  ).slice(0, limits.documents);

  for (const file of markdownFiles) {
    const encoded = file.path.split("/").map(encodeURIComponent).join("/");
    const item = await github.request(base + "/contents/" + encoded, {
      ref: metadata.default_branch || "main",
    });
    const content = decodeGithubContent(item);
    if (!content) continue;
    summary.documents_imported++;
    summary.chunks_indexed += await saveDocument({
      db, elasticsearch, repositoryId: repoId,
      id: repoId + ":doc:" + item.path,
      path: item.path, title: item.name,
      content, revision: item.sha, sourceUrl: item.html_url,
    });
  }

  logger.log("Import completed:", summary);
  return summary;
}

module.exports = {
  DEFAULT_LIMITS,
  importPublicRepository,
  decodeGithubContent,
  saveDocument,
};
