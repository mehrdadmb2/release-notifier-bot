# Release Watcher v5.0.0

## Added

- Daily GitHub Actions schedule and manual `workflow_dispatch` trigger.
- Read-only dashboard refresh and cache-only Telegram `/latest` and `/repos` commands.
- Authenticated dashboard scan dialog protected by `CHECK_SECRET`.
- GitHub repository metadata snapshots: descriptions, stars, forks, watchers, issues, language, topics, license, branch, visibility, lifecycle timestamps, and size.
- Release payload persistence, including changelog text and downloadable asset metadata.
- Previous stable release backfill on first scan when available, including migration of legacy stored tags into the new history format.
- Previous → new version comparison in Telegram release notifications, Telegram latest details, and dashboard cards.
- Up to 100 release-history entries and up to 180 daily statistic snapshots per repository.
- Scan source, health summary, metadata state, and per-repository status reporting.
- Full-screen dashboard boot/loading animation and expandable repository intelligence panels with mini trend visuals.
- Additional Worker tests for legacy-data migration, cache-only reads, Telegram message formatting, and custom-header CORS preflight.

## Changed

- Removed Cloudflare Cron scanning to avoid duplicate scheduled triggers.
- `POST /check` is now the only Worker endpoint that starts a GitHub scan.
- Existing `RELEASES` and `USERS` KV binding names and subscriber key format are preserved.
- First-seen versions remain quiet baselines; later version changes include the previous tag in notifications.
- GitHub API requests optionally use the `GITHUB_TOKEN` Worker secret.

## Reliability

- Each repository is processed independently; one missing repo or API failure does not block other repositories.
- Metadata failures are tracked separately from release state.
- Daily snapshots are deduplicated by UTC date.
- Legacy installations keep their existing release tags and subscriber KV keys; missing history is backfilled once instead of triggering a repeated scan.
- History and daily stats have explicit retention bounds.
