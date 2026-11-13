# Atlas — NoSQL GitHub Assistant dashboard

A responsive React/Vite frontend for the NoSQL Project 19 backend. Supports anonymous public data and optional authenticated private-repository reads.

## Start on Windows

Keep Docker Compose, Express backend and Kafka workers running. In a separate PowerShell terminal:

```powershell
cd frontend
npm install
npm run dev
```

Visit http://localhost:5173. Vite proxies `/api` to http://127.0.0.1:5000. Run `npm run build` for a production build.

## Included views

- Repository overview and issue counts (MongoDB)
- Issue keyword, status and label filters (Elasticsearch)
- Documentation/release search with reference metadata (Elasticsearch)
- Issue -> PR -> merge commit -> possibly verified release (Neo4j)
- Sign in / Sign out using existing backend local accounts
- Repository chooser displays only public repositories and private ones granted to the signed-in user

## Local account and private repository demo

The user `demo_reader_1` was created and tested via backend routes. Its private repository reader grant was **revoked** during security verification. To test the frontend private repository flow, grant the user reader access again through the backend's `/api/admin/permissions` development-key-protected API. Instructions are in `backend/docs/repository-permissions.md`.

Click **Sign in**, enter the username and its existing password, and verify the signed-in status. Once the reader grant is restored, the private demo repository should appear. Click **Sign out** to remove it immediately from the dashboard.

Do not enter the `DEMO_WRITE_KEY` into the React sign-in form, and do not commit passwords, API tokens or `.env` files.

## Security choices

- The Bearer token is stored only in React component memory and passed in the `Authorization` header for API requests. It is never stored in localStorage or a cookie.
- Refreshing or closing the page removes the browser's copy. The backend session remains valid until expiration or logout, but an inaccessible raw token cannot be recovered by the interface.
- Sign out clears loaded private data immediately, then asks the backend to invalidate the session. If the network logout fails, users should understand the server session may remain valid until expiration.
- This prototype does not provide GitHub OAuth, password reset, private GitHub import, or production-grade security protections such as HTTPS and network isolation of the underlying databases.
- API permission checks are authoritative. Hiding private content in React is for presentation only.

## Backend endpoints

- `POST /api/auth/login` with username/password
- `POST /api/auth/logout` with Bearer token
- `GET /api/auth/me` for session verification
- `GET /api/repositories` with optional token
- `GET /api/issues?repository_id=...`
- `GET /api/issues/search?repository_id=...&q=...`
- `GET /api/search?repository_id=...&q=...`
- `GET /api/issues/<issue-id>/trace`

## Limitations

This is still an educational proof of concept: search indexes are eventually consistent, citation line references are not all independently verified, and private repository data must be provisioned in MongoDB by an admin. The local login form is read-only; it does not register users.
