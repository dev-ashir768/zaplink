# Deploying ZapLink to production

This guide puts ZapLink on one Linux server (VPS) with HTTPS, sized for 100+ WhatsApp numbers.

## 1. Server

| Numbers  | Engine          | vCPU | RAM   | Disk       |
| -------- | --------------- | ---- | ----- | ---------- |
| up to 50 | Baileys         | 2    | 8 GB  | 60 GB SSD  |
| 100–150  | Baileys         | 4    | 16 GB | 100 GB SSD |
| 150–300  | Baileys         | 8    | 32 GB | 200 GB SSD |
| 100      | whatsapp-web.js | 16   | 64 GB | 200 GB SSD |

Use Ubuntu 22.04/24.04 or Debian 12. Baileys is the default because whatsapp-web.js runs a full
Chrome per number (300–500 MB each). Pick whatsapp-web.js only if you need a feature Baileys lacks.

## 2. Domain

Create an **A record** (for example `wa.yourcompany.com`) pointing at the server's IP. Wait until
`ping wa.yourcompany.com` shows that IP.

## 3. Install

SSH into the server as root and run:

```bash
curl -fsSL https://raw.githubusercontent.com/dev-ashir768/zaplink/main/deploy/install.sh -o install.sh
sudo bash install.sh wa.yourcompany.com admin@yourcompany.com
```

It installs Docker, enables the firewall (only 22, 80, 443 open), adds swap, puts the code in
`/opt/zaplink`, writes `.env` with random passwords, starts everything with HTTPS and schedules a
nightly backup at 02:30.

## 4. First login

```bash
/opt/zaplink/deploy/zaplink.sh key
```

Open `https://wa.yourcompany.com`, paste the key, then create one session per WhatsApp number and
scan its QR code. Create a separate API key for every app or team that calls the API (Dashboard >
API Keys) instead of sharing the admin key.

## 5. Daily operation

All commands run from `/opt/zaplink`:

| Command                            | What it does                               |
| ---------------------------------- | ------------------------------------------ |
| `deploy/zaplink.sh status`         | Containers, health, memory, disk           |
| `deploy/zaplink.sh logs`           | Follow the API logs                        |
| `deploy/zaplink.sh restart`        | Restart the API                            |
| `deploy/zaplink.sh update`         | Backup, pull latest code, rebuild, restart |
| `deploy/zaplink.sh backup`         | Backup now                                 |
| `deploy/zaplink.sh restore <file>` | Restore a backup (asks first)              |
| `deploy/zaplink.sh stop` / `start` | Stop / start everything                    |

## 6. Backups

Each backup is one file in `/var/backups/zaplink/` holding the database dump and the data volume
(WhatsApp logins, media, settings). Backups older than 14 days are deleted (`BACKUP_KEEP_DAYS`).
**Copy them off the server** (another server, S3, Google Drive); a backup on the same disk does not
survive losing the server.

Losing the data volume means every number has to scan its QR code again.

## 7. What runs

```
Internet ──443──> Caddy (HTTPS) ──> zaplink-api ──> PostgreSQL
                                         └────────> Redis (cache, rate limits, webhook queue)
```

- `docker-compose.yml` is the base; `docker-compose.prod.yml` adds Caddy, Redis, PostgreSQL tuning
  and log rotation, and hides the API port from the internet.
- Settings live in `/opt/zaplink/.env` (template: `deploy/.env.production.example`; every setting:
  `.env.reference`). After changing it run `deploy/zaplink.sh start`.

## 8. Checklist

- [ ] DNS A record points at the server
- [ ] `deploy/zaplink.sh status` shows every container healthy and the HTTPS check ok
- [ ] Admin key saved in the company password manager
- [ ] One API key per app or team
- [ ] Backups copied off the server
- [ ] `.env` saved somewhere safe (the passwords in it are needed to restore)
- [ ] Server updates: `apt upgrade` monthly; ZapLink: `deploy/zaplink.sh update`
