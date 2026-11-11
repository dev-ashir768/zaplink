# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Forked from OpenWA 0.29.1 and renamed to ZapLink: package names, environment variables (`ZAPLINK_*`), HTTP headers (`X-ZapLink-*`), database identifiers and metric names.

### Changed (database)

- PostgreSQL is the only database. The API-key and audit-log tables moved from a separate SQLite file into the same PostgreSQL database, with their own migration chain (`main_migrations`). `docker compose up` now always starts the bundled `postgres` service and requires `DATABASE_PASSWORD` in `.env`.
- Backups are a `pg_dump` plus the data folder files; the SQLite backup path is gone.
- The test suites run against PostgreSQL (`npm run test:db:start`), each test file in its own schema.

### Removed

- Client SDKs, the `docs/` folder, the Helm chart and their release workflows.
- The MCP server, the Integration Fabric (provider-webhook ingress and its queue), the plugin management API, automation rules and the agent tool registry, along with the dashboard Plugins page.
- Every dashboard language except English.
- SQLite support (better-sqlite3), `docker-compose.dev.yml`, `.env.minimal`, the `.github` workflows and the Trivy install script.
