# Evidence-based GitHub release tracing

This is a limited importer for real **public** GitHub repositories. It complements the existing MongoDB + Kafka issue importer by building Neo4j paths for **verified** issue -> pull request -> merged commit -> release relationships.

It intentionally does not guess links based on dates, branch names, issue numbers in ordinary prose, or similar titles.

## Requirements

1. Docker containers for MongoDB and Neo4j must be running.
2. First run `npm run import:github -- owner/repo`. Keep the outbox publisher and Neo4j graph consumer running until the imported issue nodes have been synchronized.
3. Optionally set `GITHUB_TOKEN` in `backend/.env` for better GitHub API rate limits. Never commit this token.

Then, from the backend directory:

```powershell
npm run import:traces -- expressjs/express
```

The command imports at most 30 recently updated closed pull requests, skipping unmerged ones. It uses the release metadata already imported into MongoDB (up to 20 indexed release records are considered) and caps GitHub compare requests at 40.

## Which edges are created?

- `(Issue)-[:FIXED_BY]->(PullRequest)` only when a **merged PR body** explicitly says `Fixes #123`, `Closes #123`, `Resolves #123` or names the same repository, and that referenced issue is already imported in MongoDB and present in Neo4j.
- `(PullRequest)-[:INCLUDES]->(Commit)` links to the GitHub **merge_commit_sha** (the merged PR result), not the entire set of original branch commits. The commit is identified by its full 40-character SHA.
- `(Commit)-[:INCLUDED_IN]->(Release)` only when **both** the release notes link to the PR's GitHub `/pull/<number>` URL **and** the GitHub Compare API confirms the merge commit is an ancestor of the release tag.

These restrictions avoid inventing relationships, but mean many real repositories will produce zero complete issue-to-release paths.

`PR #123` or an arbitrary `#123` in release notes is **not** sufficient evidence. Missing compare results also do not prove release inclusion. GitHub HTTP 404/422 comparisons are treated as inconclusive and skipped; GitHub API rate-limit or auth errors stop the import with a clear error.

## Data and reruns

- MongoDB `pull_requests` stores snapshots and the issue/release evidence IDs for audit.
- Neo4j uses `MERGE` with stable IDs so repeated runs don't add duplicate nodes/relationships.
- No private repositories are imported.
- The importer does not replace existing demo Issue #42. That path remains the reliable demonstration of the dashboard interface.
- This importer is a snapshot, not a webhook-based continuous synchronization. It doesn't delete stale evidence when a PR body or release notes change. Before production use, add reconciliation/deletion logic, more granular review of evidence, and release-tag mutation handling.
- A partially completed batch may remain if GitHub fails; rerun safely once the error is resolved.

## Validate

Automated checks: `npm test` includes source-evidence unit tests. To query locally for real graph paths, choose an imported issue ID such as `gh:237159:issue:<number>` and use the existing `GET /api/issues/:id/trace` endpoint.

A zero-path result is **not a failure of the API**. It means no complete, evidence-supported trace is available in this bounded import window. Increase coverage with a planned deeper importer or use demo Issue #42 for a complete trace presentation.

## Limitations

- This is evidence-backed **merge commit inclusion**, not a complete release bill of materials.
- GitHub pull-request closure text is developer-provided; verify it before making consequential claims.
- Historical tags, retags, deletion and force pushes require a fuller audit trail and reconciliation.
- Some pull requests are squash/rebase merges; GitHub provides the merge commit SHA, but it may not exist in every release's ancestry.
- The endpoint only displays paths for imported issues, not all issue/PR activity on GitHub.
