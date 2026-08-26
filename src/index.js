// ====================================================================
//  GitHub Release Watcher Bot — v3.3 (Full Featured)
//  - /latest without args shows all repos
//  - All repo names in <code> for easy copy
//  - HTML parse fallback
// ====================================================================

export default {
  async scheduled(event, env, ctx) {
    await checkAllRepos(env);
  },

  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === '/webhook') {
        if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
        try {
          const body = await request.json();
          await handleTelegramUpdate(body, env);
          return new Response('OK', { status: 200 });
        } catch (err) {
          console.error('❌ Webhook error:', err.message);
          return new Response('Internal Error', { status: 500 });
        }
      }

      if (path === '/setwebhook') {
        try {
          const webhookUrl = `https://${url.hostname}/webhook`;
          const setUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${webhookUrl}`;
          const resp = await fetch(setUrl);
          const json = await resp.json();
          return new Response(JSON.stringify(json, null, 2), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (err) {
          return new Response(`❌ Failed: ${err.message}`, { status: 500 });
        }
      }

      if (path === '/check') {
        await checkAllRepos(env);
        return new Response('✅ Check completed successfully.', { status: 200 });
      }

      return new Response('🤖 GitHub Release Watcher is active.', { status: 200 });

    } catch (err) {
      console.error('🔥 Unhandled fetch error:', err.message);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
};

// ====================================================================
//  FUNCTIONS
// ====================================================================

// ---------- Parse command (remove @BotUsername) ----------
function parseCommand(text) {
  if (!text) return { cmd: '', args: '' };
  const parts = text.split(' ');
  const cmdWithBot = parts[0] || '';
  const cmd = cmdWithBot.includes('@') ? cmdWithBot.split('@')[0] : cmdWithBot;
  const args = parts.slice(1).join(' ');
  return { cmd, args };
}

// ---------- GitHub API with retry ----------
async function getLatestRelease(repo, retries = 2) {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Cloudflare-Release-Bot',
          'Accept': 'application/vnd.github.v3+json'
        },
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`GitHub API error ${response.status}: ${errText}`);
      }

      return await response.json();

    } catch (err) {
      lastError = err;
      console.warn(`⚠️ Attempt ${attempt + 1} failed for ${repo}:`, err.message);
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  throw new Error(`Failed to fetch ${repo}: ${lastError.message}`);
}

// ---------- Telegram API with HTML fallback ----------
async function sendTelegramMessage(token, chatId, text, extra = {}) {
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
      ...extra
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      
      if (errText.includes('can\'t parse entities')) {
        console.warn('⚠️ HTML parse error, retrying without formatting...');
        const plainPayload = {
          chat_id: chatId,
          text: text.replace(/<[^>]*>/g, ''),
          disable_web_page_preview: false,
          ...extra
        };
        const retryResponse = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(plainPayload)
        });
        if (!retryResponse.ok) {
          const retryErr = await retryResponse.text();
          throw new Error(`Plain text send failed: ${retryErr}`);
        }
        return await retryResponse.json();
      }
      
      throw new Error(`Telegram API error ${response.status}: ${errText}`);
    }

    return await response.json();

  } catch (err) {
    console.error(`❌ Failed to send to ${chatId}:`, err.message);
    return null;
  }
}

// ---------- Broadcast to all users ----------
async function broadcastToAllUsers(env, message) {
  try {
    const users = await env.USERS.list();
    if (!users.keys.length) {
      console.log('ℹ️ No users registered.');
      return { total: 0, succeeded: 0, failed: 0 };
    }

    let succeeded = 0, failed = 0;
    for (const user of users.keys) {
      const result = await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, user.name, message);
      if (result) succeeded++; else failed++;
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    console.log(`📢 Broadcast: ${succeeded} ok, ${failed} failed`);
    return { total: users.keys.length, succeeded, failed };

  } catch (err) {
    console.error('❌ Broadcast error:', err.message);
    return { total: 0, succeeded: 0, failed: 0, error: err.message };
  }
}

// ---------- Build release message (all tags are Telegram-compatible) ----------
function buildReleaseMessage(repo, release) {
  const tag = release.tag_name || 'N/A';
  const published = release.published_at
    ? new Date(release.published_at).toUTCString()
    : 'Unknown';

  const lines = [
    '🚀 <b>New Release Published!</b>',
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
    `📦 <b>Repository:</b> <code>${escapeHtml(repo)}</code>`,
    `🏷️ <b>Version:</b> <code>${escapeHtml(tag)}</code>`,
    `📅 <b>Published:</b> ${published}`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━'
  ];

  if (release.body) {
    let desc = release.body.replace(/<[^>]*>/g, '').replace(/\r\n/g, '\n').trim();
    if (desc.length > 600) desc = desc.substring(0, 600) + '\n\n… <i>(truncated)</i>';
    lines.push('📝 <b>Description:</b>');
    lines.push(desc);
    lines.push('');
  }

  lines.push('🔗 <b>Download Links:</b>');
  if (release.assets && release.assets.length > 0) {
    const assets = release.assets.slice(0, 6);
    for (const a of assets) {
      const size = (a.size / 1024 / 1024).toFixed(2);
      const name = a.name.length > 35 ? a.name.substring(0, 35) + '…' : a.name;
      lines.push(`• <a href="${escapeHtml(a.browser_download_url)}">${escapeHtml(name)}</a> (${size} MB)`);
    }
    if (release.assets.length > 6) {
      lines.push(`• <i>and ${release.assets.length - 6} more files…</i>`);
    }
  } else {
    lines.push(`• <a href="${escapeHtml(release.html_url || '#')}">View on GitHub</a>`);
  }
  lines.push('');
  lines.push(`🌐 <a href="${escapeHtml(release.html_url || '#')}">Full Release on GitHub</a>`);

  return lines.join('\n');
}

// ---------- Build /latest response for one repo ----------
async function buildSingleLatestResponse(repo) {
  try {
    const release = await getLatestRelease(repo);
    const tag = release.tag_name || 'N/A';
    const published = release.published_at
      ? new Date(release.published_at).toUTCString()
      : 'Unknown';

    const lines = [
      '📡 <b>Latest Release Info</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `📦 <b>Repository:</b> <code>${escapeHtml(repo)}</code>`,
      `🏷️ <b>Version:</b> <code>${escapeHtml(tag)}</code>`,
      `📅 <b>Published:</b> ${published}`,
      `🔗 <b>URL:</b> <a href="${escapeHtml(release.html_url || '#')}">${escapeHtml(release.html_url || '#')}</a>`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━'
    ];

    if (release.body) {
      let desc = release.body.replace(/<[^>]*>/g, '').replace(/\r\n/g, '\n').trim();
      if (desc.length > 500) desc = desc.substring(0, 500) + '\n\n… <i>(truncated)</i>';
      lines.push('📝 <b>Description:</b>');
      lines.push(desc);
      lines.push('');
    }

    if (release.assets && release.assets.length > 0) {
      lines.push('📎 <b>Assets:</b>');
      for (const a of release.assets.slice(0, 6)) {
        const size = (a.size / 1024 / 1024).toFixed(2);
        lines.push(`• <a href="${escapeHtml(a.browser_download_url)}">${escapeHtml(a.name)}</a> (${size} MB)`);
      }
      if (release.assets.length > 6) {
        lines.push(`• <i>and ${release.assets.length - 6} more</i>`);
      }
    } else {
      lines.push('📎 No assets attached.');
    }

    return lines.join('\n');

  } catch (err) {
    return `❌ <b>Error fetching <code>${escapeHtml(repo)}</code></b>\n\n${escapeHtml(err.message)}`;
  }
}

// ---------- Build /latest response for ALL repos ----------
async function buildAllLatestResponse(env) {
  const repos = (env.REPOS || '').split(',').map(r => r.trim()).filter(Boolean);
  if (!repos.length) {
    return '⚠️ No repositories defined.';
  }

  const results = [];
  for (const repo of repos) {
    const info = await buildSingleLatestResponse(repo);
    results.push(info);
    results.push(''); // blank line between repos
  }

  // Combine with a header
  const header = '📋 <b>Latest Release for All Watched Repositories</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  return header + results.join('\n');
}

// ---------- Check all repos and notify ----------
async function checkAllRepos(env) {
  const repos = (env.REPOS || '').split(',').map(r => r.trim()).filter(Boolean);
  if (!repos.length) {
    console.log('⚠️ No repositories defined.');
    return;
  }

  let newReleases = [];

  for (const repo of repos) {
    try {
      console.log(`🔍 Checking ${repo}...`);
      const release = await getLatestRelease(repo);
      const tag = release.tag_name;
      if (!tag) continue;

      const kvKey = `release:${repo}`;
      const storedTag = await env.RELEASES.get(kvKey);

      if (storedTag !== tag) {
        await env.RELEASES.put(kvKey, tag);
        newReleases.push({ repo, release });
        console.log(`✅ New release: ${repo} ${tag}`);
      }
    } catch (err) {
      console.error(`❌ Error checking ${repo}:`, err.message);
    }
  }

  if (!newReleases.length) return;

  for (const { repo, release } of newReleases) {
    const message = buildReleaseMessage(repo, release);
    await broadcastToAllUsers(env, message);
  }
}

// ---------- Escape HTML ----------
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ====================================================================
//  HANDLE TELEGRAM UPDATES
// ====================================================================
async function handleTelegramUpdate(update, env) {
  try {
    if (!update.message) return;

    const chatId = update.message.chat.id;
    const rawText = (update.message.text || '').trim();
    const { cmd, args } = parseCommand(rawText);

    const username = update.message.from?.username || 'unknown';
    console.log(`📩 Command from @${username} (${chatId}): "${cmd}" Args: "${args}"`);

    // ----- /start -----
    if (cmd === '/start') {
      await env.USERS.put(String(chatId), 'active');
      const repos = (env.REPOS || '').split(',').map(r => r.trim()).filter(Boolean);
      const repoList = repos.length
        ? repos.map(r => `• <code>${escapeHtml(r)}</code>`).join('\n')
        : '⚠️ No repositories configured.';

      const welcome =
        `👋 <b>Welcome to GitHub Release Watcher Bot!</b>\n\n` +
        `🔔 I monitor these repositories:\n\n` +
        `${repoList}\n\n` +
        `⏰ <b>Check interval:</b> every hour\n\n` +
        `📌 <b>Commands:</b>\n` +
        `/start – Register\n` +
        `/stop – Unsubscribe\n` +
        `/repos – Show watched repos\n` +
        `/latest <repo> – Get latest release (or /latest for all)\n` +
        `/status – Bot status\n\n` +
        `✅ You have been registered!`;

      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, welcome);
      return;
    }

    // ----- /stop -----
    if (cmd === '/stop') {
      await env.USERS.delete(String(chatId));
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        `❌ You have been unsubscribed.\nUse /start to register again.`
      );
      return;
    }

    // ----- /repos -----
    if (cmd === '/repos') {
      const repos = (env.REPOS || '').split(',').map(r => r.trim()).filter(Boolean);
      if (!repos.length) {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ No repositories defined.');
        return;
      }

      let lines = ['📋 <b>Watched Repositories</b>', '━━━━━━━━━━━━━━━━━━━━━━━━━'];
      for (const repo of repos) {
        const lastVer = await env.RELEASES.get(`release:${repo}`);
        lines.push(`📦 <code>${escapeHtml(repo)}</code>`);
        lines.push(`   Last known version: ${lastVer ? escapeHtml(lastVer) : '❌ never checked'}`);
        lines.push('');
      }
      lines.push('💡 Use /latest <repo> to get real‑time info.');
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, lines.join('\n'));
      return;
    }

    // ----- /latest (with or without argument) -----
    if (cmd === '/latest') {
      let repo = args.trim();

      // اگر آرگومان وجود نداشت، اطلاعات همه repos را بفرست
      if (!repo) {
        const allInfo = await buildAllLatestResponse(env);
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, allInfo);
        return;
      }

      // در غیر این صورت فقط همان repo مشخص شده را بررسی کن
      const response = await buildSingleLatestResponse(repo);
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, response);
      return;
    }

    // ----- /status -----
    if (cmd === '/status') {
      const users = await env.USERS.list();
      const repos = (env.REPOS || '').split(',').filter(r => r.trim().length > 0);
      const msg =
        `📊 <b>Bot Status</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👥 <b>Registered users:</b> ${users.keys.length}\n` +
        `📦 <b>Monitored repos:</b> ${repos.length}\n` +
        `⏰ <b>Check interval:</b> every hour\n` +
        `🟢 <b>Status:</b> active\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 Use /repos to see the full list.`;
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
      return;
    }

    // ----- Unknown -----
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `❓ Unknown command.\n\n` +
      `📌 <b>Available commands:</b>\n` +
      `/start – Register\n` +
      `/stop – Unsubscribe\n` +
      `/repos – Show watched repos\n` +
      `/latest <repo> – Get latest release (or /latest for all)\n` +
      `/status – Bot status`
    );

  } catch (err) {
    console.error('🔥 handleTelegramUpdate error:', err.message);
    try {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        update.message?.chat?.id,
        `⚠️ An internal error occurred. Please try again later.`
      );
    } catch (_) { /* ignore */ }
  }
}
