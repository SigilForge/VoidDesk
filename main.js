const { app, BrowserWindow, ipcMain, shell, session, Menu } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store({ name: 'voiddesk' });

// Change this if you want multiple languages (e.g., ['en-US','en-GB'])
const DEFAULT_SPELL_LANGS = store.get('spellLangs') || ['en-US'];

if (process.platform === 'win32') app.setAppUserModelId('VoidDesk');

function attachSpellcheckContextMenu(webContents, ses) {
  webContents.on('context-menu', (event, params) => {
    const template = [];

    if (params.misspelledWord) {
      const suggestions = (params.dictionarySuggestions || []).slice(0, 6);
      if (suggestions.length) {
        suggestions.forEach(s => template.push({
          label: s,
          click: () => webContents.replaceMisspelling(s),
        }));
        template.push({ type: 'separator' });
      }
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

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(webContents) });
  });
}

function enableSpellcheckForSession(ses, langs = DEFAULT_SPELL_LANGS) {
  try {
    ses.setSpellCheckerLanguages(langs);
    // ses.setSpellCheckerDictionaryDownloadURL('https://dl.google.com/dl/edgedl/chrome/dict/');
  } catch (e) {
    console.warn('Spellcheck language set failed:', e.message);
  }
}

function createWindow () {
  const bounds = store.get('windowBounds') || { width: 980, height: 700 };

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 760,
    minHeight: 520,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      spellcheck: true,
    }
  });

  // Persist window bounds
  const saveBounds = () => store.set('windowBounds', win.getBounds());
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

  win.removeMenu();
  win.loadFile('index.html');

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Spellcheck + context menu
  const defaultSes = session.defaultSession;
  enableSpellcheckForSession(defaultSes);
  attachSpellcheckContextMenu(win.webContents, defaultSes);

  win.webContents.on('did-attach-webview', (_e, wc) => {
    const plusSes = session.fromPartition('persist:voiddesk-plus');
    enableSpellcheckForSession(plusSes);
    attachSpellcheckContextMenu(wc, plusSes);
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Simple config passthrough
ipcMain.handle('cfg:get', (_e, key) => store.get(key));
ipcMain.handle('cfg:set', (_e, key, value) => store.set(key, value));

// Clear cookies/session for Plus mode on request (use the WebView's partition)
ipcMain.handle('plus:logout', async () => {
  const plusSession = session.fromPartition('persist:voiddesk-plus');
  await plusSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'serviceworkers', 'caches', 'indexdb', 'websql']
  });
  return true;
});

// Hard reload (full BrowserWindow reload)
ipcMain.handle('app:hardReload', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.reload();
  return true;
});

// Auto-recover if renderer crashes
app.on('renderer-process-crashed', (_e, wc) => {
  const win = BrowserWindow.fromWebContents(wc);
  if (win) win.reload();
});
