// Enable spellcheck for WebView if present
window.addEventListener('DOMContentLoaded', () => {
  const plusView = document.getElementById('plusView');
  if (plusView) plusView.setAttribute('spellcheck', 'true');
});
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
