# Release Watcher v4.1.0

## Detailed Telegram release messages

- Convert common GitHub Markdown release notes into Telegram-compatible HTML: headings, ordered/unordered lists, links, inline code, fenced code blocks, quotes, strikethrough, and table-like rows.
- Keep the full UTC publication timestamp, release title/tag, stable/pre-release indicator, asset count, combined download size, and direct asset links.
- Show up to 12 individual download links and direct users to the full GitHub release for any remaining assets.
- Raise the visible changelog safety cap to 6,500 characters and add an explicit note when it is reached.
- Split long output into separate Telegram messages without cutting a tag/entity; add inline action buttons to the final message and pace multi-part sends.
- Enrich `/latest` (all repositories) with release title, exact timestamp, short changelog preview, asset count, and a direct release link.
- Add tests for Markdown rendering, entity nesting, message-length limits, long changelogs, asset summaries, and final-message keyboard placement.

The hourly Cron cadence and the existing `RELEASES` / `USERS` KV binding contract remain unchanged.
