<!-- PROJECT SHIELDS -->
<p align="center">
  <a href="https://github.com/mehrdadmb2/release-notifier-bot/stargazers"><img src="https://img.shields.io/github/stars/mehrdadmb2/release-notifier-bot?style=for-the-badge&color=yellow" alt="GitHub stars"></a>
  <a href="https://github.com/mehrdadmb2/release-notifier-bot/network/members"><img src="https://img.shields.io/github/forks/mehrdadmb2/release-notifier-bot?style=for-the-badge&color=blue" alt="GitHub forks"></a>
  <a href="https://github.com/mehrdadmb2/release-notifier-bot/blob/main/LICENSE"><img src="https://img.shields.io/github/license/mehrdadmb2/release-notifier-bot?style=for-the-badge&color=green" alt="MIT License"></a>
  <a href="https://github.com/mehrdadmb2/release-notifier-bot/issues"><img src="https://img.shields.io/github/issues/mehrdadmb2/release-notifier-bot?style=for-the-badge&color=red" alt="GitHub issues"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Cloudflare_Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/Telegram_Bot-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram Bot">
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/GitHub_API-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub API">
</p>

<div align="center">
  <h1>🚀 GitHub Release Watcher Bot</h1>
  <p><strong>A Serverless Telegram Bot on Cloudflare Workers</strong></p>
  <p>Monitor multiple GitHub repositories · Get instant release notifications · Zero maintenance</p>
  <br/>
</div>

---

## 📖 Table of Contents
- [✨ Features](#-features)
- [📸 Screenshots](#-screenshots)
- [⚡ Quick Deploy](#-quick-deploy)
- [📋 Commands](#-commands)
- [🛠️ Architecture](#️-architecture)
- [🚀 Manual Deployment](#-manual-deployment)
- [🔧 Configuration](#-configuration)
- [🧪 Testing](#-testing)
- [📁 Project Structure](#-project-structure)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔔 **Automatic Monitoring** | Checks all configured repositories every hour for new releases |
| 👥 **Multi-User Support** | Any number of users can register with `/start` and receive notifications |
| 📦 **Rich Release Details** | Version, description, publish date, assets with file sizes, and direct download links |
| 🔍 **On-Demand Queries** | Use `/latest <repo>` to fetch real-time release info for any repository |
| 📋 **Batch Info** | `/latest` without arguments shows latest releases for **all** watched repos |
| 🛡️ **Robust Error Handling** | Automatic retries, timeouts, HTML parse fallback, and comprehensive logging |
| 🌐 **Global Ready** | English interface suitable for international users |
| ⚡ **Serverless** | Runs on Cloudflare Workers with free tier support — no server management |
| 🔐 **Secure** | Bot token stored as encrypted secret; KV storage for user data and release history |

---

## 📸 Screenshots

<p align="center">
  <img src="https://via.placeholder.com/400x800/1a1a2e/ffffff?text=Welcome+Message" alt="Welcome Message" width="250">
  <img src="https://via.placeholder.com/400x800/1a1a2e/ffffff?text=Release+Notification" alt="Release Notification" width="250">
  <img src="https://via.placeholder.com/400x800/1a1a2e/ffffff?text=Latest+Command" alt="Latest Command" width="250">
</p>

> *Replace placeholder images with actual screenshots of your bot in action.*

---

## ⚡ Quick Deploy

Deploy your own instance in minutes using the **Deploy to Cloudflare** button:

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/mehrdadmb2/release-notifier-bot">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare">
  </a>
</p>

After deployment, set your Telegram bot token as a secret and configure the webhook — you're ready to go!

---

## 📋 Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/start` | Register to receive release notifications | `/start` |
| `/stop` | Unsubscribe from all notifications | `/stop` |
| `/repos` | List all watched repositories with their last known versions | `/repos` |
| `/latest <repo>` | Get real-time latest release info for a specific repository | `/latest 2dust/v2rayN` |
| `/latest` | Get latest release info for **all** watched repositories | `/latest` |
| `/status` | Show bot health and statistics (users, repos, uptime) | `/status` |

---

## 🛠️ Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Telegram      │     │   Cloudflare    │     │    GitHub       │
│   Users         │────▶│   Worker        │────▶│    API          │
│                 │     │                 │     │                 │
│  ┌───────────┐  │     │  ┌───────────┐  │     │  ┌───────────┐  │
│  │ /start    │  │     │  │ Webhook   │  │     │  │ /repos/   │  │
│  │ /latest   │  │     │  │ Handler   │  │     │  │ /releases │  │
│  │ /repos    │  │     │  └───────────┘  │     │  └───────────┘  │
│  └───────────┘  │     │       │         │     │                 │
└─────────────────┘     │  ┌───────────┐  │     └─────────────────┘
                        │  │  KV Store │  │
                        │  │ ───────── │  │
                        │  │ RELEASES  │  │
                        │  │ USERS     │  │
                        │  └───────────┘  │
                        └─────────────────┘
```

### Data Flow

1. **Scheduled Trigger** – Worker runs every hour (Cron: `0 * * * *`)
2. **GitHub API Fetch** – For each configured repo, fetches the latest release
3. **Version Comparison** – Compares with stored version in `RELEASES` KV
4. **Notification** – If new version found, broadcasts to all users in `USERS` KV via Telegram Bot API
5. **User Commands** – Handled via Telegram Webhook for real-time interactions

---

## 🚀 Manual Deployment

### Prerequisites

- [Cloudflare Account](https://dash.cloudflare.com/)
- [Telegram Bot Token](https://t.me/BotFather) – create a bot and get the token
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) installed

### Step 1: Clone the Repository

```bash
git clone https://github.com/mehrdadmb2/release-notifier-bot.git
cd release-notifier-bot
```

### Step 2: Install Wrangler & Login

```bash
npm install -g wrangler
wrangler login
```

### Step 3: Create KV Namespaces

```bash
wrangler kv:namespace create "RELEASES"
wrangler kv:namespace create "USERS"
```

Copy the generated IDs and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "RELEASES"
id = "your-releases-kv-id"   # ← Paste here

[[kv_namespaces]]
binding = "USERS"
id = "your-users-kv-id"      # ← Paste here
```

### Step 4: Set Environment Secrets

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
```

Enter your bot token from @BotFather when prompted.

### Step 5: Configure Repositories

Edit `wrangler.toml` and update the `REPOS` variable:

```toml
[vars]
REPOS = "2dust/v2rayN,2dust/v2rayNG,diegosouzapw/OmniRoute"
```

> Separate multiple repositories with commas.

### Step 6: Deploy

```bash
wrangler deploy
```

### Step 7: Set Webhook

Visit this URL in your browser:

```
https://<your-worker-name>.<your-subdomain>.workers.dev/setwebhook
```

You should see `{"ok":true}` — your bot is now live!

---

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | ✅ Yes |
| `REPOS` | Comma-separated list of `owner/repo` | ✅ Yes |

### KV Namespaces

| Binding | Purpose |
|---------|---------|
| `RELEASES` | Stores the last known version tag for each repository |
| `USERS` | Stores chat IDs of all registered users |

### Cron Schedule

Default: `0 * * * *` (every hour)

To modify, edit `wrangler.toml`:

```toml
[triggers]
crons = ["*/30 * * * *"]   # Every 30 minutes
```

---

## 🧪 Testing

### Manual Trigger

Visit this URL to trigger an immediate check:

```
https://<your-worker-name>.<your-subdomain>.workers.dev/check
```

### Telegram Commands

Send these commands to your bot on Telegram:

1. `/start` – Register yourself
2. `/repos` – See watched repositories
3. `/latest 2dust/v2rayN` – Test a specific repo
4. `/latest` – See all repos at once
5. `/status` – Check bot health

### Logs

Monitor logs in real-time:

```bash
wrangler tail
```

Or view logs in Cloudflare Dashboard → Workers & Pages → Your Worker → Logs.

---

## 📁 Project Structure

```
release-notifier-bot/
├── src/
│   └── index.js              # Main Worker code
├── wrangler.toml             # Cloudflare Workers configuration
├── package.json              # Project metadata & scripts
├── .gitignore                # Ignored files
└── README.md                 # This documentation
```

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add some amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Development Tips

- Use `wrangler dev` for local development
- Test commands by sending messages to your bot
- Check logs with `wrangler tail`

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

## 🙏 Acknowledgements

- [Cloudflare Workers](https://workers.cloudflare.com/) – Serverless execution environment
- [Telegram Bot API](https://core.telegram.org/bots/api) – Messaging platform
- [GitHub REST API](https://docs.github.com/en/rest) – Release data source

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/mehrdadmb2">Mehrdad</a>
  <br/>
  ⭐ If this project helped you, please give it a star on GitHub!
</p>
```
