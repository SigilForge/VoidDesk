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
    // New: trigger download and open folder
    start: (url) => ipcRenderer.send('download:url', url),
    openFolder: () => ipcRenderer.invoke('downloads:openFolder')
  }
});

contextBridge.exposeInMainWorld('electronAPI', {
  openNewShell: (chatId) => ipcRenderer.send('chat:openNewShell', chatId),
  closeShell: (chatId) => ipcRenderer.send('chat:closeShell', chatId),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  unmaximize: () => ipcRenderer.send('window:unmaximize'),
  isMaximized: () => ipcRenderer.send('window:isMaximized'),
  onAppEvent: (event, fn) => {
    ipcRenderer.on(event, (_e, ...args) => fn(...args));
  },
  onceAppEvent: (event, fn) => {
    ipcRenderer.once(event, (_e, ...args) => fn(...args));
  },
  send: (channel, ...args) => {
    ipcRenderer.send(channel, ...args);
  },
  invoke: (channel, ...args) => {
    return ipcRenderer.invoke(channel, ...args);
  }
});
