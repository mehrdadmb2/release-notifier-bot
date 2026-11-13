# Release Watcher v5.0.1

## Fixed

- GitHub API scans now fail fast when `GITHUB_TOKEN` is missing instead of silently using a shared unauthenticated Cloudflare egress IP.
- Invalid/expired GitHub tokens (401), insufficient permissions (403), and primary/secondary rate limits are reported separately.
- Primary/secondary rate-limit responses stop the current repository scan immediately; the Worker does not retry or continue burning requests for other repositories.
- The daily GitHub Action checks Worker health and confirms that GitHub authentication is configured before starting a scan.
- The Action no longer retries the scan POST automatically, avoiding duplicate scan triggers if a request is interrupted after reaching the Worker.

## Improved

- Added conditional `ETag` / `If-None-Match` requests for repository metadata and latest releases. HTTP 304 responses reuse the raw API payload already cached in the existing `RELEASES` KV namespace.
- Added `githubAuthConfigured` and `githubAuthMode` to `/health` without exposing the token.
- Added rate-limit reset information to scan results and admin `/check` messages.
- Updated Persian installation and troubleshooting instructions with least-privilege GitHub token setup.

## Compatibility

- Existing `RELEASES` and `USERS` KV namespaces, repository data keys, Telegram subscribers, dashboard API, and bot commands remain compatible.
- New API cache keys use the `github-cache:` prefix inside the existing `RELEASES` namespace; no new Cloudflare KV namespace is required.
