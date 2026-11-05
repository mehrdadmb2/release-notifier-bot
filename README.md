# 🛰️ Release Watcher v5.0

**Every release. One signal.** A GitHub Release monitor built with Cloudflare Workers, Cloudflare KV, Telegram Bot API, GitHub Actions, and a static GitHub Pages dashboard.

- **Worker:** <https://release-watcher-bot.game-developer-mb.workers.dev/>
- **Repository:** <https://github.com/mehrdadmb2/release-notifier-bot>
- **Dashboard:** <https://mehrdadmb2.github.io/release-notifier-bot/>

## What changed in v5.0

### Persistent repository database

The existing `RELEASES` KV namespace is retained and extended as the persistent data store. No D1 migration is required, and the existing `USERS` namespace remains untouched. The Worker stores:

- Current stable release, release notes, release URL, author, publication time, release ID, and downloadable assets.
- Previous stable version and a version-history timeline (up to 100 records per repository).
- Daily repository-stat snapshots (up to 180 days, one snapshot per repository per day).
- Repository metadata: description, homepage, stars, forks, watchers, open issues, primary language, topics, license, default branch, visibility, archive state, creation/update/push timestamps, and repository size.
- Per-repository health/check status, last-check time, metadata status, scan source, and a global last-scan summary.
- Existing Telegram subscribers in the unchanged `USERS` KV namespace.

The initial scan attempts to backfill the immediately previous stable release from GitHub's releases list. The first saved current release is a quiet baseline; it does not notify subscribers. Later tag changes create a version-history event and a Telegram notification with **previous version → new version**.

### One scan trigger, cached reads everywhere else

The scan architecture is intentionally separated:

| Action | Contacts GitHub API? | Purpose |
| --- | --- | --- |
| GitHub Actions daily schedule | **Yes** | Refresh repository metadata, release state, history, and daily snapshots |
| GitHub Actions `workflow_dispatch` | **Yes** | Manually trigger the same secure scan pipeline from GitHub |
| Dashboard **Run repository scan** | **Yes** | Manual scan after entering `CHECK_SECRET` |
| Telegram `/check` | **Yes** | Admin-only manual scan, restricted by `ADMIN_CHAT_IDS` |
| Dashboard page load / refresh | No | Read cached `/api/overview` snapshot |
| Telegram `/repos`, `/latest`, `/status`, `/help` | No | Read stored state or static help text |

There is no Cloudflare Cron trigger in v5.0. This prevents duplicate scheduled scans. The daily GitHub Action runs at `02:17 UTC`; GitHub may delay scheduled workflows during high-load periods.

### Dashboard and Telegram

- Full-screen animated startup sequence, responsive glass UI, search, filters, sorting, copy actions, and repository intelligence panels.
- Previous → current version comparison, release-change history, daily snapshot counts, repository details, language, stars, forks, open issues, license, branch, topics, and activity dates.
- The refresh icon reloads the saved snapshot only. It never starts a GitHub scan.
- Dedicated scan control is protected by the Worker `CHECK_SECRET`. The key is used for that request only and is not persisted by the page.
- Telegram notification shows both **New version** and **Previous version**, alongside changelog, publish time, assets, and direct links.
- `/latest` is now cache-only; it no longer sends one GitHub API request per tracked repository.
- The Worker health endpoint and deployment landing page describe the daily Action-based schedule.

## Telegram commands

| Command | Behavior |
| --- | --- |
| `/start` | Subscribe this chat and show the watchlist |
| `/help` | Show the command guide |
| `/repos` | List monitored repositories, stored versions, and last-check times |
| `/latest` | Show all cached latest releases; no GitHub API calls |
| `/latest owner/repo` | Show cached full release details, notes, assets, and previous version |
| `/status` | Show subscriber, repository, scan, and error statistics |
| `/check` | Admin-only scan; only chat IDs in `ADMIN_CHAT_IDS` are allowed |
| `/stop` | Unsubscribe this chat |

The Telegram command menu is updated when `/setwebhook` runs successfully.

## Architecture

```text
                       once per day / workflow_dispatch
                       ┌──────────────────────────────┐
                       │ GitHub Actions                │
                       │ POST /check + CHECK_SECRET    │
                       └──────────────┬───────────────┘
                                      │
 Dashboard ── GET /api/overview ──────┤
 Manual scan ── POST /check ──────────┤
 Telegram webhook ── /check ──────────┤
                                      ▼
                           Cloudflare Worker
                         ┌─────────────────────┐
                         │ Auth + scan engine  │
                         │ GitHub API compare  │
                         │ Telegram notifier   │
                         └───────┬───────┬─────┘
                                 │       │
                      ┌──────────▼─┐   ┌─▼────────────┐
                      │ RELEASES KV│   │ USERS KV     │
                      │ snapshots  │   │ subscribers  │
                      │ history    │   └──────────────┘
                      │ metadata   │
                      └────────────┘
```

`RELEASES` uses key prefixes `release:`, `check:`, `repo:`, `history:`, `snapshots:`, and the global key `meta:last-scan`. The `USERS` key format is unchanged: each chat ID remains a key, so the existing subscriber list can be preserved.

## Repository watchlist

Default `REPOS` values in `wrangler.toml`:

```text
2dust/v2rayN
2dust/v2rayNG
diegosouzapw/OmniRoute
WhiteDNS/WhiteDNS-Android
shirokhorshid/shirokhorshid-android
KNG7-P/Se7en-Pro
therealaleph/MasterHttpRelayVPN-RUST
anonvector/SlipNet
```

Append or remove `owner/repo` values in `REPOS`. The dashboard renders the Worker-provided list, so you do not need to edit `assets/app.js` to add a repository.

## Deployment

See **[SETUP-FA.md](SETUP-FA.md)** for the exact Windows PowerShell + Wrangler steps, preservation of existing KV namespaces, secrets, GitHub Actions setup, webhook registration, Pages deployment, and verification commands.

### Required configuration at a glance

| Setting | Type | Purpose |
| --- | --- | --- |
| `REPOS` | Wrangler variable | Comma-separated `owner/repo` watchlist |
| `NOTIFY_ON_FIRST_SEEN` | Wrangler variable | Default `false`; initial baselines stay silent |
| `PUBLIC_SITE_ORIGIN` | Wrangler variable | Browser CORS origin, without the Pages path |
| `PUBLIC_SITE_URL` | Wrangler variable | Dashboard link shown on the Worker landing page |
| `TELEGRAM_BOT_TOKEN` | Worker secret | BotFather token |
| `TELEGRAM_WEBHOOK_SECRET` | Optional Worker secret | Verify Telegram webhook requests |
| `SET_WEBHOOK_SECRET` | Worker secret | Protect `POST /setwebhook` |
| `CHECK_SECRET` | Worker secret | Protect `POST /check` |
| `ADMIN_CHAT_IDS` | Worker secret | Comma-separated Telegram IDs allowed to run `/check` |
| `GITHUB_TOKEN` | Optional Worker secret | Authenticated GitHub API quota for larger watchlists |
| `WORKER_CHECK_SECRET` | GitHub Actions secret | Must exactly match the Worker `CHECK_SECRET` |
| `RELEASES` | KV binding | Release state, metadata, history, and daily snapshots |
| `USERS` | KV binding | Telegram subscriptions |

## API endpoints

| Route | Method | Authentication | Behavior |
| --- | --- | --- | --- |
| `/health` | GET | Public | Worker health and scan strategy |
| `/api/health` | GET | Public | Alias of `/health` |
| `/api/overview` | GET | Public, CORS-limited | Read-only stored dashboard snapshot |
| `/check` | POST | `X-Check-Secret` | Run a fresh scan, persist data, and notify on version changes |
| `/setwebhook` | POST | `X-Setup-Secret` | Configure Telegram webhook and bot command menu |
| `/webhook` | POST | Telegram secret token when configured | Receive Telegram updates |

The dashboard's GET API is strictly read-only. The only Worker route that starts repository scanning is `POST /check`.

## Reliability and known boundaries

- GitHub 403/429 responses and transient failures are retried with bounded backoff. A `GITHUB_TOKEN` Worker secret is optional but recommended if the watchlist grows significantly.
- Repository metadata and release data are handled independently. A metadata failure does not discard a release update if the release endpoint still succeeds.
- Missing or inaccessible repositories are marked `not-found`; repositories with no stable GitHub Release are marked `no-release`.
- Each daily stats collection is deduplicated by UTC date. A manual scan on the same date updates that day's snapshot instead of inflating the timeline.
- Version history is bounded to 100 entries per repository; daily stats are bounded to 180 days.
- A failed scan for one repository does not stop the remaining repositories from being processed.
- The dashboard can show a static fallback list while the Worker is unreachable, but actual release versions and repository metrics require a successful initial scan.
- GitHub's scheduler is best-effort. `workflow_dispatch` and the dashboard/Telegram manual triggers are available when an immediate refresh is needed.

## Local checks

```powershell
npm install
npm run check
npm test
```

Tests use mocked GitHub and Telegram responses. They do not publish Telegram messages or modify live Cloudflare KV.

## License

Apache-2.0. See [LICENSE](LICENSE).
