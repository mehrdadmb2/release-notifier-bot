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

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith('https://api.github.com/repos/')) {
      return jsonResponse({
        id: currentTag === 'v1.0.0' ? 100 : 200,
        tag_name: currentTag,
        name: `Release ${currentTag}`,
        html_url: `https://github.com/owner/project/releases/tag/${currentTag}`,
        published_at: '2026-10-17T10:30:00Z',
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

  const overviewResponse = await worker.fetch(new Request('https://worker.test/api/overview', {
    headers: { Origin: env.PUBLIC_SITE_ORIGIN },
  }), env, ctx);
  const overview = await overviewResponse.json();
  assert.equal(overview.ok, true);
  assert.equal(overview.repositories[0].latestTag, 'v1.1.0');
  assert.equal(overview.repositoryCount, 1);
  assert.equal(overviewResponse.headers.get('Access-Control-Allow-Origin'), env.PUBLIC_SITE_ORIGIN);
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
  const health = await worker.fetch(new Request('https://worker.test/health'), env, ctx);
  const data = await health.json();
  assert.equal(data.ok, true);
  assert.equal(data.repositoryCount, 1);
});
