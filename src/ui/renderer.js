let appState = null;
let runtime = null;
let updateState = null;
let toastTimer = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function showToast(message, isError = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function currentItem() {
  return appState?.library.find((item) => item.id === appState.selectedId) || null;
}

function typeLabel(kind) {
  return ({ builtin: 'AURADESK', video: 'VIDEO', image: 'IMAGE', web: 'WEB', html: 'HTML' })[kind] || kind;
}

function makePreview(item, compact = false) {
  const preview = document.createElement('div');
  preview.className = compact ? 'now-preview' : `card-preview ${item.kind === 'builtin' ? item.source : ''}`;
  if (compact) preview.id = 'now-preview';
  if (compact && item.kind === 'builtin') preview.classList.add(item.source);

  if (item.kind === 'video' && item.previewUrl) {
    const video = document.createElement('video');
    video.src = item.previewUrl;
    video.muted = true;
    video.loop = true;
    video.autoplay = !compact;
    video.playsInline = true;
    preview.append(video);
  } else if (item.kind === 'image' && item.previewUrl) {
    const image = document.createElement('img');
    image.src = item.previewUrl;
    image.alt = '';
    preview.append(image);
  } else if (item.kind === 'web' || item.kind === 'html') {
    preview.classList.add('aurora');
    preview.style.background = `radial-gradient(circle at 30% 25%, ${item.accent}88, transparent 38%), linear-gradient(135deg,#0b1525,#18233d)`;
    const icon = document.createElement('span');
    icon.textContent = item.kind === 'html' ? '</>' : '⌁';
    icon.style.cssText = 'font-size:34px;color:#ffffffaa;position:relative;z-index:2';
    preview.append(icon);
  } else if (!compact && !item.source) {
    preview.textContent = '◌';
  }

  if (!compact) {
    const badge = document.createElement('span');
    badge.className = 'preview-type';
    badge.textContent = typeLabel(item.kind);
    preview.append(badge);
  }
  return preview;
}

function renderLibrary() {
  if (!appState) return;
  const query = $('#search-input').value.trim().toLowerCase();
  const items = appState.library.filter((item) => `${item.title} ${item.subtitle}`.toLowerCase().includes(query));
  const grid = $('#wallpaper-grid');
  grid.replaceChildren();
  $('#library-count').textContent = `${appState.library.length} רקעים`;

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<b>לא נמצאו רקעים</b><span>נסו חיפוש אחר או הוסיפו רקע חדש.</span>';
    grid.append(empty);
    return;
  }

  for (const item of items) {
    const card = document.createElement('article');
    card.className = `wallpaper-card ${item.id === appState.selectedId && runtime?.active ? 'selected' : ''}`;
    const preview = makePreview(item);
    const check = document.createElement('span');
    check.className = 'selected-check';
    check.textContent = '✓';
    preview.append(check);

    const body = document.createElement('div');
    body.className = 'card-body';
    const copy = document.createElement('div');
    copy.className = 'card-copy';
    const title = document.createElement('b');
    title.textContent = item.title;
    const subtitle = document.createElement('span');
    subtitle.textContent = item.subtitle;
    copy.append(title, subtitle);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const apply = document.createElement('button');
    apply.className = 'apply-button';
    apply.textContent = item.id === appState.selectedId && runtime?.active ? 'פעיל' : 'הפעלה';
    apply.addEventListener('click', () => activate(item.id, apply));
    actions.append(apply);

    if (item.kind !== 'builtin') {
      const remove = document.createElement('button');
      remove.className = 'remove-button';
      remove.textContent = '×';
      remove.title = 'הסרה מהספרייה';
      remove.addEventListener('click', async () => {
        const result = await window.auradesk.removeItem(item.id);
        if (!result.ok) showToast(result.error, true);
        else showToast('הרקע הוסר מהספרייה');
      });
      actions.append(remove);
    }

    body.append(copy, actions);
    card.append(preview, body);
    grid.append(card);
  }
}

async function activate(id, button) {
  const original = button.textContent;
  button.textContent = 'מפעיל…';
  button.disabled = true;
  const result = await window.auradesk.applyWallpaper(id);
  button.disabled = false;
  if (!result.ok) {
    button.textContent = original;
    showToast(result.error || 'לא הצלחנו להפעיל את הרקע.', true);
  } else {
    showToast('הרקע הופעל בהצלחה');
  }
}

function renderSettings() {
  if (!appState) return;
  $('#pause-fullscreen').checked = Boolean(appState.settings.pauseFullscreen);
  $('#pause-battery').checked = Boolean(appState.settings.pauseOnBattery);
  $('#mute-audio').checked = Boolean(appState.settings.muted);
  $('#auto-update').checked = Boolean(appState.settings.autoUpdate);
  $('#start-login').checked = Boolean(appState.settings.startAtLogin);

  const select = $('#display-select');
  select.replaceChildren();
  const automatic = document.createElement('option');
  automatic.value = 'primary';
  automatic.textContent = 'מסך ראשי (אוטומטי)';
  select.append(automatic);
  for (const display of appState.displays) {
    const option = document.createElement('option');
    option.value = display.id;
    option.textContent = display.name;
    select.append(option);
  }
  select.value = String(appState.settings.displayId || 'primary');
  if (!select.value) select.value = 'primary';
  renderUpdateState();
}

function renderUpdateState() {
  const status = $('#update-status');
  const button = $('#check-update-button');
  if (!status || !button || !updateState) return;
  status.textContent = updateState.message;
  button.disabled = updateState.status === 'checking' || updateState.status === 'downloading';
  button.textContent = updateState.status === 'checking' ? 'בודק…' : 'בדיקה עכשיו';
}

function renderRuntime() {
  if (!runtime) return;
  const chip = $('#runtime-chip');
  chip.classList.toggle('active', runtime.active && !runtime.paused);
  chip.classList.toggle('paused', runtime.active && runtime.paused);
  const chipText = chip.querySelector('span');
  const reason = ({ manual: 'מושהה ידנית', fullscreen: 'מושהה במסך מלא', battery: 'מושהה בסוללה' })[runtime.pauseReason];
  chipText.textContent = !runtime.active ? 'אין רקע פעיל' : runtime.paused ? reason : 'הרקע פועל';

  const item = currentItem();
  const nowPreview = $('#now-preview');
  nowPreview.replaceWith(item && runtime.active ? makePreview(item, true) : makeEmptyNowPreview());
  $('#now-title').textContent = item && runtime.active ? item.title : 'אין רקע פעיל';
  $('#pause-button').disabled = !runtime.active;
  $('#stop-button').disabled = !runtime.active;
  $('#pause-button').textContent = runtime.paused ? '▶' : 'Ⅱ';
  const performance = $('.performance-badge');
  performance.classList.toggle('active', runtime.active && !runtime.paused);
  $('#performance-text').textContent = !runtime.active ? 'מוכן להפעלה' : runtime.paused ? 'צריכת משאבים נמוכה' : 'אנימציה פעילה';
  renderLibrary();
}

function makeEmptyNowPreview() {
  const element = document.createElement('div');
  element.className = 'now-preview';
  element.id = 'now-preview';
  element.innerHTML = '<span>◌</span>';
  return element;
}

function switchPage(name) {
  $$('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.page === name));
  $$('.page').forEach((page) => page.classList.toggle('active', page.id === `page-${name}`));
}

async function saveSetting(key, value) {
  const result = await window.auradesk.updateSettings({ [key]: value });
  if (!result.ok) showToast('לא ניתן היה לשמור את ההגדרה.', true);
}

function closeModal() {
  $('#add-modal').hidden = true;
  $('#url-error').textContent = '';
  $('#url-input').value = '';
}

function bindEvents() {
  $('#minimize-button').addEventListener('click', () => window.auradesk.minimize());
  $('#close-button').addEventListener('click', () => window.auradesk.close());
  $$('.nav-button').forEach((button) => button.addEventListener('click', () => switchPage(button.dataset.page)));
  $('#search-input').addEventListener('input', renderLibrary);
  $('#open-add-modal').addEventListener('click', () => { $('#add-modal').hidden = false; $('#choose-file-button').focus(); });
  $('#close-add-modal').addEventListener('click', closeModal);
  $('#add-modal').addEventListener('click', (event) => { if (event.target === $('#add-modal')) closeModal(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal(); });
  $('#choose-file-button').addEventListener('click', async () => {
    const result = await window.auradesk.chooseFile();
    if (result.error) showToast(result.error, true);
    else if (!result.canceled) { closeModal(); showToast('הרקע נוסף לספרייה'); }
  });
  $('#url-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await window.auradesk.addUrl({ url: $('#url-input').value });
    if (!result.ok) $('#url-error').textContent = result.error;
    else { closeModal(); showToast('כתובת האינטרנט נוספה לספרייה'); }
  });
  $('#pause-button').addEventListener('click', () => window.auradesk.togglePause());
  $('#stop-button').addEventListener('click', () => window.auradesk.stopWallpaper());
  $('#pause-fullscreen').addEventListener('change', (event) => saveSetting('pauseFullscreen', event.target.checked));
  $('#pause-battery').addEventListener('change', (event) => saveSetting('pauseOnBattery', event.target.checked));
  $('#mute-audio').addEventListener('change', (event) => saveSetting('muted', event.target.checked));
  $('#auto-update').addEventListener('change', (event) => saveSetting('autoUpdate', event.target.checked));
  $('#start-login').addEventListener('change', (event) => saveSetting('startAtLogin', event.target.checked));
  $('#display-select').addEventListener('change', (event) => saveSetting('displayId', event.target.value));
  $('#check-update-button').addEventListener('click', async () => {
    const result = await window.auradesk.checkForUpdates();
    if (!result.ok) showToast(result.error || 'בדיקת העדכונים נכשלה.', true);
  });
  $('#github-link').addEventListener('click', async () => {
    const result = await window.auradesk.openLog();
    if (!result.ok) showToast(result.error || 'לא ניתן לפתוח את יומן האבחון.', true);
  });
}

async function initialize() {
  bindEvents();
  const bootstrap = await window.auradesk.bootstrap();
  appState = bootstrap.state;
  runtime = bootstrap.runtime;
  updateState = bootstrap.update;
  renderSettings();
  renderRuntime();
  window.auradesk.onState((nextState) => {
    appState = nextState;
    renderSettings();
    renderRuntime();
  });
  window.auradesk.onRuntime((nextRuntime) => {
    runtime = nextRuntime;
    renderRuntime();
  });
  window.auradesk.onUpdate((nextUpdate) => {
    updateState = nextUpdate;
    renderUpdateState();
  });
}

initialize().catch((error) => showToast(error.message, true));
