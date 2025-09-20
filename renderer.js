const chatEl = document.getElementById('chat');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const apiKeyEl = document.getElementById('apiKey');
const modelEl = document.getElementById('model');
const sysEl = document.getElementById('system');
const saveCfgBtn = document.getElementById('saveCfg');
const clearBtn = document.getElementById('clear');
const apiBtn = document.getElementById('apiMode');
const webBtn = document.getElementById('webMode');
const codexBtn = document.getElementById('codexMode');
const sendOtherBtn = document.getElementById('sendOther');
const logoutWebBtn = document.getElementById('logoutWeb');
const logoutCodexBtn = document.getElementById('logoutCodex');
const refreshBtn = document.getElementById('refresh');
const apiPane = document.getElementById('apiPane');
const webPane = document.getElementById('webPane');
const codexPane = document.getElementById('codexPane');
const webView = document.getElementById('webView') || null;
const codexView = document.getElementById('codexView') || null;
const baseUrlEl = document.getElementById('baseUrl');
const apiKindEl = document.getElementById('apiKind');
const downloadsBtn = document.getElementById('downloadsBtn');
const webNavGroup = document.getElementById('webNavGroup');
const webBackBtn = document.getElementById('webBack');
const webForwardBtn = document.getElementById('webForward');
const webHomeBtn = document.getElementById('webHome');
const codexNavGroup = document.getElementById('codexNavGroup');
const codexBackBtn = document.getElementById('codexBack');
const codexForwardBtn = document.getElementById('codexForward');
const codexHomeBtn = document.getElementById('codexHome');
const codexRepoSelect = document.getElementById('codexRepoSelect');
// Note: downloadsPanel/downloadsList are defined after the script tag in index.html.
// Query them at use-time to avoid nulls on initial load.
const DRAFT_KEY = 'draft';
const startParams = new URLSearchParams(location.search);
const queryWebUrl = startParams.get('webUrl') || startParams.get('plusUrl');
const queryCodexUrl = startParams.get('codexUrl') || startParams.get('playgroundUrl');
const queryModeRaw = startParams.get('mode');
const queryMode = queryModeRaw ? queryModeRaw.toLowerCase() : null;
const WEB_URL_KEY = 'webLastUrl';
const LEGACY_PLUS_URL_KEY = 'plusLastUrl';
const CODEX_URL_KEY = 'codexLastUrl';
const LEGACY_PLAYGROUND_URL_KEY = 'playgroundLastUrl';

const MODE_API = 'api';
const MODE_WEB = 'web';
const LEGACY_MODE_PLUS = 'plus';
const MODE_CODEX = 'codex';
const LEGACY_MODE_PLAYGROUND = 'playground';
const DEFAULT_WEB_HOME = 'https://chat.openai.com';
const DEFAULT_CODEX_HOME = 'https://platform.openai.com/playground';

function normalizeMode(value) {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower === MODE_API || lower === MODE_WEB || lower === MODE_CODEX) return lower;
  if (lower === LEGACY_MODE_PLUS) return MODE_WEB;
  if (lower === LEGACY_MODE_PLAYGROUND) return MODE_CODEX;
  return null;
}

let lastWebUrl = null;
let lastPersistedWebUrl = null;

let lastCodexUrl = null;
let lastPersistedCodexUrl = null;

let webHomeUrl = DEFAULT_WEB_HOME;
let codexHomeUrl = DEFAULT_CODEX_HOME;
let codexRepos = [];
let manualCodexRepos = [];
let codexGithubRepos = [];
let codexGithubOwner = '';
let codexGithubToken = '';
let codexGithubIncludePrivate = false;
let codexGithubFetching = false;
let codexGithubLastError = null;
let codexGithubFetchSeq = 0;

function isPersistableHttpUrl(url) {
  return typeof url === 'string' && /^https?:/i.test(url.trim());
}

function isPersistableWebUrl(url) {
  return isPersistableHttpUrl(url);
}

function rememberWebUrl(url) {
  if (!isPersistableHttpUrl(url)) return;
  lastWebUrl = url.trim();
}

async function flushWebUrl(force = false) {
  if (!isPersistableHttpUrl(lastWebUrl)) return;
  if (!force && lastWebUrl === lastPersistedWebUrl) return;
  if (!window.VoidDesk?.cfg?.set) return;
  lastPersistedWebUrl = lastWebUrl;
  try {
    await Promise.all([
      window.VoidDesk.cfg.set(WEB_URL_KEY, lastWebUrl),
      window.VoidDesk.cfg.set(LEGACY_PLUS_URL_KEY, lastWebUrl),
    ]);
  } catch (err) {
    console.warn('Failed to persist Web URL:', err);
  }
}

function rememberCodexUrl(url) {
  if (!isPersistableHttpUrl(url)) return;
  lastCodexUrl = url.trim();
}

async function flushCodexUrl(force = false) {
  if (!isPersistableHttpUrl(lastCodexUrl)) return;
  if (!force && lastCodexUrl === lastPersistedCodexUrl) return;
  if (!window.VoidDesk?.cfg?.set) return;
  lastPersistedCodexUrl = lastCodexUrl;
  try {
    await Promise.all([
      window.VoidDesk.cfg.set(CODEX_URL_KEY, lastCodexUrl),
      window.VoidDesk.cfg.set(LEGACY_PLAYGROUND_URL_KEY, lastCodexUrl),
    ]);
  } catch (err) {
    console.warn('Failed to persist Codex URL:', err);
  }
}

function sanitizeHomeUrl(value, fallback) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return isPersistableHttpUrl(trimmed) ? trimmed : fallback;
}

function normalizeRepoEntry(raw) {
  if (!raw) return null;
  let url = '';
  let label = '';
  if (typeof raw === 'string') {
    url = raw;
    label = raw;
  } else if (typeof raw === 'object') {
    if (typeof raw.url === 'string') url = raw.url;
    else if (typeof raw.href === 'string') url = raw.href;
    if (typeof raw.label === 'string') label = raw.label;
    else if (typeof raw.name === 'string') label = raw.name;
  }
  url = (url || '').trim();
  if (!isPersistableHttpUrl(url)) return null;
  label = (label || '').trim();
  if (!label) label = url.replace(/^https?:\/\//i, '');
  return { label, url };
}

function normalizeRepoList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const normalized = normalizeRepoEntry(item);
    if (!normalized) continue;
    if (seen.has(normalized.url)) continue;
    seen.add(normalized.url);
    out.push(normalized);
  }
  return out;
}

function parseRepoText(text) {
  if (typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const entries = [];
  for (const line of lines) {
    let label = '';
    let url = '';
    const idx = line.indexOf('|');
    if (idx >= 0) {
      label = line.slice(0, idx).trim();
      url = line.slice(idx + 1).trim();
    } else {
      label = line;
      url = line;
    }
    if (!isPersistableHttpUrl(url)) continue;
    if (!label) label = url.replace(/^https?:\/\//i, '');
    entries.push({ label, url });
  }
  return normalizeRepoList(entries);
}

function formatRepoText(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return list.map(item => `${item.label} | ${item.url}`).join('\n');
}

function appendRepoOptions(parent, list) {
  if (!parent || !Array.isArray(list)) return;
  for (const repo of list) {
    if (!repo || !repo.url) continue;
    const opt = document.createElement('option');
    opt.value = repo.url;
    opt.textContent = repo.label || repo.url;
    parent.appendChild(opt);
  }
}

function populateCodexRepoSelect() {
  if (!codexRepoSelect) return;

  codexRepoSelect.innerHTML = '';
  const manualCount = Array.isArray(manualCodexRepos) ? manualCodexRepos.length : 0;
  const githubCount = Array.isArray(codexGithubRepos) ? codexGithubRepos.length : 0;
  const totalCount = codexRepos.length;

  const placeholder = document.createElement('option');
  placeholder.value = '';
  if (codexGithubFetching) {
    placeholder.textContent = 'Loading GitHub repos…';
  } else if (totalCount > 0) {
    placeholder.textContent = 'Repos…';
  } else if (codexGithubOwner) {
    placeholder.textContent = codexGithubLastError ? 'GitHub repos unavailable' : 'No GitHub repos found';
  } else {
    placeholder.textContent = 'No repos configured';
  }
  codexRepoSelect.appendChild(placeholder);

  const needsGrouping = manualCount > 0 && githubCount > 0;
  if (manualCount > 0) {
    if (needsGrouping) {
      const manualGroup = document.createElement('optgroup');
      manualGroup.label = 'Manual';
      appendRepoOptions(manualGroup, manualCodexRepos);
      codexRepoSelect.appendChild(manualGroup);
    } else {
      appendRepoOptions(codexRepoSelect, manualCodexRepos);
    }
  }

  if (githubCount > 0) {
    const label = codexGithubOwner ? `GitHub – ${codexGithubOwner}` : 'GitHub';
    if (needsGrouping) {
      const githubGroup = document.createElement('optgroup');
      githubGroup.label = label;
      appendRepoOptions(githubGroup, codexGithubRepos);
      codexRepoSelect.appendChild(githubGroup);
    } else {
      appendRepoOptions(codexRepoSelect, codexGithubRepos);
    }
  }

  codexRepoSelect.value = '';
  codexRepoSelect.classList.toggle('loading', codexGithubFetching);
  codexRepoSelect.disabled = totalCount === 0 && !codexGithubFetching;

  let title = 'Configure repository links in Settings';
  if (codexGithubFetching) {
    title = 'Loading GitHub repositories…';
  } else if (totalCount > 0) {
    title = 'Open configured repository in Codex';
  } else if (codexGithubOwner) {
    title = codexGithubLastError
      ? `Failed to load GitHub repos for ${codexGithubOwner}`
      : `No repositories found for ${codexGithubOwner}`;
  }
  codexRepoSelect.title = title;
}

function recomputeCodexRepos() {
  const combined = [];
  if (Array.isArray(manualCodexRepos) && manualCodexRepos.length) {
    combined.push(...manualCodexRepos);
  }
  if (Array.isArray(codexGithubRepos) && codexGithubRepos.length) {
    combined.push(...codexGithubRepos);
  }
  codexRepos = normalizeRepoList(combined);
  populateCodexRepoSelect();
}

async function readGithubResponseError(resp) {
  if (!resp) return '';
  try {
    const ct = resp.headers?.get?.('content-type') || '';
    if (ct.includes('json')) {
      const data = await resp.json();
      if (data && typeof data.message === 'string') {
        return data.message.trim();
      }
    } else {
      const text = await resp.text();
      if (text) return text.trim().split('\n')[0];
    }
  } catch (_) {}
  return '';
}

async function fetchGithubReposFromApi(owner, token, includePrivate) {
  const trimmedOwner = (owner || '').trim();
  if (!trimmedOwner) return [];

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'VoidDesk',
  };
  const bearer = (token || '').trim();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const ownerResp = await fetch(`https://api.github.com/users/${encodeURIComponent(trimmedOwner)}`, { headers });
  if (ownerResp.status === 404) {
    throw new Error(`GitHub account "${trimmedOwner}" was not found`);
  }
  if (!ownerResp.ok) {
    const message = await readGithubResponseError(ownerResp);
    throw new Error(message || `GitHub lookup failed (${ownerResp.status})`);
  }
  const ownerData = await ownerResp.json();
  const ownerLogin = typeof ownerData?.login === 'string' ? ownerData.login : trimmedOwner;
  const ownerType = typeof ownerData?.type === 'string' ? ownerData.type : 'User';
  const ownerLoginLower = ownerLogin.toLowerCase();

  const wantsPrivate = !!includePrivate && !!bearer;
  const params = new URLSearchParams();
  params.set('per_page', '100');
  params.set('sort', 'updated');

  let endpoint = '';
  if (ownerType.toLowerCase() === 'organization') {
    endpoint = `https://api.github.com/orgs/${encodeURIComponent(ownerLogin)}/repos`;
    params.set('type', wantsPrivate ? 'all' : 'public');
  } else if (wantsPrivate) {
    endpoint = 'https://api.github.com/user/repos';
    params.set('affiliation', 'owner');
    params.set('visibility', 'all');
  } else {
    endpoint = `https://api.github.com/users/${encodeURIComponent(ownerLogin)}/repos`;
    params.set('type', 'owner');
  }

  const repos = [];
  const maxPages = 5;
  for (let page = 1; page <= maxPages; page += 1) {
    params.set('page', String(page));
    const url = `${endpoint}?${params.toString()}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      const message = await readGithubResponseError(resp);
      throw new Error(message || `GitHub repo request failed (${resp.status})`);
    }
    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) break;
    for (const repo of data) {
      if (!repo || typeof repo !== 'object') continue;
      if (!repo.html_url) continue;
      const ownerLoginForRepo = repo.owner?.login ? String(repo.owner.login).toLowerCase() : '';
      if (ownerLoginForRepo && ownerLoginForRepo !== ownerLoginLower) continue;
      if (!wantsPrivate && repo.private) continue;
      const label = repo.full_name || repo.name || repo.html_url;
      repos.push({ label, url: repo.html_url });
    }
    if (data.length < 100) break;
  }

  return normalizeRepoList(repos);
}

async function refreshGithubRepos({ silent = false, resetExisting = false } = {}) {
  const owner = (codexGithubOwner || '').trim();
  const token = (codexGithubToken || '').trim();
  const includePrivate = !!codexGithubIncludePrivate && !!token;
  const seq = ++codexGithubFetchSeq;

  if (resetExisting) {
    codexGithubRepos = [];
    codexGithubLastError = null;
    recomputeCodexRepos();
  }

  if (!owner) {
    codexGithubFetching = false;
    codexGithubRepos = [];
    codexGithubLastError = null;
    recomputeCodexRepos();
    return;
  }

  codexGithubFetching = true;
  codexGithubLastError = null;
  populateCodexRepoSelect();

  try {
    const repos = await fetchGithubReposFromApi(owner, token, includePrivate);
    if (seq !== codexGithubFetchSeq) return;
    codexGithubRepos = repos;
    codexGithubLastError = null;
  } catch (err) {
    if (seq !== codexGithubFetchSeq) return;
    codexGithubRepos = [];
    codexGithubLastError = err instanceof Error ? err : new Error(String(err || 'GitHub error'));
    if (!silent) {
      const message = codexGithubLastError.message || 'Failed to load GitHub repos';
      createToast(message, { duration: 8000 });
    }
  } finally {
    if (seq === codexGithubFetchSeq) {
      codexGithubFetching = false;
      recomputeCodexRepos();
    }
  }
}

function updateWebNavState() {
  if (webHomeBtn) webHomeBtn.disabled = !webView;
  if (!webView) {
    if (webBackBtn) webBackBtn.disabled = true;
    if (webForwardBtn) webForwardBtn.disabled = true;
    return;
  }
  try {
    const canBack = !!webView.canGoBack?.();
    const canForward = !!webView.canGoForward?.();
    if (webBackBtn) webBackBtn.disabled = !canBack;
    if (webForwardBtn) webForwardBtn.disabled = !canForward;
  } catch {
    if (webBackBtn) webBackBtn.disabled = true;
    if (webForwardBtn) webForwardBtn.disabled = true;
  }
}

function updateCodexNavState() {
  if (codexHomeBtn) codexHomeBtn.disabled = !codexView;
  if (!codexView) {
    if (codexBackBtn) codexBackBtn.disabled = true;
    if (codexForwardBtn) codexForwardBtn.disabled = true;
    return;
  }
  try {
    const canBack = !!codexView.canGoBack?.();
    const canForward = !!codexView.canGoForward?.();
    if (codexBackBtn) codexBackBtn.disabled = !canBack;
    if (codexForwardBtn) codexForwardBtn.disabled = !canForward;
  } catch {
    if (codexBackBtn) codexBackBtn.disabled = true;
    if (codexForwardBtn) codexForwardBtn.disabled = true;
  }
}

// One-time setup for draft saving and unload
inputEl.addEventListener('input', () => {
  window.VoidDesk.cfg.set(DRAFT_KEY, inputEl.value);
});

window.addEventListener('beforeunload', () => {
  window.VoidDesk.cfg.set('history', history);
  window.VoidDesk.cfg.set('scrollPos', chatEl.scrollTop);
  window.VoidDesk.cfg.set(DRAFT_KEY, inputEl.value);
  const webUrl = webView?.getURL?.() || webView?.src;
  if (webUrl) {
    rememberWebUrl(webUrl);
    flushWebUrl(true).catch(() => {});
  }
  const codexUrl = codexView?.getURL?.() || codexView?.src;
  if (codexUrl) {
    rememberCodexUrl(codexUrl);
    flushCodexUrl(true).catch(() => {});
  }
});

let history = [];            // [{role, content}]
let mode = MODE_API;         // 'api' | 'web' | 'codex'
let scrollPos = 0;           // remember API pane scroll
let toastsEl;                // lazy mini status area
let lastNonApiMode = MODE_WEB;

function ensureToastsEl() {
  if (!toastsEl) toastsEl = document.getElementById('toasts');
  return toastsEl;
}

function createToast(text, { duration = 7000 } = {}) {
  const container = ensureToastsEl();
  if (!container) return null;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  container.appendChild(el);
  if (duration > 0) {
    setTimeout(() => el.remove(), duration);
  }
  return el;
}

// ---------- helper: stable restart of the refresh animation ----------
// Helper to toggle "Hard Reload" affordance
function setRefreshDanger(on) {
  if (!refreshBtn) return;
  refreshBtn.classList.toggle('danger', on);
  const span = refreshBtn.querySelector('span');
  if (span) span.textContent = on ? 'Hard Reload' : 'Refresh';
}

// Shift/hard reload UX logic
let shiftDown = false;
window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift' && !shiftDown) {
    shiftDown = true;
    const hovered = refreshBtn.matches(':hover, :focus');
    setRefreshDanger(hovered);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') {
    shiftDown = false;
    setRefreshDanger(false);
  }
});
refreshBtn.addEventListener('mouseenter', () => setRefreshDanger(shiftDown));
refreshBtn.addEventListener('mouseleave', () => setRefreshDanger(false));
refreshBtn.addEventListener('focus', () => setRefreshDanger(shiftDown));
refreshBtn.addEventListener('blur', () => setRefreshDanger(false));
// Define once at startup (fix: was being added inside startRefreshAnim)
window.addEventListener('focus', () => {
  if (mode === 'api') inputEl?.focus();
});

// Refresh animation state
let refreshActive = false;
let refreshWatch = null;

function startRefreshAnim() {
  if (!refreshBtn) return;
  if (refreshActive) return; // don't keep restarting it
  refreshActive = true;

  refreshBtn.classList.remove('knight');
  requestAnimationFrame(() => {
    void refreshBtn.offsetWidth;
    refreshBtn.classList.add('knight');
  });

  // Watchdog: clear if no stop event arrives
  clearTimeout(refreshWatch);
  refreshWatch = setTimeout(() => {
    refreshActive = false;
    refreshBtn.classList.remove('knight');
    setRefreshDanger(false);
  }, 4000);
}

function stopRefreshAnim() {
  if (!refreshBtn) return;
  refreshActive = false;
  refreshBtn.classList.remove('knight');
  clearTimeout(refreshWatch);
  refreshWatch = null;
  setRefreshDanger(false);
}

async function performHardReload() {
  startRefreshAnim();
  try {
    const url = webView?.getURL?.() || webView?.src;
    if (url) rememberWebUrl(url);
    await flushWebUrl(true);
    const codexUrl = codexView?.getURL?.() || codexView?.src;
    if (codexUrl) rememberCodexUrl(codexUrl);
    await flushCodexUrl(true);
    if (window.VoidDesk?.app?.hardReload) {
      await window.VoidDesk.app.hardReload();
      return;
    }
    if (window.VoidDesk?.app?.relaunch) {
      await window.VoidDesk.app.relaunch();
      return;
    }
    throw new Error('No hard reload bridge available');
  } catch (err) {
    console.warn('Hard reload failed:', err);
    stopRefreshAnim();
  }
}

if (window.VoidDesk?.hotkeys?.onHardReload) {
  window.VoidDesk.hotkeys.onHardReload(() => { void performHardReload(); });
}

// Clear any stuck “Hard Reload” state if tab visibility changes
document.addEventListener('visibilitychange', () => setRefreshDanger(false));

// ---------- Mode switching ----------
function setMode(next) {
  const resolved = normalizeMode(next) || MODE_API;
  mode = resolved;

  apiPane?.classList.toggle('hidden', mode !== MODE_API);
  webPane?.classList.toggle('hidden', mode !== MODE_WEB);
  codexPane?.classList.toggle('hidden', mode !== MODE_CODEX);
  apiBtn?.classList.toggle('active', mode === MODE_API);
  webBtn?.classList.toggle('active', mode === MODE_WEB);
  codexBtn?.classList.toggle('active', mode === MODE_CODEX);

  if (webNavGroup) webNavGroup.style.display = (mode === MODE_WEB) ? 'inline-flex' : 'none';
  if (codexNavGroup) codexNavGroup.style.display = (mode === MODE_CODEX) ? 'inline-flex' : 'none';
  if (mode === MODE_WEB) updateWebNavState();
  if (mode === MODE_CODEX) updateCodexNavState();

  const apiControls = [
    apiKeyEl?.closest('label'),
    modelEl?.closest('label'),
    baseUrlEl?.closest('label'),
    apiKindEl?.closest('label'),
    document.getElementById('clear'),
    document.getElementById('system')?.closest('label')
  ];
  for (const el of apiControls) if (el) el.style.display = (mode === MODE_API) ? 'flex' : 'none';

  const webControls = [logoutWebBtn];
  for (const el of webControls) if (el) el.style.display = (mode === MODE_WEB) ? 'flex' : 'none';

  const codexControls = [logoutCodexBtn];
  for (const el of codexControls) if (el) el.style.display = (mode === MODE_CODEX) ? 'flex' : 'none';

  const footer = document.querySelector('footer');
  if (footer) footer.style.display = (mode === MODE_API) ? 'flex' : 'none';

  if (mode === MODE_API) {
    inputEl?.focus();
    chatEl.scrollTop = scrollPos;
  } else if (mode === MODE_WEB || mode === MODE_CODEX) {
    lastNonApiMode = mode;
  }

  // Only persist if changed
  window.VoidDesk.cfg.get('mode').then(prev => {
    if (prev !== mode) window.VoidDesk.cfg.set('mode', mode);
  });
}

// ---------- Message rendering ----------
function renderMsg(role, content) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = content;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
  return div;
}

function renderHistory() {
  chatEl.innerHTML = '';
  for (const msg of history) renderMsg(msg.role, msg.content);
}

function pushMsg(role, content) {
  history.push({ role, content });
  return renderMsg(role, content);
}

// ---------- Config load/save ----------
async function loadCfg() {
  ensureToastsEl();
  const draft = await window.VoidDesk.cfg.get(DRAFT_KEY);
  if (draft) {
    inputEl.value = draft;
    // Place caret at the end of the restored draft
    try { inputEl.setSelectionRange(draft.length, draft.length); } catch {}
  }

  const [
    k,
    m,
    s,
    savedHistory,
    savedMode,
    baseUrl,
    apiKind,
    savedScroll,
    savedWebUrl,
    savedLegacyPlusUrl,
    savedCodexUrl,
    savedLegacyPlaygroundUrl,
    savedWebHome,
    savedCodexHome,
    savedCodexRepos,
    savedCodexGithubOwner,
    savedCodexGithubToken,
    savedCodexGithubIncludePrivate,
  ] = await Promise.all([
    window.VoidDesk.cfg.get('apiKey'),
    window.VoidDesk.cfg.get('model'),
    window.VoidDesk.cfg.get('system'),
    window.VoidDesk.cfg.get('history'),
    window.VoidDesk.cfg.get('mode'),
    window.VoidDesk.cfg.get('baseUrl'),
    window.VoidDesk.cfg.get('apiKind'),
    window.VoidDesk.cfg.get('scrollPos'),
    window.VoidDesk.cfg.get(WEB_URL_KEY),
    window.VoidDesk.cfg.get(LEGACY_PLUS_URL_KEY),
    window.VoidDesk.cfg.get(CODEX_URL_KEY),
    window.VoidDesk.cfg.get(LEGACY_PLAYGROUND_URL_KEY),
    window.VoidDesk.cfg.get('webHomeUrl'),
    window.VoidDesk.cfg.get('codexHomeUrl'),
    window.VoidDesk.cfg.get('codexRepos'),
    window.VoidDesk.cfg.get('codexGithubOwner'),
    window.VoidDesk.cfg.get('codexGithubToken'),
    window.VoidDesk.cfg.get('codexGithubIncludePrivate'),
  ]);

  apiKeyEl.value = k || '';
  modelEl.value = m || 'gpt-4o'; // <-- fix: default to a valid dropdown option
  sysEl.value   = s || '';
  baseUrlEl.value = baseUrl || 'https://api.openai.com';
  apiKindEl.value = apiKind || 'responses';

  history = Array.isArray(savedHistory) ? savedHistory.slice() : [];
  renderHistory();

  if (typeof savedScroll === 'number') scrollPos = savedScroll;

  const storedWebUrlRaw = typeof savedWebUrl === 'string' ? savedWebUrl.trim() : '';
  const legacyWebUrlRaw = typeof savedLegacyPlusUrl === 'string' ? savedLegacyPlusUrl.trim() : '';
  const requestedWebUrl = typeof queryWebUrl === 'string' ? queryWebUrl.trim() : '';
  const storedCodexUrlRaw = typeof savedCodexUrl === 'string' ? savedCodexUrl.trim() : '';
  const legacyCodexUrlRaw = typeof savedLegacyPlaygroundUrl === 'string' ? savedLegacyPlaygroundUrl.trim() : '';
  const requestedCodexUrl = typeof queryCodexUrl === 'string' ? queryCodexUrl.trim() : '';

  const storedWebUrl = isPersistableHttpUrl(storedWebUrlRaw) ? storedWebUrlRaw : '';
  const legacyWebUrl = isPersistableHttpUrl(legacyWebUrlRaw) ? legacyWebUrlRaw : '';
  const storedCodexUrl = isPersistableHttpUrl(storedCodexUrlRaw) ? storedCodexUrlRaw : '';
  const legacyCodexUrl = isPersistableHttpUrl(legacyCodexUrlRaw) ? legacyCodexUrlRaw : '';

  const persistedWebUrl = storedWebUrl || legacyWebUrl;
  const persistedCodexUrl = storedCodexUrl || legacyCodexUrl;
  if (isPersistableWebUrl(persistedWebUrl)) {
    lastPersistedWebUrl = persistedWebUrl;
  }

  if (isPersistableHttpUrl(persistedCodexUrl)) {
    lastPersistedCodexUrl = persistedCodexUrl;
  }

  webHomeUrl = sanitizeHomeUrl(savedWebHome, DEFAULT_WEB_HOME);
  codexHomeUrl = sanitizeHomeUrl(savedCodexHome, DEFAULT_CODEX_HOME);

  manualCodexRepos = normalizeRepoList(savedCodexRepos);
  codexGithubOwner = typeof savedCodexGithubOwner === 'string' ? savedCodexGithubOwner.trim() : '';
  codexGithubToken = typeof savedCodexGithubToken === 'string' ? savedCodexGithubToken.trim() : '';
  codexGithubIncludePrivate = !!savedCodexGithubIncludePrivate && !!codexGithubToken;
  codexGithubRepos = [];
  codexGithubLastError = null;
  recomputeCodexRepos();
  refreshGithubRepos({ silent: true, resetExisting: true }).catch(() => {});

  const initialWebUrl = isPersistableWebUrl(requestedWebUrl)
    ? requestedWebUrl
    : (persistedWebUrl || null);

  if (webView && initialWebUrl) {
    if (webView.src !== initialWebUrl) {
      webView.src = initialWebUrl;
    }
    rememberWebUrl(initialWebUrl);
  }

  const initialCodexUrl = isPersistableHttpUrl(requestedCodexUrl)
    ? requestedCodexUrl
    : (persistedCodexUrl || null);

  if (codexView && initialCodexUrl) {
    if (codexView.src !== initialCodexUrl) {
      codexView.src = initialCodexUrl;
    }
    rememberCodexUrl(initialCodexUrl);
  }

  const initialMode = normalizeMode(queryMode)
    || normalizeMode(savedMode)
    || MODE_WEB;

  setMode(initialMode);

  if (isPersistableWebUrl(requestedWebUrl) && initialMode !== MODE_WEB) {
    setMode(MODE_WEB);
  }

  if (isPersistableHttpUrl(requestedCodexUrl) && mode !== MODE_CODEX) {
    setMode(MODE_CODEX);
  }

  // Keep animation in sync with the Web view network state
  if (webView) {
    webView.addEventListener('did-start-loading', startRefreshAnim);
    webView.addEventListener('did-stop-loading', stopRefreshAnim);
    webView.addEventListener('did-finish-load', stopRefreshAnim);
    webView.addEventListener('did-fail-load', stopRefreshAnim);
    webView.addEventListener('did-start-loading', updateWebNavState);
    webView.addEventListener('did-stop-loading', updateWebNavState);
    webView.addEventListener('did-fail-load', updateWebNavState);

    const trackWebNavigation = (event) => {
      const navUrl = event?.url || webView?.getURL?.();
      if (!navUrl) return;
      rememberWebUrl(navUrl);
      flushWebUrl().catch(() => {});
      updateWebNavState();
    };

    webView.addEventListener('did-navigate', trackWebNavigation);
    webView.addEventListener('did-navigate-in-page', trackWebNavigation);
    webView.addEventListener('did-redirect-navigation', trackWebNavigation);
    webView.addEventListener('page-title-updated', trackWebNavigation);
    webView.addEventListener('dom-ready', () => {
      const navUrl = webView?.getURL?.();
      if (!navUrl) return;
      rememberWebUrl(navUrl);
      flushWebUrl().catch(() => {});
      updateWebNavState();
    });
  }

  if (codexView) {
    codexView.addEventListener('did-start-loading', startRefreshAnim);
    codexView.addEventListener('did-stop-loading', stopRefreshAnim);
    codexView.addEventListener('did-finish-load', stopRefreshAnim);
    codexView.addEventListener('did-fail-load', (event) => {
      stopRefreshAnim();
      try {
        if (event && event.isMainFrame !== false) {
          if (event.errorCode === -3 || event.errorCode === -27) return; // Ignore abort/back-forward and offline reloads
          const desc = event.errorDescription || `error ${event.errorCode}`;
          createToast(`Codex failed to load: ${desc}`, { duration: 8000 });
        }
      } catch {}
    });
    codexView.addEventListener('did-start-loading', updateCodexNavState);
    codexView.addEventListener('did-stop-loading', updateCodexNavState);
    codexView.addEventListener('did-fail-load', updateCodexNavState);

    const trackCodexNavigation = (event) => {
      const navUrl = event?.url || codexView?.getURL?.();
      if (!navUrl) return;
      rememberCodexUrl(navUrl);
      flushCodexUrl().catch(() => {});
      updateCodexNavState();
    };

    codexView.addEventListener('did-navigate', trackCodexNavigation);
    codexView.addEventListener('did-navigate-in-page', trackCodexNavigation);
    codexView.addEventListener('did-redirect-navigation', trackCodexNavigation);
    codexView.addEventListener('page-title-updated', trackCodexNavigation);
    codexView.addEventListener('dom-ready', () => {
      const navUrl = codexView?.getURL?.();
      if (!navUrl) return;
      rememberCodexUrl(navUrl);
      flushCodexUrl().catch(() => {});
      updateCodexNavState();
    });
  }

  updateWebNavState();
  updateCodexNavState();
}

async function saveCfg() {
  await Promise.all([
    window.VoidDesk.cfg.set('apiKey', apiKeyEl.value.trim()),
    window.VoidDesk.cfg.set('model', modelEl.value),
    window.VoidDesk.cfg.set('system', sysEl.value),
    window.VoidDesk.cfg.set('history', history),
    window.VoidDesk.cfg.set('baseUrl', baseUrlEl.value.trim() || 'https://api.openai.com'),
    window.VoidDesk.cfg.set('apiKind', apiKindEl.value),
    window.VoidDesk.cfg.set('scrollPos', chatEl.scrollTop),
  ]);
}

// ---------- Buttons & actions ----------
saveCfgBtn.addEventListener('click', saveCfg);

clearBtn.addEventListener('click', async () => {
  history = [];
  chatEl.innerHTML = '';
  await saveCfg();
});

apiBtn.addEventListener('click', () => setMode(MODE_API));
webBtn.addEventListener('click', () => setMode(MODE_WEB));
codexBtn?.addEventListener('click', () => setMode(MODE_CODEX));

logoutWebBtn.addEventListener('click', async () => {
  const logout = window.VoidDesk.web?.logout || window.VoidDesk.plus?.logout;
  await logout?.();
  if (webView) webView.loadURL('https://chat.openai.com');
});

logoutCodexBtn?.addEventListener('click', async () => {
  const logout = window.VoidDesk.codex?.logout;
  await logout?.();
  if (codexView) codexView.loadURL('https://platform.openai.com/playground');
});

webBackBtn?.addEventListener('click', () => {
  try { if (webView?.canGoBack?.()) webView.goBack(); } catch {}
});

webForwardBtn?.addEventListener('click', () => {
  try { if (webView?.canGoForward?.()) webView.goForward(); } catch {}
});

webHomeBtn?.addEventListener('click', () => {
  if (!webView) return;
  const target = sanitizeHomeUrl(webHomeUrl, DEFAULT_WEB_HOME);
  if (target) {
    try { webView.loadURL(target); } catch {}
  }
});

codexBackBtn?.addEventListener('click', () => {
  try { if (codexView?.canGoBack?.()) codexView.goBack(); } catch {}
});

codexForwardBtn?.addEventListener('click', () => {
  try { if (codexView?.canGoForward?.()) codexView.goForward(); } catch {}
});

codexHomeBtn?.addEventListener('click', () => {
  if (!codexView) return;
  const target = sanitizeHomeUrl(codexHomeUrl, DEFAULT_CODEX_HOME);
  if (target) {
    try { codexView.loadURL(target); } catch {}
  }
});

codexRepoSelect?.addEventListener('change', () => {
  const url = codexRepoSelect.value;
  if (!isPersistableHttpUrl(url)) {
    codexRepoSelect.value = '';
    return;
  }
  if (codexView) {
    try { codexView.loadURL(url); } catch {}
  } else {
    window.open(url, '_blank');
  }
  codexRepoSelect.value = '';
});

// Universal refresh (soft / hard via Shift)
refreshBtn.addEventListener('click', async (e) => {
  // Shift+Click → Hard reload (ignores cache for Web or reloads the whole app)
  if (e.shiftKey) {
    await performHardReload();
    return;
  }

  // Normal soft refresh
  if (mode === MODE_API) {
    startRefreshAnim();
    renderHistory();
    await new Promise(r => setTimeout(r, 1400)); // show a couple of pings
    stopRefreshAnim();
  } else if (mode === MODE_WEB && webView) {
    webView.reload(); // did-start/stop will control the animation
  } else if (mode === MODE_CODEX && codexView) {
    codexView.reload();
  }
});

// Send selection to the other mode
sendOtherBtn.addEventListener('click', () => {
  const sel = window.getSelection().toString() || inputEl.value;
  if (!sel) return;

  if (mode === MODE_API) {
    const payload = JSON.stringify(sel);
    const script = `
      (function () {
        const t = ${payload};
        const active = document.activeElement;
        if (active) {
          if (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT') {
            const start = active.selectionStart ?? active.value.length;
            const end = active.selectionEnd ?? active.value.length;
            active.setRangeText((start ? "\\n\\n" : "") + t, start, end, 'end');
            active.dispatchEvent(new Event('input', { bubbles: true }));
          } else if (active.isContentEditable) {
            active.textContent += (active.textContent ? "\\n\\n" : "") + t;
          }
        }
      })();
    `;

    const targetMode = (lastNonApiMode === MODE_CODEX && codexView) ? MODE_CODEX : MODE_WEB;
    if (targetMode === MODE_CODEX && codexView) {
      codexView.executeJavaScript(script).catch(() => {});
    } else if (webView) {
      webView.executeJavaScript(script).catch(() => {});
    }
    setMode(targetMode);
  } else {
    inputEl.value += (inputEl.value ? '\n\n' : '') + sel;
    setMode(MODE_API);
    inputEl.focus();
  }
});

// ---------- Hotkeys ----------
window.addEventListener('keydown', async (e) => {
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    const key = e.key || '';
    if (key === 'ArrowLeft') {
      if (mode === MODE_WEB && webView?.canGoBack?.()) {
        e.preventDefault();
        try { webView.goBack(); } catch {}
        return;
      }
      if (mode === MODE_CODEX && codexView?.canGoBack?.()) {
        e.preventDefault();
        try { codexView.goBack(); } catch {}
        return;
      }
    } else if (key === 'ArrowRight') {
      if (mode === MODE_WEB && webView?.canGoForward?.()) {
        e.preventDefault();
        try { webView.goForward(); } catch {}
        return;
      }
      if (mode === MODE_CODEX && codexView?.canGoForward?.()) {
        e.preventDefault();
        try { codexView.goForward(); } catch {}
        return;
      }
    } else if (key.toLowerCase() === 'h') {
      e.preventDefault();
      if (mode === MODE_WEB) {
        webHomeBtn?.click();
      } else if (mode === MODE_CODEX) {
        codexHomeBtn?.click();
      }
      return;
    }
  }

  // Send to other (Ctrl/Cmd+Shift+S)
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key || '').toLowerCase() === 's') {
    e.preventDefault();
    sendOtherBtn.click();
    return;
  }
  // Hard reload (Ctrl/Cmd+Shift+R)
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key || '').toLowerCase() === 'r') {
    e.preventDefault();
    await performHardReload();
    return;
  }
  // Downloads panel (Ctrl/Cmd+J)
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'j') {
    e.preventDefault();
    toggleDownloads();
  }
});

// Persist scroll position
chatEl.addEventListener('scroll', () => {
  if (mode === MODE_API) scrollPos = chatEl.scrollTop;
});

// ---------- API helpers ----------
function toResponsesInput(_sys, msgs) {
  const input = [];
  for (const m of msgs) {
    if (m.role === 'user') {
      input.push({ role: 'user', content: [{ type: 'input_text', text: m.content }] });
    } else if (m.role === 'assistant') {
      input.push({ role: 'assistant', content: [{ type: 'output_text', text: m.content }] });
    }
  }
  return input;
}

function toChatMessages(sys, msgs) {
  const out = [];
  if (sys) out.push({ role: 'system', content: sys });
  for (const m of msgs) out.push({ role: m.role, content: m.content });
  return out;
}

// ---------- Send ----------
async function send() {
  if (mode !== 'api') return;

  const apiKey = apiKeyEl.value.trim();
  let baseUrl = (baseUrlEl.value.trim() || 'https://api.openai.com').replace(/\/+$/, '');
  if (/^wss?:\/\//i.test(baseUrl)) {
    alert('WebSocket URLs (ws://, wss://) are not supported for HTTP endpoints.');
    return;
  }
  const apiKind = apiKindEl.value;
  if (!apiKey) { alert('Add your API key first.'); return; }

  const userText = inputEl.value.trim();
  if (!userText) return;
  inputEl.value = '';


  pushMsg('user', userText);
  await saveCfg();

  const assistantDiv = pushMsg('assistant', '');

  try {
    if (apiKind === 'responses') {
      const endpoint = `${baseUrl}/v1/responses`;
      const body = {
        model: modelEl.value,
        stream: true,
        ...(sysEl.value ? { instructions: sysEl.value } : {}),
        input: toResponsesInput(sysEl.value, history)
      };

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!resp.ok || !resp.body) {
        const txt = await resp.text().catch(() => '');
        assistantDiv.textContent = `Error: ${resp.status} ${txt}`;
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let acc = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        for (const line of chunk.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.substring(5).trim();
          if (!data || data === '[DONE]') continue;

          let evt;
          try { evt = JSON.parse(data); } catch { continue; }

          if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
            acc += evt.delta;
            assistantDiv.textContent = acc;
            chatEl.scrollTop = chatEl.scrollHeight;
          } else if (evt.type === 'response.error') {
            assistantDiv.textContent = `Error: ${evt.error?.message || 'Unknown error'}`;
          }
        }
      }

      history.push({ role: 'assistant', content: assistantDiv.textContent });
      await saveCfg();

    } else {
      const endpoint = `${baseUrl}/v1/chat/completions`;
      const body = {
        model: modelEl.value,
        stream: true,
        messages: toChatMessages(sysEl.value, history)
      };

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!resp.ok || !resp.body) {
        const txt = await resp.text().catch(() => '');
        assistantDiv.textContent = `Error: ${resp.status} ${txt}`;
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let acc = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        for (const line of chunk.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.substring(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content || '';
            if (delta) {
              acc += delta;
              assistantDiv.textContent = acc;
              chatEl.scrollTop = chatEl.scrollHeight;
            }
          } catch (_) {}
        }
      }

      history.push({ role: 'assistant', content: assistantDiv.textContent });
      await saveCfg();
    }
  } catch (err) {
    assistantDiv.textContent = `Network error: ${err?.message || err}`;
  }
}

// Buttons
sendBtn.addEventListener('click', send);

// Enter to send in API (Shift+Enter = newline)
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && mode === 'api') {
    e.preventDefault();
    send();
  }
});

(async () => {
  await loadCfg();
})();

// Tooltip (single source of truth)
if (refreshBtn) {
  refreshBtn.title = "Refresh (Shift+Click or Ctrl/Cmd+Shift+R = Hard Reload)";
}

// Visual cue when holding Shift
window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift' && refreshBtn) {
    refreshBtn.classList.add('danger');
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift' && refreshBtn) {
    refreshBtn.classList.remove('danger');
  }
});

// ---------- Download toasts ----------
const formatPct = (r, t) => {
  if (!t || t <= 0) return '';
  const pct = Math.min(100, Math.round((r / t) * 100));
  return ` ${pct}%`;
};
const activeToasts = new Map();
window.VoidDesk.downloads.onStart(({ id, filename }) => {
  const toast = createToast(`Downloading ${filename}…`, { duration: 0 });
  if (toast) activeToasts.set(id, toast);
});
window.VoidDesk.downloads.onProgress(({ id, receivedBytes, totalBytes }) => {
  const el = activeToasts.get(id);
  if (el) el.textContent = el.textContent.replace(/….*$/,'…') + formatPct(receivedBytes, totalBytes);
});
window.VoidDesk.downloads.onDone(({ id, state, savePath }) => {
  const el = activeToasts.get(id);
  if (!el) return;
  if (state === 'completed') el.textContent = `Saved → ${savePath}`;
  else el.textContent = `Download ${state}`;
  setTimeout(() => el.remove(), 5000);
  activeToasts.delete(id);
});

// --- Downloads UI ---
const dlItems = new Map(); // id -> element
let activeDlCount = 0;     // track concurrent downloads

function toggleDownloads(open) {
  const panel = document.getElementById('downloadsPanel');
  if (!panel) return;
  const show = (typeof open === 'boolean') ? open : panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !show);
}

// Single handler (remove any duplicate)
downloadsBtn?.addEventListener('click', () => {
  toggleDownloads();
  loadDownloadHistory();
});

// Delegate open downloads folder click (button exists after script tag)
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t && t.id === 'openDownloadsFolder') {
    window.VoidDesk.downloads.openFolder();
  }
});

// Ctrl/Cmd + J (like browsers) handled in hotkeys above

function renderDlItem({ id, filename, totalBytes }) {
  const div = document.createElement('div');
  div.className = 'dl-item';
  div.id = `dl-${id}`;
  div.innerHTML = `
    <div class="dl-row">
      <div class="dl-name" title="${filename || ''}">${filename || 'Downloading…'}</div>
      <div class="dl-meta"><span data-state>starting</span></div>
    </div>
    <progress max="${totalBytes || 1}" value="0"></progress>
  `;
  const list = document.getElementById('downloadsList');
  list?.prepend(div);
  return div;
}

window.VoidDesk.downloads.onStart((d) => {
  const el = renderDlItem(d);
  dlItems.set(d.id, el);
  activeDlCount += 1;
  downloadsBtn.classList.remove('knight');
  void downloadsBtn.offsetWidth;
  downloadsBtn.classList.add('knight');
  toggleDownloads(true);
});

window.VoidDesk.downloads.onProgress((d) => {
  const el = dlItems.get(d.id) || renderDlItem(d);
  el.querySelector('progress').max = d.totalBytes || 1;
  el.querySelector('progress').value = d.receivedBytes || 0;
  el.querySelector('[data-state]').textContent = d.state || 'downloading';
});

window.VoidDesk.downloads.onDone((d) => {
  const el = dlItems.get(d.id) || renderDlItem(d);
  el.querySelector('[data-state]').textContent = (d.state === 'completed') ? 'done' : d.state;
  el.querySelector('progress').value = el.querySelector('progress').max;
  activeDlCount = Math.max(0, activeDlCount - 1);
  if (activeDlCount === 0) downloadsBtn.classList.remove('knight');
  // If the panel is open, refresh history so the latest item appears
  const panel = document.getElementById('downloadsPanel');
  if (panel && !panel.classList.contains('hidden')) {
    loadDownloadHistory();
  }
});

// Replace inline onclick-based history rendering with safe listeners
async function loadDownloadHistory() {
  const history = await window.VoidDesk.downloads.getHistory();
  const list = document.getElementById('downloadsList');
  if (!list) return;
  list.innerHTML = '';
  if (!history || history.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dl-item';
    empty.innerHTML = `
      <div class="dl-row">
        <div class="dl-name">No downloads yet</div>
        <div class="dl-meta">—</div>
      </div>
      <progress max="1" value="0"></progress>
    `;
    list.appendChild(empty);
    return;
  }
  history.forEach(d => {
    const div = document.createElement('div');
    div.className = 'dl-item';
    div.innerHTML = `
      <div class="dl-row">
        <div class="dl-name" title="${d.filename}">${d.filename}</div>
        <div class="dl-meta">${new Date(d.time).toLocaleString()}</div>
      </div>
      <progress max="1" value="1"></progress>
    `;
    const openBtn = document.createElement('button');
    openBtn.textContent = 'Open';
    openBtn.addEventListener('click', () => window.VoidDesk.downloads.openFile(d.savePath));
    div.appendChild(openBtn);
    list.appendChild(div);
  });
}

// Settings UI
const settingsBtn = document.getElementById('settingsBtn');

function applyTheme(theme) {
  document.body.classList.toggle('light', theme === 'light');
}

async function loadSettings() {
  const [
    langsValue,
    themeValue,
    askValue,
    revealValue,
    storedWebHome,
    storedCodexHome,
    storedCodexRepos,
    storedGithubOwner,
    storedGithubToken,
    storedGithubIncludePrivate,
  ] = await Promise.all([
    window.VoidDesk.cfg.get('spellLangs'),
    window.VoidDesk.cfg.get('theme'),
    window.VoidDesk.cfg.get('askWhereToSave'),
    window.VoidDesk.cfg.get('revealOnComplete'),
    window.VoidDesk.cfg.get('webHomeUrl'),
    window.VoidDesk.cfg.get('codexHomeUrl'),
    window.VoidDesk.cfg.get('codexRepos'),
    window.VoidDesk.cfg.get('codexGithubOwner'),
    window.VoidDesk.cfg.get('codexGithubToken'),
    window.VoidDesk.cfg.get('codexGithubIncludePrivate'),
  ]);

  const langs = Array.isArray(langsValue) && langsValue.length ? langsValue : ['en-US'];
  const langSel = document.getElementById('spellLangs');
  if (langSel && 'options' in langSel) {
    for (const opt of langSel.options) opt.selected = langs.includes(opt.value);
  }

  const theme = typeof themeValue === 'string' ? themeValue : 'dark';
  const themeSel = document.getElementById('themeSelect');
  if (themeSel) themeSel.value = theme;
  applyTheme(theme);

  const askCb = document.getElementById('askWhereToSave');
  if (askCb) askCb.checked = !!askValue;

  const revealCb = document.getElementById('revealOnComplete');
  if (revealCb) revealCb.checked = !!revealValue;

  const webHomeInput = document.getElementById('webHomeInput');
  if (webHomeInput) webHomeInput.value = sanitizeHomeUrl(storedWebHome, DEFAULT_WEB_HOME);

  const codexHomeInput = document.getElementById('codexHomeInput');
  if (codexHomeInput) codexHomeInput.value = sanitizeHomeUrl(storedCodexHome, DEFAULT_CODEX_HOME);

  const repoListInput = document.getElementById('codexRepoList');
  if (repoListInput) repoListInput.value = formatRepoText(normalizeRepoList(storedCodexRepos));

  const githubOwnerInput = document.getElementById('codexGithubOwner');
  if (githubOwnerInput) githubOwnerInput.value = typeof storedGithubOwner === 'string' ? storedGithubOwner.trim() : '';

  const githubTokenInput = document.getElementById('codexGithubToken');
  if (githubTokenInput) githubTokenInput.value = typeof storedGithubToken === 'string' ? storedGithubToken.trim() : '';

  const githubPrivateCb = document.getElementById('codexGithubIncludePrivate');
  if (githubPrivateCb) {
    const hasToken = typeof storedGithubToken === 'string' && storedGithubToken.trim().length > 0;
    githubPrivateCb.checked = !!storedGithubIncludePrivate && hasToken;
  }
}

function openSettings() {
  const panel = document.getElementById('settingsPanel');
  panel?.classList.remove('hidden');
  loadSettings();
}
function closeSettings() {
  const panel = document.getElementById('settingsPanel');
  panel?.classList.add('hidden');
}

settingsBtn?.addEventListener('click', openSettings);

// Delegate close/save clicks for settings (buttons exist after script tag)
document.addEventListener('click', async (e) => {
  const t = e.target;
  if (!t) return;
  if (t.id === 'closeSettings') {
    closeSettings();
  } else if (t.id === 'saveSettings') {
    const langSel = document.getElementById('spellLangs');
    const themeSel = document.getElementById('themeSelect');
    const askCb = document.getElementById('askWhereToSave');
    const revealCb = document.getElementById('revealOnComplete');
    const webHomeInput = document.getElementById('webHomeInput');
    const codexHomeInput = document.getElementById('codexHomeInput');
    const repoListInput = document.getElementById('codexRepoList');
    const githubOwnerInput = document.getElementById('codexGithubOwner');
    const githubTokenInput = document.getElementById('codexGithubToken');
    const githubPrivateCb = document.getElementById('codexGithubIncludePrivate');

    const langs = Array.from(langSel?.selectedOptions || []).map(o => o.value);
    const theme = themeSel?.value || 'dark';
    const ask = !!askCb?.checked;
    const reveal = !!revealCb?.checked;
    const newWebHome = sanitizeHomeUrl(webHomeInput?.value, DEFAULT_WEB_HOME);
    const newCodexHome = sanitizeHomeUrl(codexHomeInput?.value, DEFAULT_CODEX_HOME);
    const newRepoList = parseRepoText(repoListInput?.value || '');
    const newGithubOwner = (githubOwnerInput?.value || '').trim();
    const newGithubToken = (githubTokenInput?.value || '').trim();
    let includePrivate = !!githubPrivateCb?.checked;
    if (includePrivate && !newGithubToken) {
      includePrivate = false;
      if (githubPrivateCb) githubPrivateCb.checked = false;
      createToast('GitHub token required for private repositories. Saving without private access.', { duration: 8000 });
    }

    await Promise.all([
      window.VoidDesk.cfg.set('spellLangs', langs),
      window.VoidDesk.cfg.set('theme', theme),
      window.VoidDesk.cfg.set('askWhereToSave', ask),
      window.VoidDesk.cfg.set('revealOnComplete', reveal),
      window.VoidDesk.cfg.set('webHomeUrl', newWebHome),
      window.VoidDesk.cfg.set('codexHomeUrl', newCodexHome),
      window.VoidDesk.cfg.set('codexRepos', newRepoList),
      window.VoidDesk.cfg.set('codexGithubOwner', newGithubOwner),
      window.VoidDesk.cfg.set('codexGithubToken', newGithubToken),
      window.VoidDesk.cfg.set('codexGithubIncludePrivate', includePrivate),
    ]);

    webHomeUrl = newWebHome;
    codexHomeUrl = newCodexHome;
    const prevOwner = codexGithubOwner;
    const prevToken = codexGithubToken;
    const prevIncludePrivate = codexGithubIncludePrivate;

    manualCodexRepos = newRepoList;
    codexGithubOwner = newGithubOwner;
    codexGithubToken = newGithubToken;
    codexGithubIncludePrivate = includePrivate;

    const githubChanged = prevOwner !== codexGithubOwner
      || prevToken !== codexGithubToken
      || prevIncludePrivate !== codexGithubIncludePrivate;

    if (githubChanged) {
      codexGithubRepos = [];
      codexGithubLastError = null;
    }

    recomputeCodexRepos();
    updateWebNavState();
    updateCodexNavState();

    if (webHomeInput) webHomeInput.value = webHomeUrl;
    if (codexHomeInput) codexHomeInput.value = codexHomeUrl;
    if (repoListInput) repoListInput.value = formatRepoText(manualCodexRepos);
    if (githubOwnerInput) githubOwnerInput.value = codexGithubOwner;
    if (githubTokenInput) githubTokenInput.value = codexGithubToken;
    if (githubPrivateCb) githubPrivateCb.checked = !!codexGithubIncludePrivate && codexGithubToken.length > 0;

    if (githubChanged) {
      refreshGithubRepos({ silent: !codexGithubOwner, resetExisting: true }).catch(() => {});
    }

    applyTheme(theme);

    try { await window.VoidDesk.spellcheck.setLanguages(langs); } catch {}
    closeSettings();
  }
});

// Click outside to close
document.addEventListener('click', (e) => {
  const panel = document.getElementById('settingsPanel');
  if (!panel || panel.classList.contains('hidden')) return;
  if (panel.contains(e.target) || e.target === settingsBtn) return;
  closeSettings();
});
// Esc to close
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSettings();
});

// Apply theme on boot once DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  loadSettings().catch(() => {});
});

