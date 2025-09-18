const { app, BrowserWindow, ipcMain, shell, session, Menu, Notification, net } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

const store = new Store({ name: 'voiddesk' });
const DEFAULT_SPELL_LANGS = store.get('spellLangs') || ['en-US'];
const WEB_PARTITION = 'persist:voiddesk-plus'; // legacy name retained to preserve existing logins
const CODEX_PARTITION = 'persist:voiddesk-codex';

if (process.platform === 'win32') app.setAppUserModelId('VoidDesk');

// Reduce WPAD/proxy SSL noise by forcing direct connections (no system proxy)
// Remove these two lines if you need system proxy support
app.commandLine.appendSwitch('no-proxy-server');
const setDirectProxy = async (ses) => { try { await ses.setProxy({ proxyRules: 'direct://' }); } catch {} };

// Strict filename scrubber: strips separators, control chars, trims length
function sanitizeFilename(name, fallback = 'download.bin') {
  if (typeof name !== 'string') return fallback;
  let base = path.basename(name).replace(/[\/\\]+/g, '_');
  base = base.replace(/[\x00-\x1F\x7F]/g, '');
  base = base.replace(/[<>:"|?*]/g, '_');
  base = base.replace(/^[.\s]+|[.\s]+$/g, '');
  if (!base) base = fallback;
  if (base.length > 120) {
    const ext = path.extname(base);
    const stem = path.basename(base, ext).slice(0, 110);
    base = `${stem}${ext}`;
  }
  return base;
}

// Safe join: ensure candidate resolves inside baseDir (no traversal)
function safeJoin(baseDir, candidate) {
  const resolved = path.resolve(baseDir, candidate);
  const withSep = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
  if (!resolved.startsWith(withSep)) {
    throw new Error('Path traversal blocked');
  }
  return resolved;
}

function enableSpellcheckForSession(ses, langs = DEFAULT_SPELL_LANGS) {
  try {
    ses.setSpellCheckerLanguages(langs);
  } catch (e) {
    console.warn('Spellcheck language set failed:', e.message);
  }
}

function attachSpellcheckContextMenu(webContents, ses) {
  // Track URLs that should force a Save dialog for this webContents
  const wcId = webContents.id;
  webContents.on('context-menu', (event, params) => {
    const template = [];

    // Save As for images
    if (params.mediaType === 'image' && params.srcURL) {
      template.push({
        label: 'Save Image As...',
        click: () => {
          markForceAsk(webContents, params.srcURL);
          webContents.downloadURL(params.srcURL);
        }
      });
      template.push({
        label: 'Copy Image URL',
        click: () => require('electron').clipboard.writeText(params.srcURL)
      });
      template.push({
        label: 'Copy Image',
        click: async () => {
          // Try to fetch and copy image to clipboard
          try {
            const res = await fetch(params.srcURL);
            const buf = Buffer.from(await res.arrayBuffer());
            require('electron').clipboard.writeImage(require('electron').nativeImage.createFromBuffer(buf));
          } catch (e) {
            console.warn('Failed to copy image:', e);
          }
        }
      });
      template.push({ type: 'separator' });
    }

    // Save As for downloadable links
    if (params.linkURL && params.linkURL.startsWith('http')) {
      template.push({
        label: 'Save Link As...',
        click: () => {
          markForceAsk(webContents, params.linkURL);
          webContents.downloadURL(params.linkURL);
        }
      });
      template.push({
        label: 'Copy Link',
        click: () => require('electron').clipboard.writeText(params.linkURL)
      });
      template.push({
        label: 'Open Link in External Browser',
        click: () => shell.openExternal(params.linkURL)
      });
      template.push({
        label: 'Open Link in New Window',
        click: () => {
          if (isWebChatUrl(params.linkURL)) {
            openWebWindow(params.linkURL);
          } else {
            // Keep non‑Web links external to avoid becoming a general browser
            shell.openExternal(params.linkURL);
          }
        }
      });
      template.push({ type: 'separator' });
    }

    // Open in New Shell for chat links
    if (params.linkURL && params.linkURL.startsWith('chat:')) {
      const chatId = params.linkURL.replace(/^chat:/, '');
      template.push({
        label: 'Open in New Shell',
        click: () => {
          const newWin = new BrowserWindow({
            width: 980,
            height: 700,
            icon: path.join(__dirname, 'assets', 'voiddesk.ico'),
            webPreferences: {
              contextIsolation: true,
              preload: path.join(__dirname, 'preload.js'),
              webviewTag: true,
              spellcheck: true
            }
          });
          newWin.loadFile('index.html', { query: { chatId } });
        }
      });
      template.push({ type: 'separator' });
    }

    // existing spellcheck + edit menu
    if (params.misspelledWord) {
      (params.dictionarySuggestions || []).slice(0, 6).forEach(s => {
        template.push({ label: s, click: () => webContents.replaceMisspelling(s) });
      });
      if (template.length) template.push({ type: 'separator' });
      template.push({
        label: `Add “${params.misspelledWord}” to dictionary`,
        click: () => ses.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      template.push({ type: 'separator' });
    }
    template.push(
      { role: 'undo', enabled: params.editFlags.canUndo },
      { role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { role: 'selectAll' }
    );
    Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(webContents) });
  });
}

// Map of WebContents.id -> Set of URLs that should force Save dialog
const forceAskMap = new Map();
const forceAskNext = new Set(); // wc.id with a one-shot force-ask flag
function markForceAsk(wc, url) {
  try {
    const id = wc?.id;
    if (!id || !url) return;
    let s = forceAskMap.get(id);
    if (!s) { s = new Set(); forceAskMap.set(id, s); }
    s.add(url);
  forceAskNext.add(id);
  } catch {}
}

function createWindow () {
  const ses = session.defaultSession;
  enableSpellcheckForSession(ses);

  const win = new BrowserWindow({
    width: 980,
    height: 700,
    icon: path.join(__dirname, 'assets', 'voiddesk.ico'),
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      spellcheck: true
    }
  });

  attachSpellcheckContextMenu(win.webContents, ses);

  // Attach to Web view session immediately
  const webSession = session.fromPartition(WEB_PARTITION);
  enableSpellcheckForSession(webSession);
  const codexSession = session.fromPartition(CODEX_PARTITION);
  enableSpellcheckForSession(codexSession);

  // Attach handlers for any webview we embed (downloads + window.open)
  win.webContents.on('did-attach-webview', (_event, wc) => {
    attachSpellcheckContextMenu(wc, wc.session);

    wc.on('before-input-event', (event, input) => {
      try {
        if (input.isAutoRepeat) return;
        const key = (input.key || '').toLowerCase();
        const isHardReloadCombo =
          input.type === 'keyDown' &&
          input.shift &&
          (input.control || input.meta) &&
          (key === 'r' || input.code === 'KeyR');
        if (!isHardReloadCombo) return;
        event.preventDefault();
        const host = wc.hostWebContents || wc.getOwnerBrowserWindow()?.webContents;
        host?.send('hotkey:hardReload', { source: 'web' });
      } catch {}
    });

    wc.setWindowOpenHandler(({ url }) => {
      const httpFileLike = /^https?:/i.test(url) &&
        /\.(png|jpe?g|gif|webp|svg|mp4|zip|pdf|txt|json|bin|csv|mp3|wav|webm)(\?|$)/i.test(url);
      if (httpFileLike) {
        // Deny the popup and download directly in this WebContents
        wc.downloadURL(url);
        return { action: 'deny' };
      }
      // Allow blob:/data: popups to proceed so Chromium can handle the download natively
      if (url.startsWith('blob:') || url.startsWith('data:')) {
        return { action: 'allow' };
      }
      if (isWebChatUrl(url)) {
        openWebWindow(url);           // stays logged in via the dedicated Web partition
        return { action: 'deny' };
      }
      shell.openExternal(url);         // non‑Web → external browser
      return { action: 'deny' };
    });

  // Do not intercept file-like navigations; let Chromium create DownloadItems
  });

  win.removeMenu();
  win.loadFile('index.html');

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Helper: is this a ChatGPT web URL that should open in an in-app Web window?
function isWebChatUrl(u) {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return (
      h === 'chat.openai.com' || h.endsWith('.openai.com') ||
      h === 'chatgpt.com'     || h.endsWith('.chatgpt.com')
    );
  } catch { return false; }
}

// Open a new app window that targets the Web webview (keeps the dedicated session partition)
function openWebWindow(targetUrl) {
  const win = new BrowserWindow({
    width: 980,
    height: 700,
    icon: path.join(__dirname, 'assets', 'voiddesk.ico'),
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      spellcheck: true
    }
  });
  win.loadFile('index.html', { query: { webUrl: targetUrl, plusUrl: targetUrl, mode: 'web' } });
}

// Apply spellcheck languages to both sessions, persist in store
function setSpellLangs(langs) {
  const sessions = [
    session.defaultSession,
    session.fromPartition(WEB_PARTITION),
    session.fromPartition(CODEX_PARTITION)
  ];
  sessions.forEach(s => { try { s.setSpellCheckerLanguages(langs); } catch {} });
  store.set('spellLangs', langs);
}

// IPC to change spellcheck languages at runtime
ipcMain.handle('spellcheck:setLanguages', (_e, langs) => {
  if (!Array.isArray(langs) || !langs.length) return false;
  setSpellLangs(langs);
  return true;
});

// On app ready (or after creating windows), initialize from stored value
app.whenReady().then(() => {
  const langs = store.get('spellLangs') || ['en-US'];
  setSpellLangs(langs);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Enable spellcheck for the Web mode session
  const webSession = session.fromPartition(WEB_PARTITION);
  enableSpellcheckForSession(webSession);
  const codexSession = session.fromPartition(CODEX_PARTITION);
  enableSpellcheckForSession(codexSession);

  // Force direct connections (silence WPAD self-signed noise)
  setDirectProxy(session.defaultSession);
  setDirectProxy(webSession);
  setDirectProxy(codexSession);

  // Attach spellcheck context menu for any web-contents created under the Web partition
  app.on('web-contents-created', (_event, wc) => {
    if (wc.getType() !== 'webview') return;
    const partition = wc.session?.partition;
    if (partition === WEB_PARTITION || partition === CODEX_PARTITION) {
      attachSpellcheckContextMenu(wc, wc.session);
    }
  });

  // Setup better download pipeline for both sessions
  setupDownloadHandling(session.defaultSession, 'download');
  setupDownloadHandling(webSession, ['downloadWeb', 'downloadPlus']);
  setupDownloadHandling(codexSession, 'downloadCodex');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Simple config passthrough
ipcMain.handle('cfg:get', (_e, key) => store.get(key));
ipcMain.handle('cfg:set', (_e, key, value) => store.set(key, value));

// Hard reload the whole app (cold start)
ipcMain.handle('app:hardReload', async () => {
  app.relaunch();
  app.exit(0);
});

// Open OS downloads folder
ipcMain.handle('downloads:openFolder', () => {
  const dir = app.getPath('downloads');
  return shell.openPath(dir);
});

// Trigger a download from the current window (no in‑app viewer)
ipcMain.on('download:url', (e, url) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  win?.webContents.downloadURL(url);
});

// Auto-recover if renderer crashes
app.on('renderer-process-crashed', (_e, wc) => {
  const win = BrowserWindow.fromWebContents(wc);
  if (win) win.reload();
});

// Clear cookies/session for Web mode on request (use the WebView partition)
async function clearWebPartition() {
  const webSession = session.fromPartition(WEB_PARTITION);
  await webSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'serviceworkers', 'caches', 'indexeddb', 'websql']
  });
  return true;
}

async function clearCodexPartition() {
  const codexSession = session.fromPartition(CODEX_PARTITION);
  await codexSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'serviceworkers', 'caches', 'indexeddb', 'websql']
  });
  return true;
}

ipcMain.handle('web:logout', clearWebPartition);
ipcMain.handle('plus:logout', clearWebPartition);
ipcMain.handle('codex:logout', clearCodexPartition);

// Persisted download history
const DOWNLOAD_HISTORY_KEY = 'downloadHistory';
function addDownloadHistory(entry) {
  const history = store.get(DOWNLOAD_HISTORY_KEY) || [];
  history.unshift(entry);
  store.set(DOWNLOAD_HISTORY_KEY, history.slice(0, 100));
}

// IPC for download history and utilities
ipcMain.handle('downloads:getHistory', () => store.get(DOWNLOAD_HISTORY_KEY) || []);
ipcMain.handle('downloads:clearHistory', () => { store.set(DOWNLOAD_HISTORY_KEY, []); return true; });
ipcMain.handle('downloads:openFile', (_e, filePath) => shell.openPath(filePath));

// Add missing relaunch IPC
ipcMain.handle('app:relaunch', async () => {
  app.relaunch();
  app.exit(0);
});

// ---------------- Better download pipeline (both sessions) ----------------
function setupDownloadHandling(ses, channelNames = 'download') {
  const names = Array.isArray(channelNames) ? channelNames : [channelNames];
  ses.on('will-download', async (event, item, wc) => {
  // Do not prevent default; let Chromium manage the transfer.
    // Helper to safely access DownloadItem without throwing if destroyed
    const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
    const rawName = safe(() => item.getFilename()) || 'download.bin';
    const filename = sanitizeFilename(rawName);
    let targetPath = '';
    try {
      const url = safe(() => item.getURL());
      // Decide whether to force a prompt (no setSavePath) or auto-save
      let ask = store.get('askWhereToSave');
      try {
        const wid = wc?.id;
        const s = wid ? forceAskMap.get(wid) : undefined;
        if (wid && forceAskNext.has(wid)) {
          ask = true;
          forceAskNext.delete(wid);
        } else if (s && url && s.has(url)) {
          ask = true;
          s.delete(url);
        }
      } catch {}
  if (!ask) {
        // Auto-save to Downloads, dedupe filename
        const downloads = app.getPath('downloads');
        let target = safeJoin(downloads, filename);
        const p = path.parse(target);
        let i = 1;
        while (fs.existsSync(target)) {
          target = safeJoin(downloads, `${p.name} (${i++})${p.ext}`);
        }
        targetPath = target;
        safe(() => item.setSavePath(targetPath));
        try { store.set('lastSaveFolder', path.dirname(targetPath)); } catch {}
      }
  } catch (e) {
      const fallback = path.join(app.getPath('downloads'), 'download.bin');
      try { safe(() => item.setSavePath(fallback)); } catch {}
      targetPath = fallback;
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const send = (type, payload = {}) => {
      const url = safe(() => item.getURL());
      names.forEach((name) => wc?.send(`${name}:${type}`, { id, url, ...payload }));
    };

    send('start', { filename: safe(() => item.getFilename(), filename), totalBytes: safe(() => item.getTotalBytes(), 0) });
    try {
      item.on('updated', (_e, state) => {
        try {
          send('progress', {
            state,
            receivedBytes: safe(() => item.getReceivedBytes(), 0),
            totalBytes: safe(() => item.getTotalBytes(), 0)
          });
        } catch {}
      });
      item.once('done', async (_e, state) => {
        try {
          const savePath = safe(() => item.getSavePath());
          send('done', { savePath });
          if (state === 'completed' && savePath) {
            try { if (store.get('revealOnComplete')) shell.showItemInFolder(savePath); } catch {}
            // save to history and notify
            addDownloadHistory({
              filename: safe(() => item.getFilename(), filename),
              savePath,
              url: safe(() => item.getURL()),
              time: Date.now(),
              state: 'completed'
            });
            try {
              new Notification({
                title: 'Download complete',
                body: safe(() => item.getFilename(), filename),
                icon: path.join(__dirname, 'assets', 'voiddesk.ico')
              }).show();
            } catch {}
          } else if (savePath) {
            // Fallback attempt: fetch via net and write to savePath if URL available
            try {
              const url = safe(() => item.getURL());
              if (url) {
                await new Promise((resolve, reject) => {
                  const request = net.request(url);
                  const fileStream = fs.createWriteStream(savePath);
                  request.on('response', (response) => {
                    response.on('end', resolve);
                    response.on('error', reject);
                    response.pipe(fileStream);
                  });
                  request.on('error', reject);
                  request.end();
                });
                addDownloadHistory({
                  filename: safe(() => item.getFilename(), filename),
                  savePath,
                  url,
                  time: Date.now(),
                  state: 'completed'
                });
                try { if (store.get('revealOnComplete')) shell.showItemInFolder(savePath); } catch {}
              }
            } catch {}
          }
        } catch {}
      });
  // No resume needed when not preventing default
    } catch {}
  });
}
