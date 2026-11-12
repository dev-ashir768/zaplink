<p align="center">
  <img src="dashboard/public/zaplink_logo.svg" alt="ZapLink" width="160"/>
</p>

<h1 align="center">ZapLink</h1>

<p align="center"><strong>Self-hosted WhatsApp HTTP API gateway</strong> — NestJS · PostgreSQL · Docker</p>

---

ZapLink runs WhatsApp sessions on your own server and exposes them through a REST API, webhooks, a
WebSocket event stream and a web dashboard. Link a number by scanning a QR code, then send and receive
messages from any system that can make an HTTP request.

> ZapLink is a fork of [OpenWA](https://github.com/rmyndharis/OpenWA) (MIT), trimmed down to the gateway
> itself and running on PostgreSQL only.

## Contents

- [Features](#features)
- [Before you connect a number](#before-you-connect-a-number)
- [Quick start (Docker)](#quick-start-docker)
- [The data folder](#the-data-folder)
- [Configuration](#configuration)
- [API examples](#api-examples)
- [Local development](#local-development)
- [Running the tests](#running-the-tests)
- [Backup and restore](#backup-and-restore)
- [Project structure](#project-structure)
- [License](#license)

## Features

- **Sessions** — many WhatsApp numbers on one server; QR code or pairing-code login; optional per-session proxy.
- **Two engines** — `whatsapp-web.js` (headless Chromium) or `baileys` (WebSocket, no browser), chosen with `ENGINE_TYPE`.
- **Messaging** — text, media, location, contacts, polls, reactions, replies, forwards, edits and deletes; bulk sends with pacing.
- **Chats, contacts and groups** — list, search, archive, pin, mute, labels, group admin actions.
- **Webhooks** — HMAC-signed deliveries with retries, filters and a dead-letter list; optional Redis queue.
- **Real-time** — WebSocket events for the dashboard and your own clients.
- **Search** — full-text message search built on PostgreSQL (`tsvector`); optional substring search (`pg_trgm`).
- **Dashboard** — sessions, chats, webhooks, templates, API keys, logs and infrastructure settings.
- **Security** — API keys with roles (admin / operator / viewer) scoped to sessions or chats, audit log, rate limits.
- **Operations** — health and readiness checks, Prometheus metrics, backup/restore scripts.

The full, always-current API reference is served by the running app at `/api/docs` (Swagger UI, outside
production); the machine-readable contract is [`openapi.json`](./openapi.json).

## Before you connect a number

ZapLink talks to WhatsApp through reverse-engineered clients
([whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) and
[Baileys](https://github.com/WhiskeySockets/Baileys)), **not** Meta's official Cloud API.

- There is always some risk of the number being restricted or banned. Use a **dedicated number**, never
  your main personal or business number.
- Warm up new numbers slowly, message people who expect to hear from you, and never cold-blast strangers.
  `SEND_PACING_ENABLED=true` adds a per-session daily cap.
- `whatsapp-web.js` looks more like a real browser but uses ~300–500 MB RAM per session; `baileys` uses
  ~30–80 MB but is easier for WhatsApp to fingerprint.
- Keep an SMS / email fallback for anything critical (logins, payments).

ZapLink is not affiliated with or endorsed by WhatsApp or Meta.

## Quick start (Docker)

**Going to production on a server?** Follow [DEPLOY.md](./DEPLOY.md): one command sets up HTTPS, Redis,
backups and a firewall, sized for 100+ WhatsApp numbers. The steps below are for trying it on your
own machine.

Requirements: Docker with Compose v2.

```bash
git clone https://github.com/dev-ashir768/zaplink.git
cd zaplink
cp .env.example .env
```

Open `.env` and set a strong database password (it is the only required value):

```dotenv
DATABASE_PASSWORD=change-me-to-a-long-random-string
```

Start ZapLink and its PostgreSQL database:

```bash
docker compose up -d
```

- Dashboard: http://localhost:2785
- API: http://localhost:2785/api
- Health: http://localhost:2785/api/health

On first start ZapLink creates an admin API key. Read it with:

```bash
docker exec zaplink-api cat /app/data/.api-key
```

Use it to sign in to the dashboard and as the `X-API-Key` header for API calls. Create a session in the
dashboard, scan the QR code with WhatsApp (Linked devices), and you are connected.

Everyday commands:

```bash
docker compose logs -f zaplink-api   # follow the logs
docker compose up -d --build         # rebuild after changing the code
docker compose down                  # stop (data is kept)
```

`docker compose down -v` also deletes the volumes — the database and all sessions. Don't run it unless
you mean to wipe everything.

## The data folder

PostgreSQL holds the structured data: sessions, messages, webhooks, templates, API keys and the audit log.
The `data/` folder (the `zaplink-data` volume in Docker, `./data` in local development) holds the files
that do not belong in a database:

| Path             | What it is                                                                   |
| ---------------- | ---------------------------------------------------------------------------- |
| `sessions/`      | whatsapp-web.js login profiles — losing it means scanning the QR code again  |
| `baileys/`       | Baileys login credentials — same                                             |
| `media/`         | Stored media (status updates, archived chat media) when `STORAGE_TYPE=local` |
| `.env.generated` | Settings saved from the dashboard's Infrastructure page                      |
| `.api-key`       | The first admin API key, in plain text — keep it private                     |

It is created automatically, is ignored by git, and is included in backups. Never commit it.

## Configuration

All settings are environment variables. [`.env.example`](./.env.example) has the few most people need;
[`.env.reference`](./.env.reference) lists every one with an explanation and its default. Settings are read in this order: the process environment, then `.env`, then
`data/.env.generated` (written by the dashboard).

Commonly changed:

| Variable              | Default           | Purpose                                                    |
| --------------------- | ----------------- | ---------------------------------------------------------- |
| `DATABASE_PASSWORD`   | — (required)      | PostgreSQL password                                        |
| `DATABASE_HOST`       | `postgres`        | Point at an external PostgreSQL instead of the bundled one |
| `ENGINE_TYPE`         | `whatsapp-web.js` | `whatsapp-web.js` or `baileys`                             |
| `API_PORT`            | `2785`            | Host port the API and dashboard are published on           |
| `STORAGE_TYPE`        | `local`           | `local` or `s3` for media                                  |
| `REDIS_ENABLED`       | `false`           | Redis for rate limits, cache and WebSocket fan-out         |
| `QUEUE_ENABLED`       | `false`           | Redis-backed webhook delivery queue                        |
| `AUTO_START_SESSIONS` | `false`           | Reconnect linked sessions when the server starts           |

The API is published on `127.0.0.1` only. To expose it, put a TLS reverse proxy (nginx, Caddy, a cloud
load balancer) in front of it.

## API examples

Replace `YOUR_API_KEY` with your key and `{sessionId}` with a session id.

```bash
# Create a session
curl -X POST http://localhost:2785/api/sessions \
  -H "Content-Type: application/json" -H "X-API-Key: YOUR_API_KEY" \
  -d '{"name": "my-bot"}'

# Start it and fetch the QR code
curl -X POST http://localhost:2785/api/sessions/{sessionId}/start -H "X-API-Key: YOUR_API_KEY"
curl http://localhost:2785/api/sessions/{sessionId}/qr -H "X-API-Key: YOUR_API_KEY"

# Send a text message
curl -X POST http://localhost:2785/api/sessions/{sessionId}/messages/send-text \
  -H "Content-Type: application/json" -H "X-API-Key: YOUR_API_KEY" \
  -d '{"chatId": "923001234567@c.us", "text": "Hello from ZapLink!"}'

# Receive events on your server
curl -X POST http://localhost:2785/api/sessions/{sessionId}/webhooks \
  -H "Content-Type: application/json" -H "X-API-Key: YOUR_API_KEY" \
  -d '{"url": "https://your-server.com/webhook", "events": ["message.received"], "secret": "your-hmac-secret"}'
```

Webhook deliveries carry an `X-ZapLink-Signature` header (HMAC-SHA256 of the body with your secret).

## Local development

Requirements: Node.js 22.19 or newer, and a PostgreSQL 13+ database. One in Docker:

```bash
docker run -d --name zaplink-dev-db -e POSTGRES_USER=zaplink -e POSTGRES_PASSWORD=zaplink -e POSTGRES_DB=zaplink -p 127.0.0.1:5432:5432 postgres:16-alpine
```

```bash
npm install
cp .env.example .env    # set DATABASE_HOST=localhost and DATABASE_PASSWORD=zaplink
npm run dev             # API on :2785 and the dashboard dev server on :2886
```

Migrations run automatically when the app starts. To run them by hand:

```bash
npm run migration:run        # sessions, messages, webhooks, ...
npm run migration:run:main   # API keys and audit log
```

Useful scripts: `npm run build`, `npm run lint`, `npm run format`, `npm run openapi:export`.

## Running the tests

The tests run against a real PostgreSQL. Each test file gets its own schema, so they run in parallel.

```bash
npm run test:db:start   # PostgreSQL for tests on 127.0.0.1:55432
npm test                # unit and integration tests
npm run test:e2e        # end-to-end tests
npm run test:db:stop
```

Set `TEST_DATABASE_URL` to use another database. The dashboard has its own tests: `cd dashboard && npm test`.

## Backup and restore

```bash
docker exec -e BACKUP_DIR=/app/data/backups -e TMPDIR=/app/data/backups zaplink-api ./scripts/backup.sh
```

The archive contains a `pg_dump` of the database, the engine logins, local media, `.env.generated` and
`.api-key`. It contains secrets: store it encrypted. `scripts/restore.sh <archive>` puts the files back
and prints the `psql` command that loads the database dump.

## Project structure

```
src/
  main.ts, app.module.ts   bootstrap and module wiring
  config/                  environment loading and validation
  database/                TypeORM data sources and migrations (data + migrations-main)
  engine/                  WhatsApp engines (whatsapp-web.js, Baileys) and their adapters
  core/                    hooks and the engine loader
  modules/                 REST features: session, message, webhook, group, contact, auth, ...
  common/                  shared guards, interceptors, storage, utilities
  test-utils/              PostgreSQL helpers for the tests
dashboard/                 React dashboard (Vite), served by the API in production
scripts/                   backup/restore, postinstall patches, OpenAPI export
test/                      end-to-end tests
```

## License

[MIT](./LICENSE). Based on OpenWA, © Yudhi Armyndharis and contributors.
