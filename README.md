# Atlas — NoSQL GitHub Assistant (Project 19)

A local educational prototype combining **MongoDB**, **Apache Kafka**, **Elasticsearch**, **Neo4j**, **Express/Node.js**, and **React/Vite** to explore repository issues, documentation, and issue → PR → commit → release evidence.

> **Status:** Tested locally with demo data and a bounded public `expressjs/express` GitHub import. Designed as an educational proof of concept, **not** a production-grade GitHub security or compliance product.

## Architecture

```text
                         GitHub REST API (public repositories)
                                     |
                                     v
                           Bounded GitHub importer
                          /           |           \
                         v            v            v
                     MongoDB      Docs/notes    PR evidence importer
                  (source of       indexed       into Neo4j graph
                     truth)          |               |
                         |           v               v
               Transactional      Elasticsearch     Neo4j
               issue outbox          ^               ^
                         |           |               |
                         v           |               |
                    Kafka issue.events               |
                         |                           |
               +---------+-----------+               |
               |                     |               |
               v                     v               |
          Search consumer       Graph consumer -------+
               |                     |
               +---------------------+
                                     |
               React/Vite -> Express API
                   MongoDB / Elasticsearch / Neo4j
```

The issue outbox and Kafka consumers provide **eventual consistency**. The bounded importer writes comments and document search data directly to Elasticsearch; those writes are **not** atomic with MongoDB. Kafka consumers use at-least-once delivery, so downstream writes must tolerate replay.

## Features

- **Repository overview:** authoritative MongoDB issue counts and status.
- **Issue Explorer:** Elasticsearch full-text search with repository, status, and label filters.
- **Knowledge Search:** Elasticsearch documentation chunks with source document/revision/line metadata; line provenance is not independently verified.
- **Release Trace:** Neo4j issue → PR → merge commit graph. A release is shown as verified **only** with matching release-note PR URL **and** GitHub Compare ancestry evidence. Real partial paths remain visible with *Release not verified* labels.
- **Local login:** salted scrypt password hashes, memory-only React Bearer token, private-repository reader grants and revocation enforced by the backend.
- **Public GitHub import:** bounded snapshot of issues, issue comments, README and top-level Markdown docs, and release notes. Private GitHub ingestion is **not** implemented.

## Prerequisites

- Windows PowerShell (commands below), Node.js 22 or compatible and npm
- Docker Desktop with Docker Compose
- Working local `backend/.env` configuration (create from `backend/.env.example`)
- A root `.env` containing the Neo4j container password required by `compose.yaml`
- The MongoDB replica set configured and Kafka topic `issue.events` initialized for initial setup; existing local project machines already have these

**Never commit passwords, API tokens, `.env` files, or copied production data.** The exposed development write key from interactive testing must be rotated before sharing the project or deploying it.

## Run locally

From the project root:

```powershell
docker compose up -d
docker compose ps
```

Open four **separate terminals**, with `cd backend` in each:

| Terminal | Command | Function |
|---|---|---|
| 1 | `npm ci; npm test; npm run dev` | Backend API on port 5000 |
| 2 | `node src/workers/outbox-publisher.js` | MongoDB outbox → Kafka |
| 3 | `node src/workers/search-consumer.js` | Kafka → Elasticsearch |
| 4 | `node src/workers/graph-consumer.js` | Kafka → Neo4j |

Open another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Browse to **http://localhost:5173**. If port 5173 is already occupied, use `npm run dev -- --port 5174`.

API health check: `http://localhost:5000/api/health`.

## GitHub ingestion and graph tracing

From `backend`:

```powershell
npm run import:github -- expressjs/express
npm run verify:github -- expressjs/express
npm run import:traces -- expressjs/express
```

The GitHub importer is bounded by default (40 issue API entries, 60 comments, 10 releases, 8 top-level documentation files); this is **not the complete repository history**. For real tracing, only 30 recently updated closed pull requests are examined, and missing release evidence may result in zero complete paths.

See:

- `backend/docs/github-ingestion.md` — bounded importer and synchronization check
- `backend/docs/real-release-tracing.md` — evidence-backed partial and complete paths
- `backend/docs/repository-permissions.md` — user account and private reader permission demo
- `frontend/README.md` — dashboard workflows

## Verified project demonstration

Local testing to date confirmed:

| Feature | Evidence of behavior |
|---|---|
| Core services | MongoDB, Elasticsearch, Kafka, and Neo4j connected; Express health endpoint responding |
| Public import | 11 actual Express issues, 60 comments, 10 releases, 37 indexed chunks |
| Synchronization | 11 published issue events; 11 corresponding Elasticsearch issues and Neo4j issue nodes/relationships |
| UI overview | Real Express repository showed 11 tracked issues (9 open, 2 closed) |
| Issue Explorer | Keyword `directory` matched Express issue #7592 |
| Knowledge Search | Retrieved technical text and displayed document ID, revision and line-range metadata |
| Graph relationships | Real issues #7562 → PR #7563 and #7564 → PR #7565, each linked to a merge commit |
| Release evidence | No verified real release links in bounded imported sample; dashboard correctly marks them unverified |
| Login and permissions | React login, authorized private issue read, private access revocation, and anonymous sign-out checks passed |

The UI's demonstration Issue #42 additionally shows a **synthetic** complete PR→commit→release path. Do not present that synthetic path as imported GitHub evidence.

## Limitations / next improvements

- No GitHub OAuth and no secure private GitHub repository ingestion.
- Prototype development-key administration is not production-safe; credentials and databases require network isolation, HTTPS, audit logs and security review.
- GitHub importer is a bounded snapshot, not a webhook stream, and the PR trace importer does not reconcile stale links after upstream edits.
- Issue data is eventually consistent across stores; Kafka outbox at-least-once semantics do not mean atomic transactions across all four systems.
- Citation line references and release evidence should be rechecked against source content before consequential use.
- Unit tests and manual smoke tests demonstrate the prototype, not security correctness in an adversarial production environment.

## Development workflow

`main` is preserved while this release candidate is reviewed. The consolidated candidate includes the dashboard, real public GitHub importer, authenticated reader access, partial real release tracing, and frontend login. Before merging to `main`, check all CI jobs and test this combined branch locally.
