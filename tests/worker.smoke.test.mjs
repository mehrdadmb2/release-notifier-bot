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
        body: 'Improved handling of <unsafe> input & output.',
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

test('Worker protects manual check endpoints and reports health', async () => {
  const ctx = { waitUntil(promise) { Promise.resolve(promise).catch(() => {}); } };
  const unauthenticated = await worker.fetch(new Request('https://worker.test/check', { method: 'POST' }), env, ctx);
  assert.equal(unauthenticated.status, 401);
  const health = await worker.fetch(new Request('https://worker.test/health'), env, ctx);
  const data = await health.json();
  assert.equal(data.ok, true);
  assert.equal(data.repositoryCount, 1);
});
