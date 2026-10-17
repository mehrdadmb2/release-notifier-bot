# 🛰️ GitHub Release Watcher

**Every release. One signal.** A serverless Telegram bot that watches GitHub repositories for new stable Releases, sends well-formatted alerts, and powers a responsive GitHub Pages dashboard.

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/)
[![Telegram Bot API](https://img.shields.io/badge/Telegram-Bot%20API-26a5e4?logo=telegram&logoColor=white)](https://core.telegram.org/bots/api)
[![GitHub Pages](https://img.shields.io/badge/GitHub-Pages-222?logo=github)](https://pages.github.com/)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES%20Modules-f7df1e?logo=javascript&logoColor=111)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

- **Worker endpoint:** <https://release-watcher-bot.game-developer-mb.workers.dev/>
- **GitHub repository:** <https://github.com/mehrdadmb2/release-notifier-bot>
- **Pages dashboard (after enabling Pages):** <https://mehrdadmb2.github.io/release-notifier-bot/>

> The dashboard can display a local/static watchlist if the Worker API is temporarily unavailable. Live state and subscriber metrics require the Worker to be deployed with valid KV bindings.

## ✨ Highlights

### Telegram notifications

- Clear HTML-formatted release cards with bold headings, monospace repository names and versions, quoted release notes, timestamps, direct GitHub links, asset names and file sizes.
- Inline Telegram buttons to open the release, open the repository, or download the first asset.
- Escaped untrusted text and a plain-text fallback if Telegram rejects formatting.
- A first-run baseline: existing release tags are stored silently by default instead of sending a burst of old notifications.
- Existing KV values that contain only a release tag are still understood; state is gradually written in the newer structured format.

### Commands

| Command | Purpose |
| --- | --- |
| `/start` | Register the chat and show the monitored repositories |
| `/help` | Show the bot command guide |
| `/repos` | List watch targets and their last known state |
| `/latest` | Fetch a live snapshot across configured repositories |
| `/latest owner/repo` | Fetch full details for a single repository; GitHub URLs are accepted too |
| `/status` | Display subscriber count, stored release count, last check, and errors |
| `/stop` | Unsubscribe the chat |
| `/check` | Trigger a manual scan only for chat IDs listed in `ADMIN_CHAT_IDS` |

Telegram's command menu is automatically registered when `/setwebhook` succeeds.

### Dashboard

- Responsive layout with animated gradients, glass panels, deep shadows and interactive cards.
- Live connection state to the Worker's read-only `/api/overview` API.
- Search, filters, sorting, copy-to-clipboard actions, and release links.
- Refreshable status snapshot; the dashboard does not fetch all GitHub repositories directly from every visitor's browser.
- Designed to work on mobile and desktop, including a mobile navigation menu and reduced-motion support.

## 👀 Repositories tracked by default

The configured watchlist includes the original projects plus the five newly requested repositories:

1. [`2dust/v2rayN`](https://github.com/2dust/v2rayN)
2. [`2dust/v2rayNG`](https://github.com/2dust/v2rayNG)
3. [`diegosouzapw/OmniRoute`](https://github.com/diegosouzapw/OmniRoute)
4. [`WhiteDNS/WhiteDNS-Android`](https://github.com/WhiteDNS/WhiteDNS-Android)
5. [`shirokhorshid/shirokhorshid-android`](https://github.com/shirokhorshid/shirokhorshid-android)
6. [`KNG7-P/Se7en-Pro`](https://github.com/KNG7-P/Se7en-Pro)
7. [`therealaleph/MasterHttpRelayVPN-RUST`](https://github.com/therealaleph/MasterHttpRelayVPN-RUST)
8. [`anonvector/SlipNet`](https://github.com/anonvector/SlipNet)

Add future projects to `REPOS` in `wrangler.toml` as a comma-separated list of `owner/repo` identifiers. Names must follow GitHub's owner/repository format.

## 🧱 Architecture

```text
GitHub Releases API
        │
        ▼
Cloudflare Worker ─────── Cron Trigger (every hour)
   │            │
   │            ├── RELEASES KV: release tags + check results
   │            └── USERS KV: Telegram chat subscriptions
   │
   ├── Telegram webhook → commands / formatted release alerts
   └── /api/overview ───────────────────────────┐
                                                ▼
                                       GitHub Pages dashboard
```

The scheduled trigger calls the GitHub Releases `latest` endpoint for each watched repository. This endpoint exposes published stable releases; a repository without a stable published GitHub Release is shown as having no stable release rather than crashing the entire scan. GitHub source commits or Git tags do not automatically count as a Release.

## 🚦 Important: preserve your existing KV namespaces

The `wrangler.toml` shipped here intentionally contains two ID placeholders. **Do not deploy until you replace them.** Use the namespace IDs already attached to the production Worker so that existing subscribers and stored release tags remain accessible.

1. Open Cloudflare Dashboard → **Workers & Pages** → `release-watcher-bot` → **Settings** → **Bindings**.
2. Locate the KV namespace attached to `RELEASES` and copy its namespace ID; do the same for `USERS`.
3. Replace the two placeholders in `wrangler.toml` with those exact IDs.
4. Do not remove or rename the existing namespaces.

You can also list namespaces with `npx wrangler kv namespace list`, then match them to the binding IDs in the Worker's settings. If the original namespaces truly do not exist, create them only after confirming that no production data needs to be preserved:

```powershell
npx wrangler kv namespace create RELEASES
npx wrangler kv namespace create USERS
```

Copy the IDs printed by Wrangler into `wrangler.toml`.

## 🚀 Deploy the Worker with Wrangler (Windows PowerShell)

Run these commands manually in PowerShell; no `.ps1` script is required.

### 1. Download or replace the project files

Clone the repository, or place these files into your existing local clone without replacing your KV IDs with the placeholders:

```powershell
git clone https://github.com/mehrdadmb2/release-notifier-bot.git
cd release-notifier-bot
```

Replace the project files with the upgraded versions. Before deployment, edit `wrangler.toml` and enter the existing production namespace IDs.

### 2. Install Wrangler and log in

```powershell
npm install
npx wrangler login
```

### 3. Add the bot token and setup secrets

Create each secret interactively so its value is not placed in `wrangler.toml` or committed to Git. Use strong, unique random values for the setup/check/webhook secrets.

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put SET_WEBHOOK_SECRET
npx wrangler secret put CHECK_SECRET
```

Optional: enable the `/check` Telegram command for one or more administrators. Enter comma-separated Telegram chat IDs (not usernames) when prompted:

```powershell
npx wrangler secret put ADMIN_CHAT_IDS
```

`TELEGRAM_WEBHOOK_SECRET` must consist of 1–256 characters from `A-Z`, `a-z`, `0-9`, `_`, or `-`. Store the same secret in the Worker secret; Wrangler will use it when registering the Telegram webhook.

### 4. Check configuration and deploy

```powershell
npm run check
npx wrangler deploy
```

The Worker is configured to check every hour (`0 * * * *`). To change the cadence, edit `triggers.crons` in `wrangler.toml` and update the matching interval text in `src/index.js` and the dashboard. Be mindful of GitHub API rate limits if you increase the frequency or watch many more repositories.

### 5. Configure the Telegram webhook and bot command menu

Run the following PowerShell command. It prompts for the `SET_WEBHOOK_SECRET` value; do not paste that value into a public message or commit it:

```powershell
$setupSecret = Read-Host "Enter the SET_WEBHOOK_SECRET value"
Invoke-RestMethod -Method Post `
  -Uri "https://release-watcher-bot.game-developer-mb.workers.dev/setwebhook" `
  -Headers @{ "X-Setup-Secret" = $setupSecret }
```

A successful response contains `ok: true`, a Telegram `setWebhook` result and the `webhookUrl`. The command menu is registered at the same time. If the Worker uses a different hostname, substitute that hostname.

### 6. Trigger a manual check

```powershell
$checkSecret = Read-Host "Enter the CHECK_SECRET value"
Invoke-RestMethod -Method Post `
  -Uri "https://release-watcher-bot.game-developer-mb.workers.dev/check" `
  -Headers @{ "X-Check-Secret" = $checkSecret }
```

A scheduled cron run does not require a request from you. If you need to inspect logs in real time:

```powershell
npx wrangler tail
```

## 🌐 Enable GitHub Pages

The dashboard is a static site in `index.html` with styles/scripts in `assets/`; it does not require a build command.

1. Push the updated files to the repository's `main` branch.
2. Open the repository's **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select branch `main` and folder `/(root)`, then save.
5. Wait for the Pages deployment shown in the Pages section to complete.
6. Open `https://mehrdadmb2.github.io/release-notifier-bot/` and test the search, filters, copy buttons and Worker connection indicator.

The dashboard's API endpoint is set in `assets/app.js` to the Worker URL specified above. The Worker's `PUBLIC_SITE_ORIGIN` must match the page origin (`https://mehrdadmb2.github.io`), not the full path.

## 🔧 Configuration reference

| Setting | Type | Description |
| --- | --- | --- |
| `REPOS` | Variable | Comma-separated list of `owner/repo` names |
| `NOTIFY_ON_FIRST_SEEN` | Variable | `false` establishes baseline silently; set `true` to alert on all repositories the first time they are recorded |
| `PUBLIC_SITE_ORIGIN` | Variable | Origin allowed to read `/api/overview` from the browser |
| `PUBLIC_SITE_URL` | Variable | Dashboard link on the Worker's landing page |
| `TELEGRAM_BOT_TOKEN` | Secret | Telegram token from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Secret | Authenticates incoming Telegram webhook requests |
| `SET_WEBHOOK_SECRET` | Secret | Authenticates the `POST /setwebhook` setup endpoint via `X-Setup-Secret` |
| `CHECK_SECRET` | Secret | Authenticates the `POST /check` endpoint via `X-Check-Secret` |
| `ADMIN_CHAT_IDS` | Optional secret | Comma-separated IDs allowed to run Telegram `/check` |
| `RELEASES` | KV binding | Persistent release tags, per-repository check states |
| `USERS` | KV binding | Telegram chat subscriptions |

No API token is needed for public GitHub Release endpoints. For a large watchlist or stricter API quotas, you can extend the Worker with a GitHub token stored as a secret; never hard-code tokens in source code.

## 🧪 Verification checklist

- [ ] `wrangler.toml` has the existing `RELEASES` and `USERS` KV namespace IDs.
- [ ] `npm run check` passes.
- [ ] The Worker deploys without binding errors.
- [ ] `/health` returns JSON with `ok: true`.
- [ ] The authenticated `/setwebhook` request returns `ok: true`.
- [ ] In Telegram, `/start`, `/help`, `/repos`, `/latest`, and `/status` respond.
- [ ] `POST /check` with `X-Check-Secret` returns a scan summary.
- [ ] The Pages dashboard displays **Worker connected** and shows the stored release states.
- [ ] A test release notification renders its version in monospace, notes in a quote block and links as working Telegram buttons.

## 🛟 Troubleshooting

**`Missing KV bindings` or deployment binding errors** — Check the `RELEASES` and `USERS` IDs and make sure the bindings exist in the target Cloudflare account.

**Telegram doesn't respond** — Confirm `TELEGRAM_BOT_TOKEN`, deploy first, then run the authenticated `/setwebhook` request. If you configured `TELEGRAM_WEBHOOK_SECRET`, it must match the value used by the webhook setup request.

**Dashboard says Worker API unavailable** — Open the Worker's `/health` route. Then inspect the browser console and run `npx wrangler tail`. Confirm that `PUBLIC_SITE_ORIGIN` is exactly `https://mehrdadmb2.github.io`.

**A repository has no version shown** — The Worker may not have completed its first scheduled scan yet, or the repository may not publish a stable GitHub Release. Visit its Releases page to verify.

**First deployment sends no notifications** — This is intentional by default. The Worker saves the current tags as a baseline and avoids notifying on older releases. Set `NOTIFY_ON_FIRST_SEEN = "true"` only if you want initial releases broadcast to all subscribed chats.

## 📄 License

Apache License 2.0. See [`LICENSE`](LICENSE).
