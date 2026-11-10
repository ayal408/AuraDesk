const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
  shell,
  Tray
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const {
  defaultState,
  normalizeState,
  itemFromFile,
  itemFromUrl,
  nativeHandleToString
} = require('./lib');

const APP_NAME = 'AuraDesk';
const UI_SIZE = { width: 1180, height: 760 };

let mainWindow = null;
let wallpaperWindow = null;
let tray = null;
let fullscreenWatcher = null;
let state = defaultState();
let statePath = '';
let logPath = '';
let runtime = {
  active: false,
  paused: false,
  pauseReason: null,
  fullscreen: false,
  onBattery: false,
  userPaused: false,
  error: null
};

function appendLog(event, details = {}) {
  if (!logPath) return;
  try {
    const entry = JSON.stringify({ time: new Date().toISOString(), event, ...details });
    fs.appendFileSync(logPath, `${entry}\n`, 'utf8');
  } catch {}
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function readState() {
  statePath = path.join(app.getPath('userData'), 'state.json');
  logPath = path.join(app.getPath('userData'), 'auradesk.log');
  try {
    state = normalizeState(JSON.parse(fs.readFileSync(statePath, 'utf8')));
  } catch {
    state = defaultState();
  }
  appendLog('app-start', { version: app.getVersion(), packaged: app.isPackaged, platform: process.platform, arch: process.arch });
}

function writeState() {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function displayLabel(display, index) {
  const size = `${display.size.width}×${display.size.height}`;
  return {
    id: String(display.id),
    name: index === 0 || display.id === screen.getPrimaryDisplay().id ? `מסך ראשי · ${size}` : `מסך ${index + 1} · ${size}`,
    bounds: display.bounds,
    primary: display.id === screen.getPrimaryDisplay().id
  };
}

function publicState() {
  return {
    ...state,
    library: state.library.map((item) => ({
      ...item,
      previewUrl: ['video', 'image'].includes(item.kind) && fs.existsSync(item.source)
        ? pathToFileURL(item.source).href
        : null
    })),
    displays: screen.getAllDisplays().map(displayLabel)
  };
}

function notifyState() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('state:changed', publicState());
}

function notifyRuntime() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('runtime:changed', { ...runtime });
}

function updateLoginSetting() {
  app.setLoginItemSettings({
    openAtLogin: Boolean(state.settings.startAtLogin),
    path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
    args: app.isPackaged ? [] : [path.resolve(__dirname, '..')]
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    ...UI_SIZE,
    minWidth: 940,
    minHeight: 640,
    frame: false,
    backgroundColor: '#090b12',
    show: false,
    title: APP_NAME,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', fs.existsSync(path.join(__dirname, '..', 'assets', 'icon.ico')) ? 'icon.ico' : 'icon.png');
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image.resize({ width: 20, height: 20 }));
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'פתיחת AuraDesk', click: () => showMainWindow() },
    { label: runtime.paused ? 'המשך רקע' : 'השהיית רקע', click: () => toggleUserPause() },
    { label: 'עצירת הרקע', click: () => stopWallpaper() },
    { type: 'separator' },
    { label: 'יציאה', click: () => quitApp() }
  ]));
  tray.on('double-click', () => showMainWindow());
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'פתיחת AuraDesk', click: () => showMainWindow() },
    { label: runtime.paused ? 'המשך רקע' : 'השהיית רקע', enabled: runtime.active, click: () => toggleUserPause() },
    { label: 'עצירת הרקע', enabled: runtime.active, click: () => stopWallpaper() },
    { type: 'separator' },
    { label: 'יציאה', click: () => quitApp() }
  ]));
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  mainWindow.show();
  mainWindow.focus();
}

function getDisplay() {
  const displays = screen.getAllDisplays();
  if (state.settings.displayId === 'primary') return screen.getPrimaryDisplay();
  return displays.find((item) => String(item.id) === String(state.settings.displayId)) || screen.getPrimaryDisplay();
}

function helperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'desktop-host.ps1')
    : path.join(__dirname, 'scripts', 'desktop-host.ps1');
}

function runDesktopHelper(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', helperPath(),
      ...args
    ], { windowsHide: true });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || stdout.trim() || `Desktop helper exited with ${code}`));
    });
  });
}

async function attachToDesktop(window, bounds) {
  const windowHandle = nativeHandleToString(window.getNativeWindowHandle());
  const output = await runDesktopHelper([
    '-Mode', 'attach',
    '-WindowHandle', windowHandle,
    '-X', String(bounds.x),
    '-Y', String(bounds.y),
    '-Width', String(bounds.width),
    '-Height', String(bounds.height)
  ]);
  if (output && !output.includes('ATTACHED')) throw new Error(output);
  window.setIgnoreMouseEvents(true, { forward: false });
  return output;
}

async function applyWallpaper(id) {
  const item = state.library.find((entry) => entry.id === id);
  if (!item) throw new Error('הרקע המבוקש לא נמצא.');
  if (['video', 'image'].includes(item.kind) && !fs.existsSync(item.source)) {
    throw new Error('הקובץ המקורי לא נמצא. אפשר להסיר אותו מהספרייה ולהוסיף מחדש.');
  }

  stopWallpaper(false);
  const display = getDisplay();
  appendLog('wallpaper-apply-start', { id: item.id, kind: item.kind, displayId: display.id, bounds: display.bounds });
  const title = `AuraDeskWallpaper_${process.pid}_${Date.now()}`;
  wallpaperWindow = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: false,
    opacity: 0,
    backgroundColor: '#05060b',
    show: false,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title,
    webPreferences: {
      preload: path.join(__dirname, 'wallpaper-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  wallpaperWindow.setMenuBarVisibility(false);
  wallpaperWindow.setAlwaysOnTop(false);
  wallpaperWindow.webContents.setAudioMuted(Boolean(state.settings.muted));
  wallpaperWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  wallpaperWindow.webContents.on('will-navigate', (event, url) => {
    if (item.kind !== 'web' && !url.startsWith('file:')) event.preventDefault();
  });

  const createdWindow = wallpaperWindow;
  try {
    if (item.kind === 'web') {
      await createdWindow.loadURL(item.source);
    } else {
      const wallpaperConfig = { kind: item.kind, source: item.source };
      if (['video', 'image'].includes(item.kind)) wallpaperConfig.source = pathToFileURL(item.source).href;
      await createdWindow.loadFile(path.join(__dirname, 'wallpaper', 'index.html'));
      createdWindow.webContents.send('wallpaper-config', wallpaperConfig);
    }

    createdWindow.setTitle(title);
    createdWindow.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const attachResult = await attachToDesktop(createdWindow, display.bounds);
    appendLog('wallpaper-attached', { result: attachResult });
    createdWindow.setOpacity(1);
  } catch (error) {
    appendLog('wallpaper-apply-error', { message: error.message, stack: error.stack });
    if (!createdWindow.isDestroyed()) createdWindow.destroy();
    if (wallpaperWindow === createdWindow) wallpaperWindow = null;
    runtime.active = false;
    runtime.paused = false;
    runtime.pauseReason = null;
    throw error;
  }

  createdWindow.on('closed', () => {
    if (wallpaperWindow !== createdWindow) return;
    wallpaperWindow = null;
    runtime.active = false;
    runtime.paused = false;
    runtime.pauseReason = null;
    notifyRuntime();
  });

  state.selectedId = item.id;
  writeState();
  runtime = {
    ...runtime,
    active: true,
    paused: false,
    pauseReason: null,
    userPaused: false,
    error: null
  };
  applySuspensionState();
  notifyState();
  notifyRuntime();
  refreshTray();
  return { ok: true };
}

function stopWallpaper(shouldNotify = true) {
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) wallpaperWindow.destroy();
  wallpaperWindow = null;
  runtime.active = false;
  runtime.paused = false;
  runtime.pauseReason = null;
  runtime.userPaused = false;
  if (shouldNotify) notifyRuntime();
  refreshTray();
  return { ok: true };
}

function applySuspensionState() {
  const fullscreenPause = state.settings.pauseFullscreen && runtime.fullscreen;
  const batteryPause = state.settings.pauseOnBattery && runtime.onBattery;
  const paused = runtime.userPaused || fullscreenPause || batteryPause;
  const reason = runtime.userPaused ? 'manual' : fullscreenPause ? 'fullscreen' : batteryPause ? 'battery' : null;

  runtime.paused = paused;
  runtime.pauseReason = reason;
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    wallpaperWindow.webContents.send('playback', paused ? 'pause' : 'play');
    wallpaperWindow.webContents.setAudioMuted(Boolean(state.settings.muted) || paused);
    if (wallpaperWindow.webContents.getURL().startsWith('http')) {
      const command = paused ? 'pause' : 'play';
      wallpaperWindow.webContents.executeJavaScript(
        `document.querySelectorAll('video,audio').forEach((element) => { try { element.${command}(); } catch {} });`,
        true
      ).catch(() => {});
    }
  }
  notifyRuntime();
  refreshTray();
}

function toggleUserPause() {
  if (!runtime.active) return { ok: false };
  runtime.userPaused = !runtime.userPaused;
  applySuspensionState();
  return { ok: true, paused: runtime.paused };
}

function startFullscreenWatcher() {
  if (fullscreenWatcher) return;
  fullscreenWatcher = spawn('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', helperPath(), '-Mode', 'watch', '-OwnerPid', String(process.pid)
  ], { windowsHide: true });

  let pending = '';
  fullscreenWatcher.stdout.on('data', (data) => {
    pending += data.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    for (const line of lines) {
      if (line === 'FULLSCREEN' || line === 'NORMAL') {
        runtime.fullscreen = line === 'FULLSCREEN';
        applySuspensionState();
      }
    }
  });
  fullscreenWatcher.on('close', () => { fullscreenWatcher = null; });
}

function quitApp() {
  app.isQuitting = true;
  if (fullscreenWatcher) fullscreenWatcher.kill();
  stopWallpaper(false);
  app.quit();
}

function registerIpc() {
  ipcMain.handle('app:bootstrap', () => ({ state: publicState(), runtime: { ...runtime } }));
  ipcMain.handle('library:choose-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'בחירת וידאו או תמונה',
      properties: ['openFile'],
      filters: [
        { name: 'רקעים נתמכים', extensions: ['mp4', 'webm', 'mov', 'm4v', 'avi', 'gif', 'webp', 'png', 'jpg', 'jpeg', 'bmp'] },
        { name: 'כל הקבצים', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    try {
      const item = itemFromFile(result.filePaths[0]);
      state.library.push(item);
      writeState();
      notifyState();
      return { canceled: false, item };
    } catch (error) {
      return { canceled: false, error: error.message };
    }
  });
  ipcMain.handle('library:add-url', (_event, payload) => {
    try {
      const item = itemFromUrl(payload?.url, payload?.title);
      state.library.push(item);
      writeState();
      notifyState();
      return { ok: true, item };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle('library:remove', (_event, id) => {
    if (String(id).startsWith('builtin-')) return { ok: false, error: 'לא ניתן להסיר רקע מובנה.' };
    const wasSelected = state.selectedId === id;
    state.library = state.library.filter((item) => item.id !== id);
    if (wasSelected) {
      stopWallpaper();
      state.selectedId = null;
    }
    writeState();
    notifyState();
    return { ok: true };
  });
  ipcMain.handle('wallpaper:apply', async (_event, id) => {
    try {
      return await applyWallpaper(id);
    } catch (error) {
      runtime.error = error.message;
      notifyRuntime();
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle('wallpaper:stop', () => stopWallpaper());
  ipcMain.handle('wallpaper:toggle-pause', () => toggleUserPause());
  ipcMain.handle('settings:update', async (_event, changes) => {
    const allowed = ['pauseFullscreen', 'pauseOnBattery', 'muted', 'startAtLogin', 'displayId'];
    for (const key of allowed) {
      if (Object.hasOwn(changes || {}, key)) state.settings[key] = changes[key];
    }
    writeState();
    updateLoginSetting();
    if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
      wallpaperWindow.webContents.setAudioMuted(Boolean(state.settings.muted) || runtime.paused);
    }
    applySuspensionState();
    notifyState();
    return { ok: true };
  });
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:close', () => mainWindow?.hide());
  ipcMain.handle('app:open-external', (_event, url) => {
    if (/^https?:\/\//i.test(String(url))) shell.openExternal(String(url));
    return { ok: true };
  });
  ipcMain.handle('app:open-log', async () => {
    if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '', 'utf8');
    const error = await shell.openPath(logPath);
    return error ? { ok: false, error } : { ok: true };
  });
}

app.on('second-instance', () => showMainWindow());
app.on('before-quit', () => { app.isQuitting = true; });
app.on('window-all-closed', () => {});

app.whenReady().then(() => {
  app.setName(APP_NAME);
  Menu.setApplicationMenu(null);
  readState();
  runtime.onBattery = powerMonitor.isOnBatteryPower();
  registerIpc();
  createMainWindow();
  createTray();
  startFullscreenWatcher();
  powerMonitor.on('on-battery', () => {
    runtime.onBattery = true;
    applySuspensionState();
  });
  powerMonitor.on('on-ac', () => {
    runtime.onBattery = false;
    applySuspensionState();
  });
  powerMonitor.on('lock-screen', () => {
    runtime.fullscreen = true;
    applySuspensionState();
  });
  powerMonitor.on('unlock-screen', () => {
    runtime.fullscreen = false;
    applySuspensionState();
  });
  screen.on('display-added', notifyState);
  screen.on('display-removed', notifyState);
  screen.on('display-metrics-changed', notifyState);
});
