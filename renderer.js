const chatEl = document.getElementById('chat');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const apiKeyEl = document.getElementById('apiKey');
const modelEl = document.getElementById('model');
const sysEl = document.getElementById('system');
const saveCfgBtn = document.getElementById('saveCfg');
const clearBtn = document.getElementById('clear');
const apiBtn = document.getElementById('apiMode');
const plusBtn = document.getElementById('plusMode');
const sendOtherBtn = document.getElementById('sendOther');
const logoutPlusBtn = document.getElementById('logoutPlus');
const refreshBtn = document.getElementById('refresh');
const apiPane = document.getElementById('apiPane');
const plusPane = document.getElementById('plusPane');
const plusView = document.getElementById('plusView') || null;
const baseUrlEl = document.getElementById('baseUrl');
const apiKindEl = document.getElementById('apiKind');
const downloadsBtn = document.getElementById('downloadsBtn');
const downloadsPanel = document.getElementById('downloadsPanel');
const downloadsList = document.getElementById('downloadsList');
const openDownloadsFolderBtn = document.getElementById('openDownloadsFolder');
const downloadTestBtn = document.getElementById('downloadTest');
const DRAFT_KEY = 'draft';

// One-time setup for draft saving and unload
inputEl.addEventListener('input', () => {
  window.VoidDesk.cfg.set(DRAFT_KEY, inputEl.value);
});

window.addEventListener('beforeunload', () => {
  window.VoidDesk.cfg.set('history', history);
  window.VoidDesk.cfg.set('scrollPos', chatEl.scrollTop);
  window.VoidDesk.cfg.set(DRAFT_KEY, inputEl.value);
});

let history = [];            // [{role, content}]
let mode = 'api';            // 'api' | 'plus'
let scrollPos = 0;           // remember API pane scroll
let toastsEl;                // lazy mini status area

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
function startRefreshAnim() {
  if (!refreshBtn) return;
  refreshBtn.classList.remove('knight');
  void refreshBtn.offsetWidth;   // reflow to restart CSS animation
  refreshBtn.classList.add('knight');
}
// Always focus composer when the window gets focus (API mode)
window.addEventListener('focus', () => {
  if (mode === 'api') inputEl?.focus();
});

function stopRefreshAnim() {
  if (!refreshBtn) return;
  refreshBtn.classList.remove('knight');
}

// ---------- Mode switching ----------
function setMode(next) {
  mode = next;
  apiPane.classList.toggle('hidden', mode !== 'api');
  plusPane.classList.toggle('hidden', mode !== 'plus');
  apiBtn.classList.toggle('active', mode === 'api');
  plusBtn.classList.toggle('active', mode === 'plus');

  const apiControls = [
    apiKeyEl.closest('label'),
    modelEl.closest('label'),
    baseUrlEl.closest('label'),
    apiKindEl.closest('label'),
    document.getElementById('clear'),
    document.getElementById('system').closest('label')
  ];
  for (const el of apiControls) if (el) el.style.display = (mode === 'api') ? 'flex' : 'none';

  const plusControls = [logoutPlusBtn];
  for (const el of plusControls) if (el) el.style.display = (mode === 'plus') ? 'flex' : 'none';

  document.querySelector('footer').style.display = (mode === 'api') ? 'flex' : 'none';

  if (mode === 'api') {
    inputEl.focus();
    chatEl.scrollTop = scrollPos;
  }

  window.VoidDesk.cfg.set('mode', mode);
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
  toastsEl = document.getElementById('toasts');
  const draft = await window.VoidDesk.cfg.get(DRAFT_KEY);
  if (draft) inputEl.value = draft;
  const [k, m, s, savedHistory, savedMode, baseUrl, apiKind, savedScroll] = await Promise.all([
    window.VoidDesk.cfg.get('apiKey'),
    window.VoidDesk.cfg.get('model'),
    window.VoidDesk.cfg.get('system'),
    window.VoidDesk.cfg.get('history'),
    window.VoidDesk.cfg.get('mode'),
    window.VoidDesk.cfg.get('baseUrl'),
    window.VoidDesk.cfg.get('apiKind'),
    window.VoidDesk.cfg.get('scrollPos'),
  ]);

  apiKeyEl.value = k || '';
  modelEl.value = m || 'gpt-4o'; // <-- fix: default to a valid dropdown option
  sysEl.value   = s || '';
  baseUrlEl.value = baseUrl || 'https://api.openai.com';
  apiKindEl.value = apiKind || 'responses';

  history = Array.isArray(savedHistory) ? savedHistory.slice() : [];
  renderHistory();

  if (typeof savedScroll === 'number') scrollPos = savedScroll;

  setMode(savedMode || 'plus'); // default to Plus

  // Keep animation in sync with Plus WebView network state
  if (plusView) {
    plusView.addEventListener('did-start-loading', startRefreshAnim);
    plusView.addEventListener('did-stop-loading', stopRefreshAnim);
  }
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

apiBtn.addEventListener('click', () => setMode('api'));
plusBtn.addEventListener('click', () => setMode('plus'));

logoutPlusBtn.addEventListener('click', async () => {
  await window.VoidDesk.plus.logout();
  if (plusView) plusView.loadURL('https://chat.openai.com');
});

// Universal refresh (soft / hard via Shift)
refreshBtn.addEventListener('click', async (e) => {
  // Shift+Click → Hard reload (ignores cache for Plus or reloads the whole app)
  if (e.shiftKey) {
    if (mode === 'plus' && plusView) {
      startRefreshAnim();
      plusView.reloadIgnoringCache();
      return;
    }
    // Actually relaunch the app to squash weirdness, restore same window
    startRefreshAnim();
    await window.VoidDesk.app.relaunch();
    return;
  }

  // Normal soft refresh
  if (mode === 'api') {
    startRefreshAnim();
    renderHistory();
    await new Promise(r => setTimeout(r, 1400)); // show a couple of pings
    stopRefreshAnim();
  } else if (mode === 'plus' && plusView) {
    plusView.reload(); // did-start/stop will control the animation
  }
});

// Send selection to the other mode
sendOtherBtn.addEventListener('click', () => {
  const sel = window.getSelection().toString() || inputEl.value;
  if (!sel) return;

  if (mode === 'api') {
    const payload = JSON.stringify(sel);
    if (plusView) {
      plusView.executeJavaScript(`
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
          `);
    }
    setMode('plus');
  } else {
    inputEl.value += (inputEl.value ? '\n\n' : '') + sel;
    setMode('api');
    inputEl.focus();
  }
});

// ---------- Hotkeys ----------
window.addEventListener('keydown', (e) => {
  // Send to other (Ctrl/Cmd+Shift+S)
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    sendOtherBtn.click();
    return;
  }
  // Hard reload (Ctrl/Cmd+Shift+R)
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'r') {
    e.preventDefault();
    if (mode === 'plus' && plusView) {
      startRefreshAnim();
      plusView.reloadIgnoringCache();
    } else {
      startRefreshAnim();
      window.VoidDesk.app.relaunch();
    }
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
  if (mode === 'api') scrollPos = chatEl.scrollTop;
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
const mk = (t) => {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = t;
  toastsEl?.appendChild(el);
  setTimeout(() => el.remove(), 7000);
  return el;
};
const formatPct = (r, t) => {
  if (!t || t <= 0) return '';
  const pct = Math.min(100, Math.round((r / t) * 100));
  return ` ${pct}%`;
};
const activeToasts = new Map();
window.VoidDesk.downloads.onStart(({ id, filename }) => {
  activeToasts.set(id, mk(`Downloading ${filename}…`));
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

function toggleDownloads(open) {
  const show = (typeof open === 'boolean') ? open : downloadsPanel.classList.contains('hidden');
  downloadsPanel.classList.toggle('hidden', !show);
}

downloadsBtn?.addEventListener('click', () => toggleDownloads());
openDownloadsFolderBtn?.addEventListener('click', () => window.VoidDesk.downloads.openFolder());

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
  downloadsList.prepend(div);
  return div;
}

window.VoidDesk.downloads.onStart((d) => {
  const el = renderDlItem(d);
  dlItems.set(d.id, el);
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
});

// Test download button (uses main process downloadURL)
downloadTestBtn?.addEventListener('click', () => {
  // Start Knight Rider animation on DL button
  downloadTestBtn.classList.remove('knight');
  void downloadTestBtn.offsetWidth;
  downloadTestBtn.classList.add('knight');

  window.VoidDesk.downloads.start('https://speed.hetzner.de/5MB.bin');
  toggleDownloads(true);
});

// Remove Knight Rider animation when any download completes
window.VoidDesk.downloads.onDone(() => {
  downloadTestBtn.classList.remove('knight');
});

window.VoidDesk.openChatInNewShell = (chatId) => {
  window.VoidDesk.cfg.get(`history:${chatId}`).then(history => {
    window.electronAPI.openNewShell(chatId);
  });
};

const urlParams = new URLSearchParams(window.location.search);
const chatId = urlParams.get('chatId');
if (chatId) {
  window.VoidDesk.cfg.get(`history:${chatId}`).then(history => {
    if (Array.isArray(history)) {
      chatEl.innerHTML = '';
      history.forEach(m => renderMsg(m.role, m.content));
    }
  });
}
