# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added (session ownership)

- Sessions now have an owner. A session created with an OPERATOR key belongs to that key (`ownerKeyId`); sessions created with an ADMIN key or the master key, and every session that existed before this change, are admin-owned (`ownerKeyId: null`). Session responses carry `ownerKeyId` and `ownerName`.
- OPERATOR keys can now create sessions even when they have assigned sessions (`allowedSessions`); the new session is theirs and immediately in their reach. A session-scoped ADMIN key still cannot create one.
- `GET /api/sessions?owner=<keyId>|admin|all` (ADMIN only) filters the list by owner; any other key sending `owner` gets 403.
- `PATCH /api/sessions/:sessionId/owner` `{ "ownerKeyId": "<key id>" | null }` (ADMIN only) transfers a session to an OPERATOR/VIEWER key or back to the admins. The previous owner's WebSocket connections are closed so they re-subscribe within their new reach.
- Deleting or revoking a key moves the sessions it owns to admin ownership (they are not deleted). `GET /api/auth/api-keys` reports `ownedSessions` per key.
- Dashboard: an Owner filter (kept in the URL as `?owner=`) and an owner badge on the Sessions page, an Owner filter on the Dashboard and the Chats session switcher, a Transfer owner action, an "Owns N sessions" column on API Keys, plain-words role help in the key dialogs, and a delete/revoke warning that says how many sessions move to the admins.
- Migration `AddSessionOwnerKeyId1791900000000` (data connection) adds the nullable, indexed `sessions.ownerKeyId` column.

### Changed (session access, breaking for unrestricted operator and viewer keys)

- OPERATOR and VIEWER keys are now always fenced to their assigned sessions (`allowedSessions`) plus the sessions they own. Before, such a key with an empty `allowedSessions` reached every session; after upgrading it reaches only the sessions it creates (operators) or is assigned. Viewers own nothing, so an unassigned viewer sees an empty list. Assign sessions to existing operator and viewer keys (API Keys page, "Choose sessions") or transfer sessions to them before upgrading if they must keep their access. ADMIN keys are unchanged.
- The fence applies everywhere a key's sessions are checked: session routes, every `/sessions/:sessionId/...` route, the WebSocket `subscribe` (an operator can no longer subscribe to `*`), webhook, audit and delivery-failure lists, webhook redrive, message search and aggregate session stats. It is read per request, so a transfer or key deletion applies on the next request.

### Changed

- Named ZapLink throughout: package names, environment variables (`ZAPLINK_*`), HTTP headers (`X-ZapLink-*`), database identifiers and metric names.

### Changed (database)

- PostgreSQL is the only database. The API-key and audit-log tables moved from a separate SQLite file into the same PostgreSQL database, with their own migration chain (`main_migrations`). `docker compose up` now always starts the bundled `postgres` service and requires `DATABASE_PASSWORD` in `.env`.
- Backups are a `pg_dump` plus the data folder files; the SQLite backup path is gone.
- The test suites run against PostgreSQL (`npm run test:db:start`), each test file in its own schema.

### Removed

- Client SDKs, the `docs/` folder, the Helm chart and their release workflows.
- The MCP server, the Integration Fabric (provider-webhook ingress and its queue), the plugin management API, automation rules and the agent tool registry, along with the dashboard Plugins page.
- Every dashboard language except English.
- SQLite support (better-sqlite3), `docker-compose.dev.yml`, `.env.minimal`, the `.github` workflows and the Trivy install script.
