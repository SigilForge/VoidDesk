const { app, BrowserWindow, ipcMain, shell, session, Menu, Notification } = require('electron');
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

    // Save As for images
    if (params.mediaType === 'image' && params.srcURL) {
      template.push({
        label: 'Save Image As...',
        click: () => webContents.downloadURL(params.srcURL)
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
        click: () => webContents.downloadURL(params.linkURL)
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
          if (isPlusUrl(params.linkURL)) {
            openPlusWindow(params.linkURL);
          } else {
            // Keep non‑Plus links external to avoid becoming a general browser
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

  // Attach handlers for any webview we embed (downloads + window.open)
  win.webContents.on('did-attach-webview', (_event, wc) => {
    attachSpellcheckContextMenu(wc, wc.session);

    wc.setWindowOpenHandler(({ url }) => {
      const fileLike = url.startsWith('blob:') || url.startsWith('data:') ||
        /\.(png|jpe?g|gif|webp|svg|mp4|zip|pdf|txt|json|bin|csv|mp3|wav|webm)(\?|$)/i.test(url);
      if (fileLike) {
        wc.downloadURL(url);
        return { action: 'deny' };
      }
      if (isPlusUrl(url)) {
        openPlusWindow(url);           // stays logged in via persist:voiddesk-plus
        return { action: 'deny' };
      }
      shell.openExternal(url);         // non‑Plus → external browser
      return { action: 'deny' };
    });

    wc.on('will-navigate', (e, url) => {
      if (/\.(png|jpe?g|gif|webp|svg|mp4|zip|pdf|txt|json|bin|csv|mp3|wav|webm)(\?|$)/i.test(url)) {
        e.preventDefault();
        wc.downloadURL(url);
      }
    });
  });

  win.removeMenu();
  win.loadFile('index.html');

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Helper: is this a ChatGPT/Plus URL that should open in an in-app Plus window?
function isPlusUrl(u) {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return (
      h === 'chat.openai.com' || h.endsWith('.openai.com') ||
      h === 'chatgpt.com'     || h.endsWith('.chatgpt.com')
    );
  } catch { return false; }
}

// Open a new app window that targets the Plus webview (keeps persist:voiddesk-plus session)
function openPlusWindow(targetUrl) {
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
  win.loadFile('index.html', { query: { plusUrl: targetUrl, mode: 'plus' } });
}

// Apply spellcheck languages to both sessions, persist in store
function setSpellLangs(langs) {
  const sessions = [session.defaultSession, session.fromPartition('persist:voiddesk-plus')];
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
      if (state === 'completed') {
        shell.showItemInFolder(item.getSavePath());
        // save to history and notify
        addDownloadHistory({
          filename: item.getFilename(),
          savePath: item.getSavePath(),
          url: item.getURL(),
          time: Date.now(),
          state: 'completed'
        });
        try {
          new Notification({
            title: 'Download complete',
            body: item.getFilename(),
            icon: path.join(__dirname, 'assets', 'voiddesk.ico')
          }).show();
        } catch {}
      }
    });
    item.resume();
  });
}
