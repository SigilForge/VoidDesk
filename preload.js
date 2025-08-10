const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('VoidDesk', {
  cfg: {
    get: (k) => ipcRenderer.invoke('cfg:get', k),
    set: (k, v) => ipcRenderer.invoke('cfg:set', k, v)
  },
  plus: {
    logout: () => ipcRenderer.invoke('plus:logout')
  },
  app: {
    hardReload: () => ipcRenderer.invoke('app:hardReload'),
    relaunch: () => ipcRenderer.invoke('app:relaunch')
  },
  downloads: {
    // events
    onProgress: (fn) => {
      ipcRenderer.on('download:progress', (_e, d) => fn(d));
      ipcRenderer.on('downloadPlus:progress', (_e, d) => fn(d));
    },
    onStart: (fn) => {
      ipcRenderer.on('download:start', (_e, d) => fn(d));
      ipcRenderer.on('downloadPlus:start', (_e, d) => fn(d));
    },
    onDone: (fn) => {
      ipcRenderer.on('download:done', (_e, d) => fn(d));
      ipcRenderer.on('downloadPlus:done', (_e, d) => fn(d));
    },
    // actions
    start: (url) => ipcRenderer.send('download:url', url),
    openFolder: () => ipcRenderer.invoke('downloads:openFolder'),
    openFile: (path) => ipcRenderer.invoke('downloads:openFile', path),
    getHistory: () => ipcRenderer.invoke('downloads:getHistory'),
    clearHistory: () => ipcRenderer.invoke('downloads:clearHistory'),
  },
  spellcheck: {
    setLanguages: (langs) => ipcRenderer.invoke('spellcheck:setLanguages', langs)
  }
});

// Optional: legacy API surface if you still use it elsewhere
contextBridge.exposeInMainWorld('electronAPI', {
  openNewShell: (chatId) => ipcRenderer.send('chat:openNewShell', chatId),
});
