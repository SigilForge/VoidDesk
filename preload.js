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
    hardReload: () => ipcRenderer.invoke('app:hardReload')
  }
});
