import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

class MemoryKV {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  async get(key) { return this.values.has(key) ? this.values.get(key) : null; }
  async put(key, value) { this.values.set(key, String(value)); }
  async delete(key) { this.values.delete(key); }
  async list(options = {}) {
    const prefix = options.prefix || '';
    const keys = [...this.values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name }));
    return { keys, list_complete: true, cursor: undefined };
  }
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function assertValidTelegramHtml(html) {
  const allowed = new Set(['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'a', 'code', 'pre', 'blockquote']);
  const stack = [];
  for (const match of html.matchAll(/<\/?([a-zA-Z][\w-]*)\b[^>]*>/g)) {
    const token = match[0];
    const tag = match[1].toLowerCase();
    assert.ok(allowed.has(tag), `unsupported Telegram HTML tag: ${tag}`);
    if (token.startsWith('</')) {
      assert.equal(stack.pop(), tag, `unbalanced closing tag ${token}`);
      continue;
    }
    if (tag === 'pre') assert.equal(stack.length, 0, 'pre blocks cannot be nested');
    if (tag === 'code') {
      assert.ok(stack.length === 0 || (stack.length === 1 && stack[0] === 'pre'), 'code may only be standalone or directly inside pre');
    }
    if (tag === 'blockquote') assert.ok(!stack.some((parent) => ['a', 'code', 'pre', 'blockquote'].includes(parent)), 'blockquote entity nesting is not permitted');
    if (tag === 'a') assert.ok(!stack.some((parent) => ['a', 'code', 'pre', 'blockquote'].includes(parent)), 'link entity nesting is not permitted');
    if (['code', 'pre'].some((parent) => stack.includes(parent))) assert.ok(tag === 'code' && stack.at(-1) === 'pre', 'code/pre cannot contain other entities');
    stack.push(tag);
  }
  assert.equal(stack.length, 0, `unclosed Telegram HTML tags: ${stack.join(', ')}`);
}

const env = {
  REPOS: 'owner/project',
  CHECK_SECRET: 'test-check-secret',
  TELEGRAM_BOT_TOKEN: '123456:test-token',
  PUBLIC_SITE_ORIGIN: 'https://mehrdadmb2.github.io',
  NOTIFY_ON_FIRST_SEEN: 'false',
  RELEASES: new MemoryKV(),
  USERS: new MemoryKV({ '123456': 'active' }),
};
let currentTag = 'v1.0.0';
const telegramMessages = [];
const originalFetch = globalThis.fetch;

test('Worker stores a quiet baseline and notifies on a later release change', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  telegramMessages.length = 0;
  currentTag = 'v1.0.0';
  env.RELEASES = new MemoryKV();

  let githubCalls = 0;
  const makeRelease = (tag, id = 100) => ({
    id,
    tag_name: tag,
    name: `Release ${tag}`,
    html_url: `https://github.com/owner/project/releases/tag/${tag}`,
    published_at: '2026-10-17T10:30:00Z',
    created_at: '2026-10-17T10:30:00Z',
    updated_at: '2026-10-17T10:30:00Z',
    target_commitish: 'main',
    author: { login: 'release-maintainer' },
    draft: false,
    prerelease: false,
    body: [
      'Improved handling of <unsafe> input & output.',
      '',
      '### What is new',
      '- Faster startup and cleaner handling',
      '- Supports [pull request 123](https://github.com/owner/project/pull/123)',
      '',
      '1. Update subscriptions',
      '2. Test the connection',
      '',
      'Use `v2rayn://` to import a profile.',
      '',
      '> Compatibility note for existing users',
      '',
      '```json',
      '{',
      '  "Authorization": "Bearer test"',
      '}',
      '```',
    ].join('\n'),
    assets: [{ name: 'release.zip', size: 2048, browser_download_url: 'https://github.com/owner/project/releases/download/test/release.zip' }],
  });
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith('https://api.github.com/repos/')) {
      githubCalls += 1;
      if (url.endsWith('/releases?per_page=20')) return jsonResponse([makeRelease(currentTag, 100), makeRelease('v0.9.0', 90)]);
      if (url.endsWith('/releases/latest')) return jsonResponse(makeRelease(currentTag, currentTag === 'v1.0.0' ? 100 : 200));
      return jsonResponse({
        full_name: 'owner/project',
        description: 'Example repository metadata',
        html_url: 'https://github.com/owner/project',
        visibility: 'public',
        stargazers_count: 1234,
        forks_count: 120,
        subscribers_count: 31,
        open_issues_count: 7,
        size: 2048,
        default_branch: 'main',
        language: 'JavaScript',
        license: { spdx_id: 'MIT' },
        topics: ['release-monitoring', 'automation'],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2026-10-17T10:30:00Z',
        pushed_at: '2026-10-17T10:30:00Z',
      });
    }
    if (url.startsWith('https://api.telegram.org/')) {
      const payload = JSON.parse(init.body || '{}');
      telegramMessages.push({ url, payload });
      return jsonResponse({ ok: true, result: { message_id: telegramMessages.length, chat: { id: payload.chat_id }, text: payload.text } });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  const ctx = { waitUntil(promise) { Promise.resolve(promise).catch(() => {}); } };
  const first = await worker.fetch(new Request('https://worker.test/check', {
    method: 'POST', headers: { 'X-Check-Secret': env.CHECK_SECRET },
  }), env, ctx);
  const firstResult = await first.json();
  assert.equal(firstResult.ok, true);
  assert.equal(firstResult.changed, 0, 'first check should create a quiet baseline');
  assert.equal(firstResult.initialized, 1);
  assert.equal(telegramMessages.length, 0, 'baseline should not broadcast an old release');

  currentTag = 'v1.1.0';
  const second = await worker.fetch(new Request('https://worker.test/check', {
    method: 'POST', headers: { 'X-Check-Secret': env.CHECK_SECRET },
  }), env, ctx);
  const secondResult = await second.json();
  assert.equal(secondResult.ok, true);
  assert.equal(secondResult.changed, 1);
  assert.equal(telegramMessages.length, 1, 'release change should notify the subscribed chat');
  assert.equal(telegramMessages[0].payload.parse_mode, 'HTML');
  assert.match(telegramMessages[0].payload.text, /<code>v1\.1\.0<\/code>/);
  assert.match(telegramMessages[0].payload.text, /<blockquote>/);
  assert.match(telegramMessages[0].payload.text, /&lt;unsafe&gt; input &amp; output/);
  assert.match(telegramMessages[0].payload.text, /<b>What is new<\/b>/);
  assert.match(telegramMessages[0].payload.text, /<a href="https:\/\/github\.com\/owner\/project\/pull\/123">pull request 123<\/a>/);
  assert.match(telegramMessages[0].payload.text, /<code>1\.<\/code>/);
  assert.match(telegramMessages[0].payload.text, /<code>v2rayn:\/\//);
  assert.match(telegramMessages[0].payload.text, /<pre><code>/);
  assert.ok(telegramMessages[0].payload.reply_markup.inline_keyboard.length >= 1);

  const callsBeforeOverview = githubCalls;
  const overviewResponse = await worker.fetch(new Request('https://worker.test/api/overview', {
    headers: { Origin: env.PUBLIC_SITE_ORIGIN },
  }), env, ctx);
  assert.equal(githubCalls, callsBeforeOverview, '/api/overview must only read stored KV data');
  const overview = await overviewResponse.json();
  assert.equal(overview.ok, true);
  assert.equal(overview.repositories[0].latestTag, 'v1.1.0');
  assert.equal(overview.repositories[0].previousTag, 'v1.0.0');
  assert.equal(overview.repositories[0].description, 'Example repository metadata');
  assert.equal(overview.repositories[0].stars, 1234);
  assert.equal(overview.repositories[0].language, 'JavaScript');
  assert.equal(overview.repositories[0].history[0].previousTag, 'v1.0.0');
  assert.equal(overview.repositories[0].snapshots.length, 1);
  assert.equal(overview.repositoryCount, 1);
  assert.equal(overviewResponse.headers.get('Access-Control-Allow-Origin'), env.PUBLIC_SITE_ORIGIN);

  const githubCallsBeforeCachedRead = githubCalls;
  for (const command of ['/latest owner/project', '/repos', '/status']) {
    const pending = [];
    await worker.fetch(new Request('https://worker.test/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { chat: { id: 123456, type: 'private' }, from: { is_bot: false }, text: command } }),
    }), env, { waitUntil(promise) { pending.push(promise); } });
    await Promise.all(pending);
  }
  assert.equal(githubCalls, githubCallsBeforeCachedRead, '/latest, /repos, and /status must read KV and must not call GitHub');
  const latestMessage = telegramMessages.findLast(({ payload }) => payload.text.includes('LATEST STORED RELEASE'));
  assert.ok(latestMessage);
  assert.match(latestMessage.payload.text, /Previous version/);
  assert.match(latestMessage.payload.text, /v1\.0\.0/);
  assert.match(latestMessage.payload.text, /v1\.1\.0/);
});

test('migrates a legacy stored tag into version history and backfills the previous release', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  telegramMessages.length = 0;
  const migratedEnv = {
    ...env,
    REPOS: 'owner/legacy-project',
    RELEASES: new MemoryKV({ 'release:owner/legacy-project': 'v1.4.0' }),
    USERS: new MemoryKV(),
  };
  let previousReleaseCalls = 0;
  const makeRelease = (tag, id) => ({
    id,
    tag_name: tag,
    name: `Release ${tag}`,
    html_url: `https://github.com/owner/legacy-project/releases/tag/${tag}`,
    published_at: '2026-10-25T09:00:00Z',
    created_at: '2026-10-25T09:00:00Z',
    draft: false,
    prerelease: false,
    body: `Notes for ${tag}`,
    assets: [],
  });
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith('https://api.github.com/repos/')) {
      if (url.endsWith('/releases?per_page=20')) {
        previousReleaseCalls += 1;
        return jsonResponse([makeRelease('v1.4.0', 140), makeRelease('v1.3.0', 130)]);
      }
      if (url.endsWith('/releases/latest')) return jsonResponse(makeRelease('v1.4.0', 140));
      return jsonResponse({
        full_name: 'owner/legacy-project',
        description: 'Legacy project migrated without data loss',
        html_url: 'https://github.com/owner/legacy-project',
        visibility: 'public',
        stargazers_count: 42,
        forks_count: 4,
        watchers_count: 3,
        open_issues_count: 1,
        size: 512,
        default_branch: 'main',
        language: 'TypeScript',
        license: { spdx_id: 'MIT' },
        topics: ['migration'],
        created_at: '2022-01-01T00:00:00Z',
        updated_at: '2026-10-25T09:00:00Z',
        pushed_at: '2026-10-25T09:00:00Z',
      });
    }
    if (url.startsWith('https://api.telegram.org/')) return jsonResponse({ ok: true, result: { message_id: 1 } });
    throw new Error(`Unexpected fetch in migration test: ${url}`);
  };

  const ctx = { waitUntil(promise) { Promise.resolve(promise).catch(() => {}); } };
  const response = await worker.fetch(new Request('https://worker.test/check', {
    method: 'POST', headers: { 'X-Check-Secret': migratedEnv.CHECK_SECRET },
  }), migratedEnv, ctx);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.changed, 0, 'migrating an existing current tag must not send a new-release alert');
  assert.equal(previousReleaseCalls, 1, 'the legacy history backfill should happen only once');

  const overviewResponse = await worker.fetch(new Request('https://worker.test/api/overview'), migratedEnv, ctx);
  const overview = await overviewResponse.json();
  const repository = overview.repositories[0];
  assert.equal(repository.latestTag, 'v1.4.0');
  assert.equal(repository.previousTag, 'v1.3.0');
  assert.equal(repository.history[0].changeType, 'baseline');
  assert.equal(repository.history[0].previousTag, 'v1.3.0');
  assert.equal(repository.history[1].changeType, 'backfill');

  const repeatResponse = await worker.fetch(new Request('https://worker.test/check', {
    method: 'POST', headers: { 'X-Check-Secret': migratedEnv.CHECK_SECRET },
  }), migratedEnv, ctx);
  const repeatResult = await repeatResponse.json();
  assert.equal(repeatResult.repositories[0].previousTag, 'v1.3.0');
  assert.equal(previousReleaseCalls, 1, 'a migrated history must not be backfilled on every scan');
});

test('long release notes are formatted and split into valid Telegram-size messages', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  telegramMessages.length = 0;
  const notes = Array.from({ length: 13 }, (_, index) =>
    `### Feature ${index + 1}\nA detailed improvement for feature ${index + 1} keeps profiles compatible and explains migration behavior for existing installations.\n- Preserve the current connection settings\n- Report clearer diagnostics when a request fails\n> Note ${index + 1}: restart the app if the old configuration is still cached.`
  ).join('\n\n');
  const assets = Array.from({ length: 15 }, (_, index) => ({
    name: `release-file-${String(index + 1).padStart(2, '0')}.apk`,
    size: 1024 * 1024 * (index + 1),
    browser_download_url: `https://github.com/owner/long-project/releases/download/v2.0.0/release-file-${index + 1}.apk`,
  }));
  const longEnv = {
    ...env,
    REPOS: 'owner/long-project',
    RELEASES: new MemoryKV({ 'release:owner/long-project': JSON.stringify({
      tag: 'v1.9.0', name: 'Previous', htmlUrl: 'https://github.com/owner/long-project/releases/tag/v1.9.0',
      publishedAt: '2026-09-01T10:00:00Z', releaseId: 99, prerelease: false,
    }) }),
    USERS: new MemoryKV({ '987654321': 'active' }),
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith('https://api.github.com/repos/')) {
      return jsonResponse({
        id: 2000, tag_name: 'v2.0.0', name: 'Detailed Update',
        html_url: 'https://github.com/owner/long-project/releases/tag/v2.0.0',
        published_at: '2026-10-17T10:30:45Z', draft: false, prerelease: false,
        body: notes, assets,
      });
    }
    if (url.startsWith('https://api.telegram.org/')) {
      const payload = JSON.parse(init.body || '{}');
      telegramMessages.push({ url, payload });
      return jsonResponse({ ok: true, result: { message_id: telegramMessages.length, chat: { id: payload.chat_id }, text: payload.text } });
    }
    throw new Error(`Unexpected fetch in multipart test: ${url}`);
  };

  const ctx = { waitUntil(promise) { Promise.resolve(promise).catch(() => {}); } };
  const response = await worker.fetch(new Request('https://worker.test/check', {
    method: 'POST', headers: { 'X-Check-Secret': longEnv.CHECK_SECRET },
  }), longEnv, ctx);
  assert.equal(response.status, 200);
  assert.ok(telegramMessages.length >= 2, 'the long release must be sent as more than one message');
  for (const { payload } of telegramMessages) {
    assert.ok(payload.text.length <= 4096, `Telegram text limit exceeded: ${payload.text.length}`);
    assert.equal(payload.parse_mode, 'HTML');
    assertValidTelegramHtml(payload.text);
  }
  const combined = telegramMessages.map(({ payload }) => payload.text).join('\n');
  assert.match(combined, /<b>Feature 1<\/b>/);
  assert.match(combined, /<blockquote>Note 13:/);
  assert.match(combined, /release-file-01\.apk/);
  assert.match(combined, /3 more file\(s\)/);
  assert.match(combined, /Sat, 17 Oct 2026 10:30:45 GMT/);
  assert.ok(telegramMessages.at(-1).payload.reply_markup?.inline_keyboard, 'inline keyboard belongs on final message');
  assert.ok(!telegramMessages.slice(0, -1).some(({ payload }) => payload.reply_markup), 'earlier parts should not duplicate the keyboard');
});

test('Worker protects manual check endpoints and reports health', async () => {
  const ctx = { waitUntil(promise) { Promise.resolve(promise).catch(() => {}); } };
  const unauthenticated = await worker.fetch(new Request('https://worker.test/check', { method: 'POST' }), env, ctx);
  assert.equal(unauthenticated.status, 401);
  const preflight = await worker.fetch(new Request('https://worker.test/check', {
    method: 'OPTIONS',
    headers: {
      Origin: env.PUBLIC_SITE_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'x-check-secret,x-scan-source',
    },
  }), env, ctx);
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /X-Check-Secret/i);

  const health = await worker.fetch(new Request('https://worker.test/health'), env, ctx);
  const data = await health.json();
  assert.equal(data.ok, true);
  assert.equal(data.repositoryCount, 1);
  assert.equal(data.scheduledCron, null);
});
