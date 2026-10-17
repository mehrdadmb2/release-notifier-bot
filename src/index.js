/**
 * GitHub Release Watcher — Cloudflare Worker
 *
 * Features:
 * - Monitors multiple GitHub repositories for stable published releases.
 * - Sends formatted Telegram notifications with safe HTML, quotes, inline code,
 *   direct release/download links, and inline keyboard buttons.
 * - Supports /start, /help, /stop, /repos, /latest, /status and admin-only /check.
 * - Uses KV to persist users, release state, and last-check status.
 * - Provides a read-only JSON endpoint for the companion GitHub Pages dashboard.
 * - Verifies Telegram webhook secret tokens when configured.
 */

const DEFAULT_REPOS = [
  '2dust/v2rayN',
  '2dust/v2rayNG',
  'diegosouzapw/OmniRoute',
  'WhiteDNS/WhiteDNS-Android',
  'shirokhorshid/shirokhorshid-android',
  'KNG7-P/Se7en-Pro',
  'therealaleph/MasterHttpRelayVPN-RUST',
  'anonvector/SlipNet',
];

const SERVICE_NAME = 'GitHub Release Watcher';
const API_TIMEOUT_MS = 10_000;
const TELEGRAM_TEXT_LIMIT = 4096;
const MAX_RELEASE_NOTE_LENGTH = 1_150;
const MAX_ASSETS_IN_MESSAGE = 5;

class NoPublishedReleaseError extends Error {
  constructor(repo) {
    super(`No published stable release exists for ${repo}.`);
    this.name = 'NoPublishedReleaseError';
    this.repo = repo;
  }
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(checkAllRepos(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    try {
      if (path === '/webhook') {
        if (request.method !== 'POST') {
          return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
        }
        if (env.TELEGRAM_WEBHOOK_SECRET) {
          const supplied = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
          if (!timingSafeEqual(supplied, env.TELEGRAM_WEBHOOK_SECRET)) {
            return new Response('Unauthorized', { status: 401 });
          }
        }
        const update = await request.json();
        ctx.waitUntil(handleTelegramUpdate(update, env));
        return new Response('OK', { status: 200 });
      }

      if (path === '/setwebhook') {
        if (request.method !== 'POST') {
          return jsonResponse({ ok: false, error: 'Use POST with the X-Setup-Secret header.' }, 405);
        }
        if (!env.SET_WEBHOOK_SECRET) {
          return jsonResponse({
            ok: false,
            error: 'Set the SET_WEBHOOK_SECRET Worker secret before configuring the webhook.',
          }, 503);
        }
        const supplied = request.headers.get('X-Setup-Secret') || '';
        if (!timingSafeEqual(supplied, env.SET_WEBHOOK_SECRET)) {
          return jsonResponse({ ok: false, error: 'Unauthorized.' }, 401);
        }
        const result = await configureTelegramWebhook(url, env);
        return jsonResponse({ ok: true, result });
      }

      if (path === '/check') {
        if (request.method !== 'POST') {
          return jsonResponse({ ok: false, error: 'Use POST with the X-Check-Secret header.' }, 405);
        }
        if (!env.CHECK_SECRET) {
          return jsonResponse({
            ok: false,
            error: 'Set the CHECK_SECRET Worker secret to enable authenticated manual checks.',
          }, 503);
        }
        const supplied = request.headers.get('X-Check-Secret') || '';
        if (!timingSafeEqual(supplied, env.CHECK_SECRET)) {
          return jsonResponse({ ok: false, error: 'Unauthorized.' }, 401);
        }
        const summary = await checkAllRepos(env);
        return jsonResponse({ ok: true, ...summary });
      }

      if (path === '/health' || path === '/api/health') {
        return withCors(request, env, jsonResponse({
          ok: true,
          service: SERVICE_NAME,
          checkedAt: new Date().toISOString(),
          repositoryCount: getRepos(env).length,
          scheduledCron: '0 * * * *',
        }));
      }

      if (path === '/api/overview') {
        if (request.method === 'OPTIONS') return corsPreflight(request, env);
        if (request.method !== 'GET') {
          return withCors(request, env, jsonResponse({ ok: false, error: 'Method Not Allowed' }, 405));
        }
        const overview = await buildOverview(env);
        return withCors(request, env, jsonResponse(overview, 200, {
          'Cache-Control': 'public, max-age=45, stale-while-revalidate=120',
        }));
      }

      if (path === '/robots.txt') {
        return new Response('User-agent: *\nAllow: /\n', {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      if (path === '/favicon.ico') return new Response(null, { status: 204 });

      return new Response(buildWorkerLanding(env, url), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'",
        },
      });
    } catch (error) {
      console.error('Unhandled Worker error:', error?.stack || error?.message || String(error));
      const isApi = path.startsWith('/api/') || path === '/health' || path === '/setwebhook' || path === '/check';
      if (isApi) return withCors(request, env, jsonResponse({ ok: false, error: 'Internal server error.' }, 500));
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};

// -----------------------------------------------------------------------------
// Configuration and small utilities
// -----------------------------------------------------------------------------

function normalizePath(path) {
  if (path.length > 1) return path.replace(/\/+$/, '');
  return path;
}

function getRepos(env) {
  const configured = typeof env.REPOS === 'string'
    ? env.REPOS.split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  const repos = configured.length ? configured : DEFAULT_REPOS;
  return [...new Set(repos.filter(isValidRepo))];
}

function isValidRepo(repo) {
  return typeof repo === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
}

function parseRepoArgument(input) {
  let value = (input || '').trim();
  value = value.replace(/^https?:\/\/(?:www\.)?github\.com\//i, '');
  value = value.replace(/\.git$/i, '').replace(/\/+$/, '');
  value = value.replace(/\/(?:releases|tags)(?:\/.*)?$/i, '');
  const pieces = value.split('/').filter(Boolean);
  if (pieces.length !== 2) return null;
  const repo = `${pieces[0]}/${pieces[1]}`;
  return isValidRepo(repo) ? repo : null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#039;/g, "'")
    .replace(/&amp;/g, '&');
}

function htmlToPlainText(html) {
  return String(html ?? '')
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<blockquote(?:\s+expandable)?>([\s\S]*?)<\/blockquote>/gi, (_match, text) =>
      text.split('\n').map((line) => `❯ ${line}`).join('\n'))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n')
    .replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<pre(?:\s[^>]*)?>([\s\S]*?)<\/pre>/gi, '\n$1\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateText(value, limit) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function dateLabel(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return `${new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false,
  }).format(date)} UTC`;
}

function safeHttpsUrl(value, fallback) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.href : fallback;
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timingSafeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) diff |= (a[i % (a.length || 1)] || 0) ^ (b[i % (b.length || 1)] || 0);
  return diff === 0;
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...extraHeaders },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = env.PUBLIC_SITE_ORIGIN || 'https://mehrdadmb2.github.io';
  return {
    'Access-Control-Allow-Origin': origin === allowed ? allowed : allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function withCors(request, env, response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function corsPreflight(request, env) {
  return withCors(request, env, new Response(null, { status: 204 }));
}

function getReleaseKey(repo) {
  return `release:${repo}`;
}

function getCheckKey(repo) {
  return `check:${repo}`;
}

function parseStoredRelease(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.tag === 'string') return parsed;
  } catch { /* Older versions stored only the tag name. */ }
  return { tag: raw, htmlUrl: '', publishedAt: '', name: '' };
}

function parseCheckState(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

async function requireKv(env) {
  if (!env.RELEASES || !env.USERS) {
    throw new Error('Missing KV bindings. Configure RELEASES and USERS in wrangler.toml before deploying.');
  }
}

async function listAllKeys(namespace) {
  const keys = [];
  let cursor;
  do {
    const page = await namespace.list(cursor ? { cursor } : {});
    keys.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

async function countUsers(env) {
  if (!env.USERS) return 0;
  try {
    return (await listAllKeys(env.USERS)).length;
  } catch (error) {
    console.warn('Could not count registered users:', error?.message || error);
    return 0;
  }
}

// -----------------------------------------------------------------------------
// GitHub API
// -----------------------------------------------------------------------------

async function githubRequest(url, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('GitHub request timed out'), API_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Release-Notifier-Bot/4.0 (Cloudflare Workers)',
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.status === 404) return { notFound: true, data: null };
      if (response.status === 403 || response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After') || 0);
        const reset = Number(response.headers.get('X-RateLimit-Reset') || 0);
        const remaining = response.headers.get('X-RateLimit-Remaining');
        if (attempt < retries && (retryAfter > 0 || remaining === '0')) {
          const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.max(500, Math.min(3000, reset * 1000 - Date.now()));
          await sleep(waitMs);
          continue;
        }
      }
      if (!response.ok) {
        const detail = truncateText(await response.text(), 220);
        throw new Error(`GitHub API ${response.status}: ${detail}`);
      }
      return { notFound: false, data: await response.json() };
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(500 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`GitHub API request failed: ${lastError?.message || 'unknown error'}`);
}

async function getLatestRelease(repo) {
  if (!isValidRepo(repo)) throw new Error('Repository must use the owner/repo format.');
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(repo.split('/')[0])}/${encodeURIComponent(repo.split('/')[1])}/releases/latest`;
  const result = await githubRequest(endpoint);
  if (result.notFound || !result.data || result.data.draft) throw new NoPublishedReleaseError(repo);
  return result.data;
}

function releaseStateFromApi(release) {
  return {
    tag: String(release.tag_name || 'untagged'),
    name: String(release.name || ''),
    htmlUrl: safeHttpsUrl(release.html_url, ''),
    publishedAt: release.published_at || release.created_at || '',
    releaseId: Number(release.id || 0),
    prerelease: Boolean(release.prerelease),
  };
}

// -----------------------------------------------------------------------------
// Telegram API and formatted messages
// -----------------------------------------------------------------------------

async function telegramCall(token, method, payload, canRetry429 = true) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('Telegram request timed out'), API_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      const retryAfter = Number(result?.parameters?.retry_after || 0);
      if (canRetry429 && (response.status === 429 || result?.error_code === 429) && retryAfter > 0) {
        await sleep(Math.min(retryAfter * 1000, 5000));
        return telegramCall(token, method, payload, false);
      }
      const error = new Error(result?.description || `Telegram API ${response.status}`);
      error.telegramErrorCode = result?.error_code || response.status;
      throw error;
    }
    return result.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendTelegramMessage(token, chatId, text, extra = {}) {
  const htmlText = String(text ?? '').slice(0, TELEGRAM_TEXT_LIMIT);
  const payload = {
    chat_id: chatId,
    text: htmlText,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  };
  try {
    return await telegramCall(token, 'sendMessage', payload);
  } catch (error) {
    if (/can't parse entities|parse entities|unsupported start tag|unsupported end tag/i.test(error.message || '')) {
      console.warn(`Telegram rejected HTML for chat ${chatId}; retrying as plain text.`);
      try {
        const plainPayload = { ...payload, text: htmlToPlainText(htmlText).slice(0, TELEGRAM_TEXT_LIMIT) };
        delete plainPayload.parse_mode;
        return await telegramCall(token, 'sendMessage', plainPayload);
      } catch (fallbackError) {
        console.error(`Plain-text Telegram fallback failed for ${chatId}:`, fallbackError.message);
        return null;
      }
    }
    console.error(`Telegram send failed for ${chatId}:`, error.message);
    return null;
  }
}

function releaseKeyboard(repo, release) {
  const repoUrl = `https://github.com/${repo}`;
  const releaseUrl = safeHttpsUrl(release.html_url, `${repoUrl}/releases`);
  const rows = [[
    { text: '🚀 Open release', url: releaseUrl },
    { text: '📂 Repository', url: repoUrl },
  ]];
  if (Array.isArray(release.assets) && release.assets.length > 0) {
    const firstAsset = release.assets.find((asset) => asset && asset.browser_download_url);
    if (firstAsset) rows.push([{ text: '⬇️ Download latest asset', url: safeHttpsUrl(firstAsset.browser_download_url, releaseUrl) }]);
  }
  return { inline_keyboard: rows };
}

function buildReleaseMessage(repo, release) {
  const tag = release.tag_name || 'untagged';
  const repoUrl = `https://github.com/${repo}`;
  const releaseUrl = safeHttpsUrl(release.html_url, `${repoUrl}/releases`);
  const published = dateLabel(release.published_at || release.created_at);
  const releaseName = truncateText(release.name || tag, 140);
  const notes = truncateText(release.body || '', MAX_RELEASE_NOTE_LENGTH);
  const lines = [
    '🚀 <b>NEW GITHUB RELEASE</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    `📦 <b>Repository</b>  <a href="${escapeHtml(repoUrl)}">${escapeHtml(repo)}</a>`,
    `🏷️ <b>Version</b>  <code>${escapeHtml(tag)}</code>`,
    `📝 <b>Release</b>  ${escapeHtml(releaseName)}`,
    `📅 <b>Published</b>  <code>${escapeHtml(published)}</code>`,
    `🧭 <b>Channel</b>  ${release.prerelease ? 'Pre-release' : 'Stable release'}`,
    '━━━━━━━━━━━━━━━━━━━━━━',
  ];

  if (notes) {
    lines.push('💬 <b>Release notes</b>');
    lines.push(`<blockquote>${escapeHtml(notes)}</blockquote>`);
  } else {
    lines.push('💬 <i>No release notes were provided.</i>');
  }

  const assets = Array.isArray(release.assets) ? release.assets.filter((asset) => asset && asset.browser_download_url) : [];
  lines.push('', `📎 <b>Downloads</b>  <code>${assets.length}</code> asset${assets.length === 1 ? '' : 's'}`);
  if (assets.length) {
    for (const asset of assets.slice(0, MAX_ASSETS_IN_MESSAGE)) {
      const size = `${(Number(asset.size || 0) / 1024 / 1024).toFixed(2)} MB`;
      const label = truncateText(asset.name || 'Download', 48);
      lines.push(`• <a href="${escapeHtml(safeHttpsUrl(asset.browser_download_url, releaseUrl))}">${escapeHtml(label)}</a> <code>${size}</code>`);
    }
    if (assets.length > MAX_ASSETS_IN_MESSAGE) {
      lines.push(`• <i>and ${assets.length - MAX_ASSETS_IN_MESSAGE} more asset(s)</i>`);
    }
  } else {
    lines.push('• No downloadable assets attached.');
  }

  lines.push('', `🔗 <a href="${escapeHtml(releaseUrl)}"><b>View full release on GitHub</b></a>`);
  let message = lines.join('\n');
  if (message.length > TELEGRAM_TEXT_LIMIT) {
    const maxNotes = 350;
    const shorterNotes = truncateText(release.body || '', maxNotes);
    message = lines.filter((line) => !line.startsWith('<blockquote>')).join('\n');
    if (shorterNotes) {
      const insertion = message.indexOf('💬 <b>Release notes</b>');
      if (insertion >= 0) {
        const before = message.slice(0, insertion + '💬 <b>Release notes</b>'.length);
        const after = message.slice(insertion + '💬 <b>Release notes</b>'.length);
        message = `${before}\n<blockquote>${escapeHtml(shorterNotes)}</blockquote>${after}`;
      }
    }
    message = message.slice(0, TELEGRAM_TEXT_LIMIT - 8).trimEnd();
  }
  return message;
}

async function buildSingleLatestResponse(repo) {
  try {
    const release = await getLatestRelease(repo);
    const message = buildReleaseMessage(repo, release).replace('🚀 <b>NEW GITHUB RELEASE</b>', '📡 <b>LATEST RELEASE SNAPSHOT</b>');
    return { message, keyboard: releaseKeyboard(repo, release) };
  } catch (error) {
    if (error instanceof NoPublishedReleaseError) {
      return {
        message: [
          '📭 <b>NO STABLE RELEASE FOUND</b>',
          '━━━━━━━━━━━━━━━━━━━━━━',
          `📦 <b>Repository</b>  <code>${escapeHtml(repo)}</code>`,
          '',
          'This repository does not currently expose a published stable release through GitHub Releases.',
          `🔗 <a href="https://github.com/${escapeHtml(repo)}/releases">Open releases page</a>`,
        ].join('\n'),
        keyboard: { inline_keyboard: [[{ text: '📂 Open repository', url: `https://github.com/${repo}` }]] },
      };
    }
    return {
      message: `⚠️ <b>Could not fetch release data</b>\n\n📦 <code>${escapeHtml(repo)}</code>\n<blockquote>${escapeHtml(truncateText(error.message, 240))}</blockquote>`,
      keyboard: { inline_keyboard: [[{ text: '📂 Open repository', url: `https://github.com/${repo}` }]] },
    };
  }
}

async function buildAllLatestResponse(env) {
  const repos = getRepos(env);
  const summaries = await Promise.all(repos.map(async (repo) => {
    try {
      const release = await getLatestRelease(repo);
      const state = releaseStateFromApi(release);
      return [
        `📦 <a href="https://github.com/${escapeHtml(repo)}"><b>${escapeHtml(repo)}</b></a>`,
        `   🏷 <code>${escapeHtml(state.tag)}</code>  ·  ${escapeHtml(dateLabel(state.publishedAt))}`,
        `   🔗 <a href="${escapeHtml(state.htmlUrl || `https://github.com/${repo}/releases`)}">Open release</a>`,
      ].join('\n');
    } catch (error) {
      if (error instanceof NoPublishedReleaseError) {
        return `📦 <a href="https://github.com/${escapeHtml(repo)}"><b>${escapeHtml(repo)}</b></a>\n   📭 <i>No stable release found</i> · <a href="https://github.com/${escapeHtml(repo)}/releases">Releases</a>`;
      }
      return `📦 <code>${escapeHtml(repo)}</code>\n   ⚠️ <i>Could not fetch right now</i>`;
    }
  }));
  const output = [
    '🛰️ <b>WATCHTOWER · LATEST RELEASES</b>',
    '<i>Live snapshot from GitHub Releases</i>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    ...summaries.flatMap((item, index) => index === 0 ? [item] : ['', '────────────────────', item]),
    '',
    `🗂 <b>Monitored repositories:</b> <code>${repos.length}</code>`,
  ].join('\n');
  return output.slice(0, TELEGRAM_TEXT_LIMIT - 8);
}

function buildHelpMessage() {
  return [
    '🛰️ <b>RELEASE WATCHER · COMMAND CENTER</b>',
    '<i>Track releases without checking every repository manually.</i>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    '🧭 <b>Available commands</b>',
    '<code>/start</code>  — Register for release alerts',
    '<code>/help</code>  — Show this command guide',
    '<code>/repos</code>  — List watched repositories',
    '<code>/latest</code>  — Latest releases across all repositories',
    '<code>/latest owner/repo</code>  — Full details for one repository',
    '<code>/status</code>  — Service and subscription status',
    '<code>/stop</code>  — Unsubscribe from alerts',
    '━━━━━━━━━━━━━━━━━━━━━━',
    '🔔 New releases are checked automatically every hour.',
    '💡 Tip: send a repository link after <code>/latest</code> or use <code>owner/repo</code>.',
  ].join('\n');
}

// -----------------------------------------------------------------------------
// Users, monitoring, and dashboard API
// -----------------------------------------------------------------------------

async function broadcastToAllUsers(env, message, extra = {}) {
  if (!env.USERS) throw new Error('USERS KV binding is missing.');
  const users = await listAllKeys(env.USERS);
  if (!users.length) {
    console.log('No registered users; release state was saved without broadcasting.');
    return { total: 0, succeeded: 0, failed: 0 };
  }
  let succeeded = 0;
  let failed = 0;
  for (const user of users) {
    const sent = await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, user.name, message, extra);
    if (sent) succeeded += 1;
    else failed += 1;
    // Leave room for Telegram's per-chat and global messaging limits.
    await sleep(45);
  }
  console.log(`Broadcast completed: ${succeeded} succeeded, ${failed} failed, ${users.length} total.`);
  return { total: users.length, succeeded, failed };
}

async function checkAllRepos(env) {
  await requireKv(env);
  const repos = getRepos(env);
  if (!repos.length) throw new Error('No valid repositories are configured in REPOS.');

  const summary = { checked: 0, changed: 0, noRelease: 0, failed: 0, notifiedUsers: 0, repositories: [] };
  const changedReleases = [];
  for (const repo of repos) {
    const now = new Date().toISOString();
    const priorCheck = parseCheckState(await env.RELEASES.get(getCheckKey(repo)));
    try {
      console.log(`Checking ${repo}…`);
      const release = await getLatestRelease(repo);
      const newState = releaseStateFromApi(release);
      const rawExisting = await env.RELEASES.get(getReleaseKey(repo));
      const existing = parseStoredRelease(rawExisting);
      const wasKnownNoRelease = priorCheck?.status === 'no-release';
      const firstSeen = !existing;
      const changed = Boolean(existing && existing.tag !== newState.tag);

      const legacyValueNeedsMigration = Boolean(rawExisting && !rawExisting.trimStart().startsWith('{'));
      if (firstSeen || changed || legacyValueNeedsMigration) {
        // Migrate legacy plain-tag values without triggering a notification.
        await env.RELEASES.put(getReleaseKey(repo), JSON.stringify(newState));
      }
      await env.RELEASES.put(getCheckKey(repo), JSON.stringify({ checkedAt: now, status: 'ok' }));
      summary.checked += 1;

      const shouldNotifyFirstSeen = String(env.NOTIFY_ON_FIRST_SEEN || 'false').toLowerCase() === 'true';
      if (changed || (firstSeen && (wasKnownNoRelease || shouldNotifyFirstSeen))) {
        changedReleases.push({ repo, release });
        summary.changed += 1;
        console.log(`New release detected: ${repo} ${newState.tag}`);
      } else if (firstSeen) {
        console.log(`Initialized release baseline for ${repo}: ${newState.tag} (no old-release alert).`);
      } else {
        console.log(`No new release: ${repo} ${newState.tag}`);
      }
      summary.repositories.push({ repo, status: changed ? 'updated' : (firstSeen ? 'initialized' : 'ok'), tag: newState.tag });
    } catch (error) {
      if (error instanceof NoPublishedReleaseError) {
        await env.RELEASES.put(getCheckKey(repo), JSON.stringify({ checkedAt: now, status: 'no-release' }));
        summary.checked += 1;
        summary.noRelease += 1;
        summary.repositories.push({ repo, status: 'no-release' });
        console.log(`No stable release published for ${repo}.`);
      } else {
        await env.RELEASES.put(getCheckKey(repo), JSON.stringify({ checkedAt: now, status: 'error' })).catch(() => {});
        summary.failed += 1;
        summary.repositories.push({ repo, status: 'error' });
        console.error(`Repository check failed for ${repo}:`, error?.message || error);
      }
    }
  }

  for (const item of changedReleases) {
    const message = buildReleaseMessage(item.repo, item.release);
    const result = await broadcastToAllUsers(env, message, { reply_markup: releaseKeyboard(item.repo, item.release) });
    summary.notifiedUsers += result.succeeded;
  }

  summary.finishedAt = new Date().toISOString();
  console.log('Check summary:', JSON.stringify(summary));
  return summary;
}

async function buildOverview(env) {
  await requireKv(env);
  const repos = getRepos(env);
  const repositoryData = await Promise.all(repos.map(async (repo) => {
    const [rawRelease, rawCheck] = await Promise.all([
      env.RELEASES.get(getReleaseKey(repo)),
      env.RELEASES.get(getCheckKey(repo)),
    ]);
    const release = parseStoredRelease(rawRelease);
    const check = parseCheckState(rawCheck);
    return {
      fullName: repo,
      url: `https://github.com/${repo}`,
      releasesUrl: `https://github.com/${repo}/releases`,
      latestTag: release?.tag || null,
      releaseName: release?.name || null,
      publishedAt: release?.publishedAt || null,
      releaseUrl: release?.htmlUrl || null,
      lastChecked: check?.checkedAt || null,
      state: check?.status || (release ? 'ok' : 'pending'),
    };
  }));
  const users = await countUsers(env);
  const checkedTimes = repositoryData.map((repo) => repo.lastChecked).filter(Boolean).sort();
  return {
    ok: true,
    service: SERVICE_NAME,
    version: '4.0.0',
    generatedAt: new Date().toISOString(),
    lastChecked: checkedTimes.at(-1) || null,
    userCount: users,
    repositoryCount: repositoryData.length,
    releaseCount: repositoryData.filter((repo) => repo.latestTag).length,
    repositories: repositoryData,
  };
}

// -----------------------------------------------------------------------------
// Telegram update and command handling
// -----------------------------------------------------------------------------

function parseCommand(text) {
  if (!text) return { cmd: '', args: '' };
  const parts = text.trim().split(/\s+/);
  const first = parts.shift() || '';
  const cmd = first.includes('@') ? first.split('@')[0] : first;
  return { cmd: cmd.toLowerCase(), args: parts.join(' ').trim() };
}

async function handleTelegramUpdate(update, env) {
  const message = update?.message;
  if (!message || message.from?.is_bot) return;
  const chatId = message.chat?.id;
  if (chatId === undefined || chatId === null) return;
  const rawText = String(message.text || message.caption || '').trim();
  if (!rawText.startsWith('/')) return;

  const { cmd, args } = parseCommand(rawText);
  const chatKey = String(chatId);
  console.log(`Telegram command ${cmd} from chat ${chatKey}.`);

  try {
    if (cmd === '/start') {
      await env.USERS.put(chatKey, JSON.stringify({
        status: 'active',
        chatType: message.chat?.type || 'unknown',
        username: message.from?.username || null,
        firstName: message.from?.first_name || null,
        registeredAt: new Date().toISOString(),
      }));
      const repos = getRepos(env);
      const repoList = repos.map((repo, index) => `${index + 1}. <a href="https://github.com/${escapeHtml(repo)}"><code>${escapeHtml(repo)}</code></a>`).join('\n');
      const welcome = [
        '👋 <b>WELCOME TO RELEASE WATCHER</b>',
        '<i>Your compact command center for GitHub releases.</i>',
        '━━━━━━━━━━━━━━━━━━━━━━',
        `✅ <b>Subscription:</b> <code>ACTIVE</code>`,
        `📡 <b>Tracked repositories:</b> <code>${repos.length}</code>`,
        '',
        '<b>Watching now</b>',
        repoList,
        '',
        '⏱ <b>Automatic checks:</b> every hour',
        '',
        'Use <code>/help</code> to explore commands, or <code>/latest</code> to see current releases.',
      ].join('\n');
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, welcome);
      return;
    }

    if (cmd === '/help') {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, buildHelpMessage());
      return;
    }

    if (cmd === '/stop') {
      await env.USERS.delete(chatKey);
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, [
        '🔕 <b>NOTIFICATIONS PAUSED</b>',
        '',
        'You have been unsubscribed from release alerts.',
        'Send <code>/start</code> whenever you want to subscribe again.',
      ].join('\n'));
      return;
    }

    if (cmd === '/repos') {
      const repos = getRepos(env);
      const lines = ['🗂 <b>YOUR WATCHLIST</b>', '<i>Release state from the last Worker check</i>', '━━━━━━━━━━━━━━━━━━━━━━'];
      for (const repo of repos) {
        const [rawRelease, rawCheck] = await Promise.all([
          env.RELEASES.get(getReleaseKey(repo)),
          env.RELEASES.get(getCheckKey(repo)),
        ]);
        const release = parseStoredRelease(rawRelease);
        const check = parseCheckState(rawCheck);
        const statusText = check?.status === 'error'
          ? '⚠️ check failed'
          : check?.status === 'no-release'
            ? '📭 no stable release'
            : release?.tag
              ? `🏷 <code>${escapeHtml(release.tag)}</code>`
              : '🕓 waiting for first check';
        lines.push('', `📦 <a href="https://github.com/${escapeHtml(repo)}"><b>${escapeHtml(repo)}</b></a>`, `   ${statusText}`);
        if (check?.checkedAt) lines.push(`   <i>Checked: ${escapeHtml(dateLabel(check.checkedAt))}</i>`);
      }
      lines.push('', '💡 Use <code>/latest owner/repo</code> for live release details.');
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, lines.join('\n').slice(0, TELEGRAM_TEXT_LIMIT - 8));
      return;
    }

    if (cmd === '/latest') {
      if (!args) {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, await buildAllLatestResponse(env));
        return;
      }
      const repo = parseRepoArgument(args);
      if (!repo) {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
          '⚠️ <b>Repository format not recognized.</b>\n\nUse <code>/latest owner/repo</code> or send a GitHub repository URL.');
        return;
      }
      const latest = await buildSingleLatestResponse(repo);
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, latest.message, { reply_markup: latest.keyboard });
      return;
    }

    if (cmd === '/status') {
      const [users, overview] = await Promise.all([countUsers(env), buildOverview(env)]);
      const latestCheck = overview.lastChecked ? dateLabel(overview.lastChecked) : 'Not checked yet';
      const errors = overview.repositories.filter((repo) => repo.state === 'error').length;
      const noRelease = overview.repositories.filter((repo) => repo.state === 'no-release').length;
      const status = [
        '🧪 <b>SYSTEM STATUS</b>',
        '━━━━━━━━━━━━━━━━━━━━━━',
        '🟢 <b>Worker:</b> <code>OPERATIONAL</code>',
        `👥 <b>Subscribed chats:</b> <code>${users}</code>`,
        `📦 <b>Monitored repositories:</b> <code>${overview.repositoryCount}</code>`,
        `🏷️ <b>Known latest releases:</b> <code>${overview.releaseCount}</code>`,
        `📭 <b>No stable release:</b> <code>${noRelease}</code>`,
        `⚠️ <b>Last-check errors:</b> <code>${errors}</code>`,
        `🕓 <b>Last activity:</b> <code>${escapeHtml(latestCheck)}</code>`,
        '⏱ <b>Schedule:</b> every hour',
        '━━━━━━━━━━━━━━━━━━━━━━',
        'Use <code>/repos</code> for the full watchlist.',
      ].join('\n');
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, status);
      return;
    }

    if (cmd === '/check') {
      const allowed = String(env.ADMIN_CHAT_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
      if (!allowed.includes(chatKey)) {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
          '🔒 <b>Admin command</b>\n\nManual checks are restricted. Automatic checks continue on schedule.');
        return;
      }
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '🔄 <b>Manual check started</b>\n\nI am checking the configured repositories now.');
      const summary = await checkAllRepos(env);
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
        `✅ <b>Check complete</b>\n\n📦 Checked: <code>${summary.checked}</code>\n🚀 New releases: <code>${summary.changed}</code>\n⚠️ Failed: <code>${summary.failed}</code>`);
      return;
    }

    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '❔ <b>Command not recognized.</b>\n\nUse <code>/help</code> to see available commands.');
  } catch (error) {
    console.error(`Command ${cmd} failed for ${chatKey}:`, error?.stack || error?.message || error);
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '⚠️ <b>Something went wrong.</b>\n\nThe problem has been logged. Please try again in a moment.');
  }
}

async function configureTelegramWebhook(workerUrl, env) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN secret is missing.');
  const webhookUrl = `${workerUrl.origin}/webhook`;
  const payload = { url: webhookUrl, allowed_updates: ['message'], drop_pending_updates: false };
  if (env.TELEGRAM_WEBHOOK_SECRET) payload.secret_token = env.TELEGRAM_WEBHOOK_SECRET;
  const webhook = await telegramCall(env.TELEGRAM_BOT_TOKEN, 'setWebhook', payload);
  const commands = [
    { command: 'start', description: 'Subscribe and show the watchlist' },
    { command: 'help', description: 'Show available commands' },
    { command: 'repos', description: 'List watched repositories' },
    { command: 'latest', description: 'Show latest releases' },
    { command: 'status', description: 'Show bot status' },
    { command: 'stop', description: 'Unsubscribe from release alerts' },
  ];
  const menu = await telegramCall(env.TELEGRAM_BOT_TOKEN, 'setMyCommands', { commands });
  return { webhook, commands: menu, webhookUrl };
}

// -----------------------------------------------------------------------------
// Worker landing page
// -----------------------------------------------------------------------------

function buildWorkerLanding(env, requestUrl) {
  const siteUrl = safeHttpsUrl(env.PUBLIC_SITE_URL || 'https://mehrdadmb2.github.io/release-notifier-bot/', 'https://github.com/mehrdadmb2/release-notifier-bot');
  const repoCount = getRepos(env).length;
  const host = escapeHtml(requestUrl.host);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Release Watcher · Worker Status</title>
<style>
:root{color-scheme:dark;--bg:#070b16;--panel:#10182b;--line:rgba(166,190,255,.16);--text:#eef3ff;--muted:#9aa9c8;--cyan:#55e6ff;--violet:#a78bfa}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 20% 15%,#162a4d 0,transparent 44%),radial-gradient(ellipse at 90% 85%,#272053 0,transparent 42%),var(--bg);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--text)}main{max-width:740px;width:100%;padding:clamp(24px,5vw,48px);border:1px solid var(--line);border-radius:30px;background:linear-gradient(135deg,rgba(22,34,59,.94),rgba(12,17,32,.86));box-shadow:0 35px 100px #0008,inset 0 1px #ffffff0c;position:relative;overflow:hidden}main:before{content:"";position:absolute;right:-100px;top:-100px;width:280px;height:280px;border-radius:50%;background:var(--cyan);filter:blur(100px);opacity:.15;pointer-events:none}.mark{width:64px;height:64px;display:grid;place-items:center;border:1px solid #55e6ff55;border-radius:20px;background:linear-gradient(135deg,#55e6ff24,#a78bfa23);font-size:30px}.eyebrow{margin:22px 0 8px;color:var(--cyan);font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase}h1{font-size:clamp(32px,6vw,54px);line-height:1.05;letter-spacing:-.05em;margin:0}p{color:var(--muted);max-width:570px}.pill{display:inline-flex;align-items:center;gap:9px;margin-top:16px;border:1px solid #52f2af40;background:#40dfa912;border-radius:99px;padding:7px 12px;color:#83f6c3;font-weight:700;font-size:13px}.dot{width:7px;height:7px;border-radius:50%;background:#59f0ad;box-shadow:0 0 12px #59f0ad}.stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:28px 0}.stat{padding:17px;border:1px solid var(--line);border-radius:17px;background:#ffffff04}.stat b{font-size:24px;display:block}.stat span{font-size:12px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase}.actions{display:flex;gap:12px;flex-wrap:wrap}.actions a{color:var(--text);text-decoration:none;padding:12px 16px;border:1px solid var(--line);border-radius:13px;background:#ffffff08;font-weight:700}.actions a.primary{background:linear-gradient(110deg,#55e6ff,#a78bfa);border:0;color:#07111e}.foot{font-size:12px;margin-top:28px;color:#7888a8}@media(max-width:500px){main{border-radius:22px}.stats{grid-template-columns:1fr 1fr}.actions a{flex:1;text-align:center}}
</style></head><body><main><div class="mark">🛰️</div><div class="eyebrow">Cloudflare edge service</div><h1>Release Watcher<br>is online.</h1><p>The Worker endpoint is responding. Scheduled checks monitor your configured GitHub repositories and deliver release alerts through Telegram.</p><div class="pill"><span class="dot"></span> Worker response healthy</div><div class="stats"><div class="stat"><b>${repoCount}</b><span>Configured repositories</span></div><div class="stat"><b>60 min</b><span>Scheduled interval</span></div></div><div class="actions"><a class="primary" href="${escapeHtml(siteUrl)}">Open dashboard ↗</a><a href="https://github.com/mehrdadmb2/release-notifier-bot">Source code ↗</a><a href="/health">Health JSON ↗</a></div><div class="foot">${host} · GitHub Release Watcher v4.0.0 · Do not share setup secrets.</div></main></body></html>`;
}
