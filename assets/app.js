'use strict';

const WORKER_BASE = 'https://release-watcher-bot.game-developer-mb.workers.dev';
const WORKER_API = `${WORKER_BASE}/api/overview`;
const WORKER_CHECK_API = `${WORKER_BASE}/check`;
const DEFAULT_REPOSITORIES = [
  { fullName: '2dust/v2rayN', description: 'Windows client · release and asset tracking', category: 'windows', accent: '#55e6ff', icon: 'VN' },
  { fullName: '2dust/v2rayNG', description: 'Android client · release and asset tracking', category: 'android', accent: '#a88bff', icon: 'VG' },
  { fullName: 'diegosouzapw/OmniRoute', description: 'Release stream · upstream version monitoring', category: 'project', accent: '#ffb77e', icon: 'OR' },
  { fullName: 'WhiteDNS/WhiteDNS-Android', description: 'Android project · stable release tracking', category: 'android', accent: '#67f0b4', icon: 'WD' },
  { fullName: 'shirokhorshid/shirokhorshid-android', description: 'Android project · stable release tracking', category: 'android', accent: '#7fa9ff', icon: 'SH' },
  { fullName: 'KNG7-P/Se7en-Pro', description: 'Project release feed · version snapshots', category: 'project', accent: '#ff8eb4', icon: 'S7' },
  { fullName: 'therealaleph/MasterHttpRelayVPN-RUST', description: 'Rust networking project · release feed', category: 'network', accent: '#f7cd70', icon: 'MR' },
  { fullName: 'anonvector/SlipNet', description: 'Networking project · stable release tracking', category: 'network', accent: '#7ee0ff', icon: 'SN' },
];

const state = {
  repositories: DEFAULT_REPOSITORIES.map((repo) => ({ ...repo })),
  filter: 'all',
  query: '',
  sort: 'default',
  connected: false,
  lastUpdated: null,
  refreshInProgress: false,
  scanInProgress: false,
};

const elements = {};
let toastTimer;

function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatLocalDate(value) {
  if (!value) return 'Not recorded yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded yet';
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function shortDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function shortRepoName(fullName) {
  const parts = String(fullName || '').split('/');
  return parts.length > 1 ? parts[1] : (parts[0] || 'Repository');
}

function repoOwner(fullName) {
  const parts = String(fullName || '').split('/');
  return parts.length > 1 ? parts[0] : 'GitHub';
}

function defaultMeta(fullName, index = 0) {
  const found = DEFAULT_REPOSITORIES.find((repo) => repo.fullName.toLowerCase() === String(fullName).toLowerCase());
  if (found) return { ...found };
  const colors = ['#55e6ff', '#a88bff', '#67f0b4', '#ffb77e', '#7fa9ff', '#ff8eb4'];
  const cleanName = shortRepoName(fullName).replace(/[^a-z0-9]/gi, '').toUpperCase();
  return {
    fullName,
    description: 'GitHub release feed · version monitoring',
    category: 'project',
    accent: colors[index % colors.length],
    icon: cleanName.slice(0, 2) || 'GH',
  };
}

function normalizeApiRepository(item, index) {
  const meta = defaultMeta(item.fullName, index);
  return {
    ...meta,
    ...item,
    icon: meta.icon,
    accent: meta.accent,
    description: item.description || meta.description,
    url: item.url || `https://github.com/${encodeURIComponent(item.fullName).replace('%2F', '/')}`,
    releasesUrl: item.releasesUrl || `https://github.com/${item.fullName}/releases`,
    releaseUrl: item.releaseUrl || null,
    latestTag: item.latestTag || null,
    publishedAt: item.publishedAt || null,
    lastChecked: item.lastChecked || null,
    state: item.state || (item.latestTag ? 'ok' : 'pending'),
    previousTag: item.previousTag || null,
    language: item.language || null,
    stars: Number(item.stars || 0),
    forks: Number(item.forks || 0),
    watchers: Number(item.watchers || 0),
    openIssues: Number(item.openIssues || 0),
    defaultBranch: item.defaultBranch || null,
    license: item.license || null,
    archived: Boolean(item.archived),
    pushedAt: item.pushedAt || null,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    metadataFetchedAt: item.metadataFetchedAt || null,
    history: Array.isArray(item.history) ? item.history : [],
    snapshots: Array.isArray(item.snapshots) ? item.snapshots : [],
    releaseAssetCount: Number(item.releaseAssetCount || 0),
    releaseBody: item.releaseBody || '',
    releaseAssets: Array.isArray(item.releaseAssets) ? item.releaseAssets : [],
    homepage: item.homepage || null,
    visibility: item.visibility || null,
    topics: Array.isArray(item.topics) ? item.topics : [],
  };
}

function currentFilterCount(filter) {
  if (filter === 'released') return state.repositories.filter((repo) => Boolean(repo.latestTag)).length;
  if (filter === 'pending') return state.repositories.filter((repo) => !repo.latestTag || ['error', 'no-release', 'not-found'].includes(repo.state)).length;
  return state.repositories.length;
}

function filteredRepositories() {
  const query = state.query.trim().toLowerCase();
  let items = state.repositories.filter((repo) => {
    const queryMatches = !query || `${repo.fullName} ${repo.description}`.toLowerCase().includes(query);
    let filterMatches = true;
    if (state.filter === 'released') filterMatches = Boolean(repo.latestTag);
    if (state.filter === 'pending') filterMatches = !repo.latestTag || ['error', 'no-release', 'not-found'].includes(repo.state);
    return queryMatches && filterMatches;
  });

  if (state.sort === 'name') items = items.slice().sort((a, b) => shortRepoName(a.fullName).localeCompare(shortRepoName(b.fullName)));
  if (state.sort === 'owner') items = items.slice().sort((a, b) => repoOwner(a.fullName).localeCompare(repoOwner(b.fullName)));
  if (state.sort === 'tag') items = items.slice().sort((a, b) => Number(Boolean(b.latestTag)) - Number(Boolean(a.latestTag)) || a.fullName.localeCompare(b.fullName));
  return items;
}

function getRepoState(repo) {
  if (repo.state === 'error') return { label: 'CHECK ISSUE', className: 'state-error' };
  if (repo.state === 'not-found') return { label: 'NOT FOUND', className: 'state-error' };
  if (repo.state === 'no-release') return { label: 'NO STABLE RELEASE', className: 'state-none' };
  if (repo.latestTag) return { label: 'VERSION KNOWN', className: 'state-released' };
  return { label: 'AWAITING SNAPSHOT', className: 'state-pending' };
}

function compactNumber(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat(undefined, { notation: number >= 1000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(number);
}

function renderTrendLine(snapshots, key) {
  const values = snapshots.map((item) => Number(item[key])).filter((value) => Number.isFinite(value));
  if (values.length < 2) return '<span class="trend-placeholder">Daily trend appears after the next scheduled scan.</span>';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * 100;
    const y = 27 - ((value - min) / spread) * 22;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" /></svg>`;
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderSnapshotTrends(repo) {
  const snapshots = Array.isArray(repo.snapshots) ? repo.snapshots : [];
  if (!snapshots.length) return '<div class="repo-trend-empty">Daily statistics are waiting for the first successful metadata scan.</div>';
  const first = snapshots[0];
  const latest = snapshots[snapshots.length - 1];
  const stats = [
    { key: 'stars', label: 'Stars', first: Number(first.stars || 0), latest: Number(latest.stars || 0) },
    { key: 'forks', label: 'Forks', first: Number(first.forks || 0), latest: Number(latest.forks || 0) },
    { key: 'openIssues', label: 'Open issues', first: Number(first.openIssues || 0), latest: Number(latest.openIssues || 0) },
  ];
  return `<div class="repo-trend-grid">${stats.map((stat) => `<div class="repo-trend-item"><div><span>${stat.label}</span><b>${compactNumber(stat.latest)}</b></div>${renderTrendLine(snapshots, stat.key)}<small>${compactNumber(stat.first)} → ${compactNumber(stat.latest)}</small></div>`).join('')}</div>`;
}

function renderRepository(repo, index) {
  const displayState = getRepoState(repo);
  const dateValue = repo.publishedAt || repo.lastChecked;
  const dateLabel = repo.publishedAt ? 'Published' : 'Last checked';
  const versionValue = repo.latestTag || (repo.state === 'no-release' ? 'No stable release' : repo.state === 'error' ? 'Retry required' : 'Waiting for first scan');
  const releaseUrl = repo.releaseUrl && /^https:\/\//i.test(repo.releaseUrl) ? repo.releaseUrl : repo.releasesUrl;
  const safeFullName = escapeHtml(repo.fullName);
  const safeDescription = escapeHtml(repo.description || 'GitHub repository · awaiting metadata snapshot');
  const versionFlow = repo.latestTag
    ? `${repo.previousTag ? `<code>${escapeHtml(repo.previousTag)}</code><span class="version-arrow">→</span>` : '<span class="version-origin">BASELINE</span>'}<strong>${escapeHtml(repo.latestTag)}</strong>`
    : `<strong>${escapeHtml(versionValue)}</strong>`;
  const history = (repo.history || []).filter((item) => item.changeType === 'release').slice(0, 4);
  const topics = (repo.topics || []).slice(0, 5).map((topic) => `<span class="topic-chip">${escapeHtml(topic)}</span>`).join('');
  const pushedLabel = repo.pushedAt ? shortDate(repo.pushedAt) : '—';
  const detailRows = [
    ['Default branch', repo.defaultBranch || '—'],
    ['License', repo.license || 'Not specified'],
    ['Visibility', repo.visibility || '—'],
    ['Repository size', repo.metadataFetchedAt ? formatBytes(Number(repo.sizeKb || 0) * 1024) : '—'],
    ['Created', shortDate(repo.createdAt) || '—'],
    ['Last metadata update', shortDate(repo.updatedAt) || '—'],
    ['Last push', pushedLabel],
    ['Archived', repo.metadataFetchedAt ? (repo.archived ? 'Yes' : 'No') : '—'],
  ].map(([label, value]) => `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join('');
  const assets = (repo.releaseAssets || []).filter((asset) => asset && /^https:\/\//i.test(asset.browser_download_url || '')).slice(0, 6);
  const assetsMarkup = assets.length
    ? `<div class="repo-assets-block"><b>Release assets · ${Number(repo.releaseAssetCount || assets.length)}</b>${assets.map((asset) => `<a href="${escapeHtml(asset.browser_download_url)}" target="_blank" rel="noreferrer"><span>↓ ${escapeHtml(asset.name || 'Download')}</span><small>${escapeHtml(formatBytes(asset.size))}</small></a>`).join('')}</div>`
    : '';
  const releaseNotes = String(repo.releaseBody || '').trim();
  const notesMarkup = releaseNotes
    ? `<div class="repo-release-notes"><b>Latest release notes</b><pre>${escapeHtml(releaseNotes.slice(0, 1800))}${releaseNotes.length > 1800 ? '\n\n… notes truncated in dashboard; open GitHub for the full changelog.' : ''}</pre></div>`
    : '';
  const historyMarkup = history.length
    ? history.map((item) => `<li><span class="history-change">${escapeHtml(item.previousTag || '—')} <i>→</i> ${escapeHtml(item.tag || '—')}</span><time>${escapeHtml(shortDate(item.publishedAt || item.recordedAt) || '—')}</time></li>`).join('')
    : '<li class="history-empty">No release changes have been recorded yet.</li>';

  return `
    <article class="repo-card" data-repo="${safeFullName}" style="--card-accent:${escapeHtml(repo.accent)};--card-glow:${escapeHtml(repo.accent)}20;--card-index:${index}" tabindex="0">
      <div class="repo-top">
        <span class="repo-avatar" aria-hidden="true">${escapeHtml(repo.icon)}</span>
        <span class="repo-state ${displayState.className}"><i></i>${displayState.label}</span>
      </div>
      <div class="repo-name-wrap">
        <div class="repo-owner">${escapeHtml(repoOwner(repo.fullName))} /</div>
        <div class="repo-name" title="${safeFullName}">${escapeHtml(shortRepoName(repo.fullName))}</div>
      </div>
      <p class="repo-description">${safeDescription}</p>
      <div class="repo-version-flow"><span>PREVIOUS <b>→</b> CURRENT</span><div>${versionFlow}</div></div>
      <div class="repo-data">
        <div class="repo-data-line"><span>${dateLabel}</span><time datetime="${escapeHtml(dateValue || '')}">${escapeHtml(shortDate(dateValue) || '—')}</time></div>
        <div class="repo-stats-row">
          <span title="Stars">★ ${escapeHtml(repo.metadataFetchedAt ? compactNumber(repo.stars) : '—')}</span>
          <span title="Forks">⑂ ${escapeHtml(repo.metadataFetchedAt ? compactNumber(repo.forks) : '—')}</span>
          <span title="Open issues">◎ ${escapeHtml(repo.metadataFetchedAt ? compactNumber(repo.openIssues) : '—')}</span>
          <span title="Primary language">${escapeHtml(repo.language || '—')}</span>
        </div>
      </div>
      <details class="repo-details">
        <summary>Repository intelligence <span>＋</span></summary>
        <div class="repo-details-body">
          <div class="repo-detail-grid">${detailRows}</div>
          ${topics ? `<div class="repo-topics">${topics}</div>` : ''}
          <div class="repo-daily-trends"><b>Daily repository stats</b>${renderSnapshotTrends(repo)}</div>
          ${notesMarkup}
          ${assetsMarkup}
          <div class="repo-history-block"><b>Version history</b><ol>${historyMarkup}</ol></div>
          <div class="repo-snapshot-note">${repo.history?.length || 0} release record(s) · ${repo.snapshots?.length || 0} daily stat snapshot(s)</div>
        </div>
      </details>
      <div class="repo-actions">
        ${repo.homepage ? `<a class="repo-link repo-home-link" href="${escapeHtml(repo.homepage)}" target="_blank" rel="noreferrer">Website <span>↗</span></a>` : ''}
        <a class="repo-link" href="${escapeHtml(releaseUrl)}" target="_blank" rel="noreferrer">Open releases <span>↗</span></a>
        <button class="repo-copy" type="button" data-copy-repo="${safeFullName}" aria-label="Copy ${safeFullName}" title="Copy repository name">⧉</button>
      </div>
    </article>`;
}

function renderGrid() {
  if (!elements.repoGrid) return;
  const items = filteredRepositories();
  elements.repoGrid.innerHTML = items.map(renderRepository).join('');
  elements.repoGrid.setAttribute('aria-busy', 'false');
  elements.repoGrid.hidden = items.length === 0;
  elements.emptyState.hidden = items.length !== 0;
  elements.resultCount.textContent = `${items.length} ${items.length === 1 ? 'repository' : 'repositories'}`;
  elements.countAll.textContent = String(state.repositories.length).padStart(2, '0');
  elements.repoGrid.querySelectorAll('[data-copy-repo]').forEach((button) => {
    button.addEventListener('click', () => copyText(button.dataset.copyRepo, 'Repository name copied'));
  });
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    elements.repoGrid.querySelectorAll('.repo-card').forEach(attachTilt);
  }
}

function attachTilt(card) {
  card.addEventListener('pointermove', (event) => {
    const rect = card.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    const rotateY = (px - 0.5) * 4.5;
    const rotateX = (0.5 - py) * 4.0;
    card.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-3px)`;
  });
  card.addEventListener('pointerleave', () => { card.style.transform = ''; });
  card.addEventListener('blur', () => { card.style.transform = ''; });
}

function updateMetrics(overview) {
  byId('metricRepos').textContent = String(overview.repositoryCount ?? state.repositories.length).padStart(2, '0');
  byId('metricReleases').textContent = String(overview.releaseCount ?? state.repositories.filter((repo) => repo.latestTag).length).padStart(2, '0');
  byId('metricChecked').textContent = String(overview.checkedCount ?? 0).padStart(2, '0');
  byId('metricUsers').textContent = overview.userCount === undefined || overview.userCount === null ? '—' : String(overview.userCount).padStart(2, '0');
  byId('countAll').textContent = String(state.repositories.length).padStart(2, '0');
  byId('footerStatus').textContent = state.connected ? 'Snapshot API connected' : 'Fallback watchlist';
  const scan = overview.scan || {};
  const scanMeta = byId('scanMeta');
  if (scanMeta) scanMeta.textContent = scan.finishedAt ? `LAST SCAN ${formatLocalDate(scan.finishedAt)} · ${String(scan.source || 'unknown').toUpperCase()}` : 'DAILY SCAN · GITHUB ACTIONS · WAITING FOR FIRST RUN';
}

function setSyncStatus(kind, title, detail) {
  elements.syncStatus.dataset.state = kind;
  elements.syncLabel.textContent = title;
  elements.syncTime.textContent = detail;
}

async function loadOverview({ quiet = false } = {}) {
  if (state.refreshInProgress) return;
  state.refreshInProgress = true;
  elements.refreshButton.classList.add('is-loading');
  elements.refreshButton.disabled = true;
  if (!state.connected && !quiet) setSyncStatus('loading', 'Connecting to Worker', 'Fetching persisted release snapshot…');

  let controller;
  let timeout;
  try {
    controller = new AbortController();
    timeout = window.setTimeout(() => controller.abort(), 9000);
    const response = await fetch(WORKER_API, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Worker returned HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload || payload.ok !== true || !Array.isArray(payload.repositories)) throw new Error('Unexpected Worker API response');

    state.repositories = payload.repositories.map(normalizeApiRepository);
    state.connected = true;
    state.lastUpdated = payload.generatedAt || new Date().toISOString();
    const scan = payload.scan || {};
    const detail = scan.finishedAt
      ? `${payload.checkedCount ?? 0}/${payload.repositoryCount ?? 0} repos checked · ${String(scan.source || 'scan').replace(/-/g, ' ')} · ${formatLocalDate(scan.finishedAt)}`
      : `Connected · waiting for first scan · snapshot ${formatLocalDate(state.lastUpdated)}`;
    setSyncStatus('connected', 'Worker connected', detail);
    updateMetrics(payload);
    renderGrid();
    if (!quiet) showToast('Watchlist snapshot refreshed');
  } catch (error) {
    state.connected = false;
    if (!state.repositories.length) state.repositories = DEFAULT_REPOSITORIES.map((repo) => ({ ...repo }));
    setSyncStatus('error', 'Using static watchlist', 'Worker API unavailable · retry later');
    updateMetrics({ repositoryCount: state.repositories.length, releaseCount: state.repositories.filter((repo) => repo.latestTag).length, userCount: null });
    renderGrid();
    if (!quiet) showToast('Worker API unavailable — showing the local watchlist');
    console.warn('Could not load Worker overview:', error?.message || error);
  } finally {
    if (timeout) window.clearTimeout(timeout);
    state.refreshInProgress = false;
    elements.refreshButton.classList.remove('is-loading');
    elements.refreshButton.disabled = false;
    hideAppLoader();
  }
}


function hideAppLoader() {
  const loader = byId('appLoader');
  if (!loader || loader.classList.contains('is-hidden')) return;
  loader.classList.add('is-hidden');
  window.setTimeout(() => loader.remove(), 700);
}

function openScanDialog() {
  const dialog = byId('scanDialog');
  const input = byId('scanSecret');
  const hint = byId('scanDialogHint');
  hint.textContent = 'Your key is used only for this request and is not saved.';
  input.value = '';
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else {
    const secret = window.prompt('Enter the Worker CHECK_SECRET to start a manual scan:');
    if (secret) runManualScan(secret);
  }
  window.setTimeout(() => input.focus(), 80);
}

async function runManualScan(secret) {
  if (state.scanInProgress) return;
  state.scanInProgress = true;
  const button = elements.runScanButton;
  const hint = byId('scanDialogHint');
  const confirm = byId('confirmScan');
  button.disabled = true;
  button.classList.add('is-loading');
  confirm.disabled = true;
  hint.textContent = 'Contacting the Worker and checking configured repositories…';
  try {
    const response = await fetch(WORKER_CHECK_API, {
      method: 'POST',
      headers: { 'X-Check-Secret': secret, 'X-Scan-Source': 'dashboard' },
      cache: 'no-store',
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) throw new Error(result.error || `Worker returned HTTP ${response.status}`);
    byId('scanDialog').close();
    showToast(`Scan complete · ${result.checked} checked · ${result.changed} release update(s)`);
    await loadOverview({ quiet: true });
  } catch (error) {
    hint.textContent = error?.message || 'Scan failed. Verify the secret and try again.';
    showToast('Repository scan failed');
  } finally {
    state.scanInProgress = false;
    button.disabled = false;
    button.classList.remove('is-loading');
    confirm.disabled = false;
  }
}

function setFilter(filter) {
  state.filter = filter;
  document.querySelectorAll('[data-filter]').forEach((button) => {
    const active = button.dataset.filter === filter;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  renderGrid();
}

function showToast(message) {
  const toast = elements.toast;
  toast.textContent = message;
  toast.classList.add('is-visible');
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2300);
}

async function copyText(value, message = 'Copied to clipboard') {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
    } else {
      const input = document.createElement('textarea');
      input.value = value;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      const success = document.execCommand('copy');
      input.remove();
      if (!success) throw new Error('Clipboard API unavailable');
    }
    showToast(message);
  } catch (error) {
    showToast('Could not copy automatically — select the command and copy it');
    console.warn('Copy failed:', error?.message || error);
  }
}

function setupInteractions() {
  elements.repoSearch.addEventListener('input', (event) => {
    state.query = event.target.value;
    renderGrid();
  });
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => setFilter(button.dataset.filter)));
  elements.sortSelect.addEventListener('change', (event) => {
    state.sort = event.target.value;
    renderGrid();
  });
  elements.refreshButton.addEventListener('click', () => loadOverview());
  elements.runScanButton.addEventListener('click', openScanDialog);
  byId('cancelScan').addEventListener('click', () => byId('scanDialog').close());
  byId('scanForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const secret = byId('scanSecret').value.trim();
    if (!secret) return;
    runManualScan(secret);
  });
  byId('scanDialog').addEventListener('click', (event) => {
    if (event.target === byId('scanDialog')) byId('scanDialog').close();
  });
  elements.clearFilters.addEventListener('click', () => {
    state.query = '';
    elements.repoSearch.value = '';
    elements.sortSelect.value = 'default';
    state.sort = 'default';
    setFilter('all');
  });
  document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', () => copyText(button.dataset.copy, `${button.dataset.copy} copied`)));

  const menuToggle = byId('mobileMenuToggle');
  const nav = byId('primaryNav');
  menuToggle.addEventListener('click', () => {
    const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', String(!isOpen));
    menuToggle.setAttribute('aria-label', isOpen ? 'Open navigation' : 'Close navigation');
    nav.classList.toggle('is-open', !isOpen);
  });
  nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    nav.classList.remove('is-open');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open navigation');
  }));

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      elements.repoSearch.focus();
    }
    if (event.key === 'Escape') {
      nav.classList.remove('is-open');
      menuToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

function init() {
  elements.repoGrid = byId('repoGrid');
  elements.emptyState = byId('emptyState');
  elements.resultCount = byId('resultCount');
  elements.countAll = byId('countAll');
  elements.repoSearch = byId('repoSearch');
  elements.sortSelect = byId('sortSelect');
  elements.syncStatus = byId('syncStatus');
  elements.syncLabel = byId('syncLabel');
  elements.syncTime = byId('syncTime');
  elements.refreshButton = byId('refreshButton');
  elements.runScanButton = byId('runScanButton');
  elements.clearFilters = byId('clearFilters');
  elements.toast = byId('toast');
  byId('currentYear').textContent = String(new Date().getFullYear());
  setupInteractions();
  state.repositories = DEFAULT_REPOSITORIES.map((repo) => ({ ...repo }));
  updateMetrics({ repositoryCount: state.repositories.length, releaseCount: 0, userCount: null });
  renderGrid();
  loadOverview({ quiet: true });
  window.setTimeout(hideAppLoader, 11000);
  // Refresh dashboard metadata quietly while the tab is visible; this is read-only and never runs a scan.
  window.setInterval(() => {
    if (!document.hidden) loadOverview({ quiet: true });
  }, 5 * 60 * 1000);
}

document.addEventListener('DOMContentLoaded', init);
