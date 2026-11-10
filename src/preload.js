const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('auradesk', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  chooseFile: () => ipcRenderer.invoke('library:choose-file'),
  addUrl: (payload) => ipcRenderer.invoke('library:add-url', payload),
  removeItem: (id) => ipcRenderer.invoke('library:remove', id),
  applyWallpaper: (id) => ipcRenderer.invoke('wallpaper:apply', id),
  stopWallpaper: () => ipcRenderer.invoke('wallpaper:stop'),
  togglePause: () => ipcRenderer.invoke('wallpaper:toggle-pause'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  openLog: () => ipcRenderer.invoke('app:open-log'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state:changed', listener);
    return () => ipcRenderer.removeListener('state:changed', listener);
  },
  onRuntime: (callback) => {
    const listener = (_event, runtime) => callback(runtime);
    ipcRenderer.on('runtime:changed', listener);
    return () => ipcRenderer.removeListener('runtime:changed', listener);
  }
});
