const test = require('node:test');
const assert = require('node:assert/strict');
const {
  defaultState,
  normalizeState,
  normalizeWebUrl,
  itemFromFile,
  itemFromUrl,
  nativeHandleToString,
  nativeDisplayBounds
} = require('../src/lib');

test('default state contains the three built-in wallpapers', () => {
  const state = defaultState();
  assert.equal(state.library.length, 3);
  assert.equal(state.settings.pauseFullscreen, true);
});

test('normalization restores built-ins without duplicating them', () => {
  const state = normalizeState({
    library: [{ id: 'builtin-old', kind: 'builtin' }, { id: 'mine', kind: 'video', source: 'x.mp4' }],
    settings: { muted: false }
  });
  assert.equal(state.library.length, 4);
  assert.equal(state.library.filter((item) => item.id.startsWith('builtin-')).length, 3);
  assert.equal(state.settings.muted, false);
});

test('web URLs receive https and reject unsafe protocols', () => {
  assert.equal(normalizeWebUrl('example.com'), 'https://example.com/');
  assert.throws(() => normalizeWebUrl('file:///c:/secret'), /HTTP/);
});

test('file and URL items get the expected kinds', () => {
  assert.equal(itemFromFile('C:\\media\\ocean.mp4').kind, 'video');
  assert.equal(itemFromFile('C:\\media\\loop.gif').kind, 'image');
  assert.equal(itemFromFile('C:\\wallpapers\\clock.html').kind, 'html');
  assert.equal(itemFromUrl('https://example.com').kind, 'web');
});

test('native Windows handles are serialized without precision loss', () => {
  const handle = Buffer.alloc(8);
  handle.writeBigUInt64LE(0x1234567890ABCDEFn);
  assert.equal(nativeHandleToString(handle), '1311768467294899695');
  assert.throws(() => nativeHandleToString(Buffer.alloc(2)), /valid native window handle/);
});

test('display bounds are converted from Electron DIP units to native pixels', () => {
  assert.deepEqual(nativeDisplayBounds({
    bounds: { x: 0, y: 0, width: 1536, height: 864 },
    scaleFactor: 1.25,
    nativeOrigin: { x: 0, y: 0 }
  }), { x: 0, y: 0, width: 1920, height: 1080 });

  assert.deepEqual(nativeDisplayBounds({
    bounds: { x: -1280, y: 0, width: 1280, height: 720 },
    scaleFactor: 1.5,
    nativeOrigin: { x: -1920, y: 0 }
  }), { x: -1920, y: 0, width: 1920, height: 1080 });
});
