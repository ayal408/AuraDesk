const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wallpaperHost', {
  onConfig: (callback) => {
    const listener = (_event, config) => callback(config);
    ipcRenderer.on('wallpaper-config', listener);
    return () => ipcRenderer.removeListener('wallpaper-config', listener);
  },
  onPlayback: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('playback', listener);
    return () => ipcRenderer.removeListener('playback', listener);
  }
});
