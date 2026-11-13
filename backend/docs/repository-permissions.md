# Repository permissions — local prototype

This module adds password-based accounts, short-lived Bearer sessions, and read permissions for private repositories. It is a **local educational prototype**, not a production identity service.

## Security model

- Public repositories can be viewed anonymously.
- Private repositories require a current session and an explicit `reader` permission for that user/repository.
- Permission membership is checked against MongoDB on every protected request and again after Elasticsearch/Neo4j calls. Removing a membership prevents subsequent reads even if the search index is still populated.
- Passwords use Node.js `scrypt` with per-password random salts; plaintext passwords are not stored.
- Session tokens are randomly generated and their SHA-256 hashes are stored in `user_sessions`; tokens expire after 12 hours and can be invalidated by logout.
- Local demo-key-protected admin routes allow creating accounts and managing memberships **only when `NODE_ENV` is not `production`**.
- Revocation is stored transactionally with an `access.revoked` outbox event so systems can react later; current Kafka consumers ignore this new event type. The backend nevertheless enforces the removal on its next permission check.

## API routes

| Method | Endpoint | Authentication | Purpose |
|---|---|---|---|
| POST | `/api/auth/users` | Development key | Create a demo user |
| POST | `/api/auth/login` | Username/password | Issue a 12-hour Bearer token |
| GET | `/api/auth/me` | Bearer session | View current username |
| POST | `/api/auth/logout` | Bearer session | Invalidate session |
| PUT | `/api/admin/permissions` | Development key | Grant private repository reader membership |
| DELETE | `/api/admin/permissions` | Development key | Revoke membership and publish `access.revoked` via outbox |

Existing `GET /api/repositories`, `GET /api/issues`, `GET /api/issues/search`, `GET /api/search`, and `GET /api/issues/:id/trace` now check repository access. The new read-access policy does **not** authorize writing to private repositories.

## Local test (PowerShell)

Run from the branch's backend directory with your existing `.env`. Restart the Express backend from the new branch before testing. Do not run two servers on port 5000.

Enter your local `DEMO_WRITE_KEY` securely and create a user with a password you choose:

```powershell
$secureKey = Read-Host "Enter DEMO_WRITE_KEY" -AsSecureString
$key = [System.Net.NetworkCredential]::new("", $secureKey).Password
$securePassword = Read-Host "Choose a test password (12+ characters)" -AsSecureString
$password = [System.Net.NetworkCredential]::new("", $securePassword).Password

$newUser = Invoke-RestMethod -Method Post -Uri "http://localhost:5000/api/auth/users" -ContentType "application/json" -Headers @{ "x-demo-write-key" = $key } -Body (@{ username="demo_reader_1"; password=$password } | ConvertTo-Json)
$newUser.user

$login = Invoke-RestMethod -Method Post -Uri "http://localhost:5000/api/auth/login" -ContentType "application/json" -Body (@{ username="demo_reader_1"; password=$password } | ConvertTo-Json)
$token = $login.token
Invoke-RestMethod -Method Get -Uri "http://localhost:5000/api/auth/me" -Headers @{ Authorization="Bearer $token" }
```

Do **not** post screenshots showing `$login`, `$token`, `$password`, or `$key`.

Private permissions can be tested once a synthetic private repository record exists in MongoDB. Grant an existing demo user (using the returned `$newUser.user.id`) read access:

```powershell
$permission = @{ user_id=$newUser.user.id; repository_id="YOUR_PRIVATE_REPO_ID"; role="reader" } | ConvertTo-Json
Invoke-RestMethod -Method Put -Uri "http://localhost:5000/api/admin/permissions" -ContentType "application/json" -Headers @{ "x-demo-write-key"=$key } -Body $permission
```

For a granted repository, pass the session token in `Authorization: Bearer <token>` on data read requests. To revoke:

```powershell
Invoke-RestMethod -Method Delete -Uri "http://localhost:5000/api/admin/permissions" -ContentType "application/json" -Headers @{ "x-demo-write-key"=$key } -Body (@{ user_id=$newUser.user.id; repository_id="YOUR_PRIVATE_REPO_ID" } | ConvertTo-Json)
```

After revocation, the private data endpoint should return `404` (without revealing whether the repository exists).

## Limitations

- This is **not** OAuth/GitHub sign-in. Accounts are local and created by a development administrator.
- Client sessions currently use Bearer tokens. A browser integration should retain them in memory rather than URL parameters or persistent browser storage.
- Access to public content remains anonymous. Private repositories must already exist in MongoDB; the public GitHub importer intentionally rejects private repositories.
- The local Docker Elasticsearch port is reachable from the same computer; real production deployment would require network isolation and TLS, otherwise direct access could bypass Express permission checks.
- This local rate limiter is in-memory and is not distributed. Production authentication would also need proper audit logs, account recovery, stronger rate limiting, HTTPS, CSRF design where applicable, and security review.
- Authorization changes for an already in-flight request have a small race window. This is a prototype, not a linearizable revocation guarantee.
- Kafka, Elasticsearch and Neo4j don't yet implement private-document indexing with per-user redaction. This milestone provides the API access policy, not complete private data ingestion.

## Testing

GitHub Actions checks JavaScript syntax and runs standalone security unit tests using `node --test test/security.test.js`. These tests do not require Docker.

Do not merge until a local end-to-end smoke test using a private synthetic repository confirms the intended behavior.
