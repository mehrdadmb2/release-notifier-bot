'use strict';

const WORKER_API = 'https://release-watcher-bot.game-developer-mb.workers.dev/api/overview';
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
    description: meta.description,
    url: item.url || `https://github.com/${encodeURIComponent(item.fullName).replace('%2F', '/')}`,
    releasesUrl: item.releasesUrl || `https://github.com/${item.fullName}/releases`,
    releaseUrl: item.releaseUrl || null,
    latestTag: item.latestTag || null,
    publishedAt: item.publishedAt || null,
    lastChecked: item.lastChecked || null,
    state: item.state || (item.latestTag ? 'ok' : 'pending'),
  };
}

function currentFilterCount(filter) {
  if (filter === 'released') return state.repositories.filter((repo) => Boolean(repo.latestTag)).length;
  if (filter === 'pending') return state.repositories.filter((repo) => !repo.latestTag || ['error', 'no-release'].includes(repo.state)).length;
  return state.repositories.length;
}

function filteredRepositories() {
  const query = state.query.trim().toLowerCase();
  let items = state.repositories.filter((repo) => {
    const queryMatches = !query || `${repo.fullName} ${repo.description}`.toLowerCase().includes(query);
    let filterMatches = true;
    if (state.filter === 'released') filterMatches = Boolean(repo.latestTag);
    if (state.filter === 'pending') filterMatches = !repo.latestTag || ['error', 'no-release'].includes(repo.state);
    return queryMatches && filterMatches;
  });

  if (state.sort === 'name') items = items.slice().sort((a, b) => shortRepoName(a.fullName).localeCompare(shortRepoName(b.fullName)));
  if (state.sort === 'owner') items = items.slice().sort((a, b) => repoOwner(a.fullName).localeCompare(repoOwner(b.fullName)));
  if (state.sort === 'tag') items = items.slice().sort((a, b) => Number(Boolean(b.latestTag)) - Number(Boolean(a.latestTag)) || a.fullName.localeCompare(b.fullName));
  return items;
}

function getRepoState(repo) {
  if (repo.state === 'error') return { label: 'CHECK ISSUE', className: 'state-error' };
  if (repo.state === 'no-release') return { label: 'NO STABLE RELEASE', className: 'state-none' };
  if (repo.latestTag) return { label: 'VERSION KNOWN', className: 'state-released' };
  return { label: 'AWAITING SNAPSHOT', className: 'state-pending' };
}

function renderRepository(repo, index) {
  const displayState = getRepoState(repo);
  const dateValue = repo.publishedAt || repo.lastChecked;
  const dateLabel = repo.publishedAt ? 'Published' : 'Last checked';
  const versionValue = repo.latestTag || (repo.state === 'no-release' ? 'No stable tag' : repo.state === 'error' ? 'Retry scheduled' : 'Pending first check');
  const versionTitle = repo.latestTag ? `Known release tag ${repo.latestTag}` : versionValue;
  const releaseUrl = repo.releaseUrl && /^https:\/\//i.test(repo.releaseUrl) ? repo.releaseUrl : repo.releasesUrl;
  const safeFullName = escapeHtml(repo.fullName);
  const safeDescription = escapeHtml(repo.description);

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
      <div class="repo-data">
        <div class="repo-data-line"><span>Latest known version</span><span class="repo-version" title="${escapeHtml(versionTitle)}">${escapeHtml(versionValue)}</span></div>
        <div class="repo-data-line"><span>${dateLabel}</span><time datetime="${escapeHtml(dateValue || '')}">${escapeHtml(shortDate(dateValue) || '—')}</time></div>
      </div>
      <div class="repo-actions">
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
  byId('metricUsers').textContent = overview.userCount === undefined || overview.userCount === null ? '—' : String(overview.userCount).padStart(2, '0');
  byId('countAll').textContent = String(state.repositories.length).padStart(2, '0');
  byId('footerStatus').textContent = state.connected ? 'Worker connected' : 'Static fallback view';
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
    const detail = payload.lastChecked ? `Last check ${formatLocalDate(payload.lastChecked)}` : `Connected · snapshot ${formatLocalDate(state.lastUpdated)}`;
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
  elements.clearFilters = byId('clearFilters');
  elements.toast = byId('toast');
  byId('currentYear').textContent = String(new Date().getFullYear());
  setupInteractions();
  state.repositories = DEFAULT_REPOSITORIES.map((repo) => ({ ...repo }));
  updateMetrics({ repositoryCount: state.repositories.length, releaseCount: 0, userCount: null });
  renderGrid();
  loadOverview({ quiet: true });
  // Refresh dashboard metadata quietly while the tab is visible.
  window.setInterval(() => {
    if (!document.hidden) loadOverview({ quiet: true });
  }, 5 * 60 * 1000);
}

document.addEventListener('DOMContentLoaded', init);
