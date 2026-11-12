# Atlas — NoSQL GitHub Assistant dashboard

A responsive React/Vite frontend for the existing NoSQL Project 19 backend. The interface is intentionally **read-only** while user authentication and private repository access are being built. Never expose a backend development key in browser code.

## Start on Windows

Keep Docker Compose, the Express backend, and the Kafka workers running. Open a new PowerShell terminal in the project folder:

```powershell
cd frontend
npm install
npm run dev
```

Visit http://localhost:5173. Vite automatically proxies /api requests to http://127.0.0.1:5000.

To build: `npm run build`.

## Included views

- Repository overview and issue counts (MongoDB)
- Issue keyword, status and label filtering (Elasticsearch)
- Documentation keyword/release search with section and revision citations (Elasticsearch)
- Issue -> PR -> commit -> release trace, where graph data exists (Neo4j)

## Backend requirements

- GET /api/repositories
- GET /api/issues?repository_id=repo_1
- GET /api/issues/search?repository_id=repo_1&q=database&status=open&label=bug
- GET /api/search?repository_id=repo_1&q=authentication
- GET /api/issues/issue_42/trace

All listed endpoints already exist in the backend. The frontend does not present private-repository authentication, live health monitoring of individual services, or trusted source-line verification as finished functionality.
