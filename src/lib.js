const crypto = require('node:crypto');

const BUILTIN_WALLPAPERS = Object.freeze([
  {
    id: 'builtin-aurora',
    title: 'זוהר צפוני',
    subtitle: 'גלי צבע רגועים',
    kind: 'builtin',
    source: 'aurora',
    accent: '#7c5cff'
  },
  {
    id: 'builtin-nebula',
    title: 'ערפילית',
    subtitle: 'חלקיקים בחלל עמוק',
    kind: 'builtin',
    source: 'nebula',
    accent: '#36d1dc'
  },
  {
    id: 'builtin-grid',
    title: 'אופק ניאון',
    subtitle: 'רשת רטרו בתנועה',
    kind: 'builtin',
    source: 'grid',
    accent: '#ff4fb8'
  }
]);

const DEFAULT_SETTINGS = Object.freeze({
  pauseFullscreen: true,
  pauseOnBattery: true,
  muted: true,
  autoUpdate: true,
  startAtLogin: false,
  displayId: 'primary'
});

function defaultState() {
  return {
    version: 1,
    library: BUILTIN_WALLPAPERS.map((item) => ({ ...item })),
    selectedId: null,
    settings: { ...DEFAULT_SETTINGS }
  };
}

function normalizeState(value) {
  const fallback = defaultState();
  if (!value || typeof value !== 'object') return fallback;

  const custom = Array.isArray(value.library)
    ? value.library.filter((item) => item && !String(item.id || '').startsWith('builtin-'))
    : [];

  return {
    version: 1,
    library: [
      ...BUILTIN_WALLPAPERS.map((item) => ({ ...item })),
      ...custom.filter((item) => ['video', 'image', 'web', 'html'].includes(item.kind))
    ],
    selectedId: typeof value.selectedId === 'string' ? value.selectedId : null,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(value.settings && typeof value.settings === 'object' ? value.settings : {})
    }
  };
}

function normalizeWebUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('נא להזין כתובת אינטרנט.');
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) {
    throw new Error('ניתן להוסיף רק כתובות HTTP או HTTPS.');
  }

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error('כתובת האינטרנט אינה תקינה.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('ניתן להוסיף רק כתובות HTTP או HTTPS.');
  }
  return url.toString();
}

function itemFromFile(filePath, title) {
  const extension = String(filePath).split('.').pop().toLowerCase();
  const videoExtensions = new Set(['mp4', 'webm', 'mov', 'm4v', 'avi']);
  const imageExtensions = new Set(['gif', 'webp', 'png', 'jpg', 'jpeg', 'bmp']);
  let kind;
  if (videoExtensions.has(extension)) kind = 'video';
  if (imageExtensions.has(extension)) kind = 'image';
  if (extension === 'html' || extension === 'htm') kind = 'html';
  if (!kind) throw new Error('סוג הקובץ אינו נתמך.');

  const fallbackTitle = String(filePath).split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  return {
    id: crypto.randomUUID(),
    title: String(title || fallbackTitle).trim().slice(0, 80),
    subtitle: kind === 'video' ? 'וידאו מקומי' : kind === 'html' ? 'HTML מקומי' : 'תמונה מונפשת',
    kind,
    source: filePath,
    accent: '#6f8cff',
    createdAt: new Date().toISOString()
  };
}

function itemFromUrl(input, title) {
  const source = normalizeWebUrl(input);
  const host = new URL(source).hostname.replace(/^www\./, '');
  return {
    id: crypto.randomUUID(),
    title: String(title || host).trim().slice(0, 80),
    subtitle: host,
    kind: 'web',
    source,
    accent: '#23c9b8',
    createdAt: new Date().toISOString()
  };
}

function nativeHandleToString(handle) {
  if (!Buffer.isBuffer(handle) || handle.length < 4) {
    throw new Error('Windows did not return a valid native window handle.');
  }
  return handle.length >= 8
    ? handle.readBigUInt64LE(0).toString()
    : String(handle.readUInt32LE(0));
}

function nativeDisplayBounds(display) {
  const bounds = display?.bounds || { x: 0, y: 0, width: 1, height: 1 };
  const scaleFactor = Number(display?.scaleFactor) > 0 ? Number(display.scaleFactor) : 1;
  const nativeOrigin = display?.nativeOrigin;
  return {
    x: Number.isFinite(nativeOrigin?.x) ? Math.round(nativeOrigin.x) : Math.round(bounds.x * scaleFactor),
    y: Number.isFinite(nativeOrigin?.y) ? Math.round(nativeOrigin.y) : Math.round(bounds.y * scaleFactor),
    width: Math.max(1, Math.round(bounds.width * scaleFactor)),
    height: Math.max(1, Math.round(bounds.height * scaleFactor))
  };
}

module.exports = {
  BUILTIN_WALLPAPERS,
  DEFAULT_SETTINGS,
  defaultState,
  normalizeState,
  normalizeWebUrl,
  itemFromFile,
  itemFromUrl,
  nativeHandleToString,
  nativeDisplayBounds
};
