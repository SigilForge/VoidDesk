const { app, BrowserWindow, ipcMain, shell, session, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

const store = new Store({ name: 'voiddesk' });
const DEFAULT_SPELL_LANGS = store.get('spellLangs') || ['en-US'];

if (process.platform === 'win32') app.setAppUserModelId('VoidDesk');

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
  webContents.on('context-menu', (event, params) => {
    const template = [];

    // Detect if right-clicked element is a chat entry
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

  // Attach to Plus WebView session immediately
  const plusSession = session.fromPartition('persist:voiddesk-plus');
  enableSpellcheckForSession(plusSession);

  // Attach to existing Plus WebView if already created in the DOM
  win.webContents.on('did-attach-webview', (_event, wc) => {
    attachSpellcheckContextMenu(wc, wc.session);
  });

  win.removeMenu();
  win.loadFile('index.html');

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Enable spellcheck for Plus mode's session
  const plusSession = session.fromPartition('persist:voiddesk-plus');
  enableSpellcheckForSession(plusSession);

  // Attach spellcheck context menu for any web-contents created under Plus partition
  app.on('web-contents-created', (_event, wc) => {
    if (wc.getType() === 'webview' && wc.session.partition === 'persist:voiddesk-plus') {
      attachSpellcheckContextMenu(wc, wc.session);
    }
  });

  // Setup better download pipeline for both sessions
  setupDownloadHandling(session.defaultSession, 'download');
  setupDownloadHandling(plusSession, 'downloadPlus');
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

// Clear cookies/session for Plus mode on request (use the WebView's partition)
ipcMain.handle('plus:logout', async () => {
  const plusSession = session.fromPartition('persist:voiddesk-plus');
  await plusSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'serviceworkers', 'caches', 'indexeddb', 'websql']
  });
  return true;
});

// ---------------- Better download pipeline (both sessions) ----------------
function setupDownloadHandling(ses, channelName = 'download') {
  ses.on('will-download', (event, item, wc) => {
    event.preventDefault();
    try {
      const rawName = item.getFilename();
      const filename = sanitizeFilename(rawName);
      const downloads = app.getPath('downloads');
      let target = safeJoin(downloads, filename);
      const p = path.parse(target);
      let i = 1;
      while (fs.existsSync(target)) {
        target = safeJoin(downloads, `${p.name} (${i++})${p.ext}`);
      }
      item.setSavePath(target);
    } catch (e) {
      const fallback = path.join(app.getPath('downloads'), 'download.bin');
      item.setSavePath(fallback);
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const send = (type, payload = {}) => {
      wc?.send(`${channelName}:${type}`, { id, url: item.getURL(), ...payload });
    };

    send('start', { filename: item.getFilename(), totalBytes: item.getTotalBytes() });
    item.on('updated', (_e, state) => {
      send('progress', {
        state,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes()
      });
    });
    item.once('done', (_e, state) => {
      send('done', {
        state,
        savePath: item.getSavePath()
      });
      if (state === 'completed') shell.showItemInFolder(item.getSavePath());
    });
    item.resume();
  });
}
