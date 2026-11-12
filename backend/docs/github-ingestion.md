# Public GitHub data ingestion (prototype)

This feature imports real **public** GitHub repository content for the NoSQL Project 19 prototype. It is intentionally bounded to avoid excessive GitHub requests, large imports or accidental private-data exposure.

## What it imports

| Source | MongoDB collection | Search/stream target |
|---|---|---|
| Repository metadata | `repositories` | Used for repository access checks |
| Issue snapshots | `issues` | Transactional `outbox_events` → Kafka → existing search/graph consumers |
| Issue comments | `discussions` | Elasticsearch `issue_activity` |
| Release metadata | `releases` | Release bodies also indexed as documentation |
| README and top-level `docs/*.md` / `*.mdx` | `documents` | Elasticsearch `knowledge_chunks`, with document/revision/line-range metadata |

Data import currently handles up to 40 GitHub issue API entries (GitHub also lists PRs here, which we skip), 60 comments, 10 releases and 8 Markdown documents per invocation.

**Not yet implemented:** actual pull-request review ingestion, code/commit/release relationship derivation, GitHub webhooks for continuous updates, private repository authentication/authorization, comprehensive history of old document revisions, source-line citation validation against current GitHub content, automatic replay/rebuild of all derived indexes. The live prototype supports these only where separately implemented.

## Prerequisites

Start Docker Compose services (MongoDB replica set, Elasticsearch, Kafka and Neo4j) as already configured. Ensure the backend `.env` has working `MONGODB_URI`, `MONGODB_DATABASE`, and `ELASTICSEARCH_URL` settings.

Optional: Add `GITHUB_TOKEN=...` **only to `backend/.env`** to increase GitHub's API rate limit. Never commit tokens. No GitHub token is required for light imports from public repositories.

## Usage

From the `backend` directory:

```powershell
npm run import:github -- octocat/Hello-World
```

Use a public repository with issues, releases and Markdown documentation to demonstrate more features. For example, a repository with no issues won't produce issue events.

The importer is safe to rerun: stable MongoDB document IDs prevent duplicate source records and issues that have not changed do not create new outbox events. Source revisions are tracked through GitHub issue update timestamps and GitHub file SHA. Re-running will reindex documentation and comments.

Keep the existing automatic outbox publisher, Elasticsearch consumer, and Neo4j consumer running to propagate issue events.

Verify the imported public repository with:

```text
GET http://localhost:5000/api/repositories
GET http://localhost:5000/api/issues?repository_id=gh:<numeric_repo_id>
GET http://localhost:5000/api/issues/search?repository_id=gh:<numeric_repo_id>&q=bug
GET http://localhost:5000/api/search?repository_id=gh:<numeric_repo_id>&q=setup
```

The importer runs on the user's computer, not inside GitHub. A successful code commit alone does not import any data.

## Safety and consistency

- Only public GitHub repositories are accepted. This does **not** provide secure private-repository access.
- Source GitHub issue snapshots are stored in MongoDB with transactional outbox entries for changed issues.
- Kafka events are published separately by the already-running publisher (at-least-once delivery).
- Comments and documentation currently index directly into Elasticsearch: this is a prototype snapshot-import path, not an atomic cross-database transaction.
- A failed import can leave a partial import; rerun it after resolving the error.
- Search results are eventually consistent; do not use historical content as current security advice without verifying the source revision.
- The public repository check in the backend is separate from any future authentication and user-specific permissions.

## Verify end-to-end synchronization

After the import, with your local outbox publisher and both Kafka consumers running, run:

```powershell
npm run verify:github -- expressjs/express
```

This compares MongoDB imported issue/comment/document counts with outbox status, Elasticsearch indexed issue/comment/chunk counts, and Neo4j issue nodes/relationships. It reports success only when the imported issues have been synchronized. This is a count-and-state verification, not a proof of exactly-once delivery or full consistency for every property.

If the check reports **NOT FULLY SYNCHRONIZED**, keep the workers running and inspect their logs. The check is read-only, and may safely be repeated. It does not start the background workers itself.
