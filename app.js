(() => {
'use strict';
const $ = id => document.getElementById(id);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const DEMO_PHOTO = 'assets/demo.jpg';
const DEMO_LOCK = 'assets/lock_bg.png';
const STORE_KEY = 'mental_picture_v4';
const DEFAULTS = {
  mode: 'numbers', x: 48.8, y: 46.4, size: 10, rot: 0,
  ink: '#151515', suit: 'outline', redSuits: true,
  lang: 'es', circles: true,
  hasPhoto: false, hasLockBg: false,
  hasCustomFont: false, customFontName: 'CustomInk',
  lockSkin: 'auto',
  keyStyle: {}
};

/* ------------------------------------------------------------------ i18n */
const { T, INSTR, ABOUT, STEPS, LANGS, WA, TG } = window.MP_I18N;
const LANG = () => LANGS.find(l => l.code === state.lang) || LANGS[0];
const t = k => (T[state.lang] || T.es)[k] || T.es[k] || k;

/* ---------------------------------------------------------------- state */
let state = { ...DEFAULTS };
try { Object.assign(state, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch {}
function persist() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {} }

/* tiny IndexedDB key/value for images and fonts */
const idb = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('mental-picture', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = (mode, fn) => open().then(db => new Promise((res, rej) => {
    const s = db.transaction('kv', mode).objectStore('kv');
    const q = fn(s);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  }));
  return {
    get: k => tx('readonly', s => s.get(k)).catch(() => null),
    set: (k, v) => tx('readwrite', s => s.put(v, k)),
    del: k => tx('readwrite', s => s.delete(k)).catch(() => {})
  };
})();

/* ============================================================
   PIELES DE PANTALLA DE BLOQUEO (iOS / Android)
   ============================================================ */
const SKIN_DEFAULTS = {
  ios: {
    w: 84, h: 76, radius: 28, alpha: 18,
    font: 34, gap: 14, blur: 10, letters: true
  },
  android: {
    w: 76, h: 76, radius: 50, alpha: 22,
    font: 32, gap: 12, blur: 0, letters: true
  }
};

function detectPlatform() {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'ios';
  return 'ios';
}
const PLATFORM = detectPlatform();

// Normaliza el estado: rellena los valores que falten con los de fábrica
state.keyStyle = {
  ios:     { ...SKIN_DEFAULTS.ios,     ...((state.keyStyle && state.keyStyle.ios) || {}) },
  android: { ...SKIN_DEFAULTS.android, ...((state.keyStyle && state.keyStyle.android) || {}) }
};
if (!['auto', 'ios', 'android'].includes(state.lockSkin)) state.lockSkin = 'auto';

function currentSkin() {
  return state.lockSkin === 'auto' ? PLATFORM : state.lockSkin;
}

function applyLockSkin() {
  const skin = currentSkin();
  const k = state.keyStyle[skin];
  const lock = $('screen-lock');
  if (!lock) return;

  lock.classList.remove('skin-ios', 'skin-android');
  lock.classList.add('skin-' + skin);

  const set = (name, value) => lock.style.setProperty(name, value);
  set('--k-w', `min(${k.w}px, ${(k.w / 3.9).toFixed(2)}vw)`);
  set('--k-h', `min(${k.h}px, ${(k.h / 3.9).toFixed(2)}vw)`);
  set('--k-radius', k.radius + '%');
  set('--k-bg', `rgba(255,255,255,${(k.alpha / 100).toFixed(3)})`);
  set('--k-bg-press', `rgba(255,255,255,${Math.min(0.6, k.alpha / 100 + 0.22).toFixed(3)})`);
  set('--k-font', `calc(var(--k-w) * ${(k.font / k.w).toFixed(4)})`);
  set('--k-gap', k.gap + 'px');
  set('--k-blur', k.blur + 'px');

  const prev = $('lock-preview');
  if (prev) {
    prev.classList.remove('skin-ios', 'skin-android');
    prev.classList.add('skin-' + skin);
    prev.style.setProperty('--kp-radius', k.radius + '%');
    prev.style.setProperty('--kp-bg', `rgba(255,255,255,${(k.alpha / 100).toFixed(3)})`);
    prev.style.setProperty('--kp-ratio', (k.h / k.w).toFixed(3));
  }
}

function syncSkinControls() {
  // (Los sliders del panel de edición se cablean más abajo; esta función
  //  solo se llama si se añade el panel de edición en el HTML.)
  applyLockSkin();
}

/* --------------------------------------------------------------- images */
const photo = new Image();
let photoURL = null, lockURL = null;

function setPhotoSrc(src) {
  return new Promise(res => {
    photo.onload = () => { res(); renderPreview(); };
    photo.onerror = () => {
      if (photo.src.indexOf(DEMO_PHOTO) < 0) photo.src = DEMO_PHOTO;
      else res();
    };
    photo.src = src;
    $('picture-mini').src = src;
  });
}

function setLockSrc(src) {
  const css = `url("${src}")`;
  $('lock-bg').style.backgroundImage = css;
  $('lock-preview').style.backgroundImage = css;
  $('lock-mini') && ($('lock-mini').src = src);
}

async function loadImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
  }
  const url = URL.createObjectURL(file);
  try {
    const im = new Image();
    im.src = url;
    await im.decode();
    return im;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

async function fileToJpeg(file, maxSide) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('type');
  const bmp = await loadImage(file);
  const w0 = bmp.width, h0 = bmp.height;
  const sc = Math.min(1, maxSide / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * sc);
  c.height = Math.round(h0 * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) =>
    c.toBlob(b => b ? res(b) : rej(new Error('blob')), 'image/jpeg', 0.9)
  );
}

async function usePhotoFile(file) {
  try {
    const blob = await fileToJpeg(file, 1800);
    if (photoURL) URL.revokeObjectURL(photoURL);
    photoURL = URL.createObjectURL(blob);
    try { await idb.set('photo', blob); } catch { toast(t('tNoStore')); }
    Object.assign(state, { hasPhoto: true, x: 50, y: 55, rot: 0 });
    persist();
    syncControls();
    await setPhotoSrc(photoURL);
    updatePictureStatus();
    toast(t('tPhotoReady'));
  } catch { toast(t('tBadImg')); }
}

async function useLockFile(file) {
  try {
    const blob = await fileToJpeg(file, 1600);
    if (lockURL) URL.revokeObjectURL(lockURL);
    lockURL = URL.createObjectURL(blob);
    try { await idb.set('lockbg', blob); } catch { toast(t('tNoStore')); }
    state.hasLockBg = true;
    persist();
    setLockSrc(lockURL);
    toast(t('tBg'));
  } catch { toast(t('tBadImg')); }
}

/* -------------------------------------------------------- custom font */
let customFontFace = null;

async function loadCustomFont() {
  if (!state.hasCustomFont) return;
  try {
    const buffer = await idb.get('customFont');
    if (!buffer) { state.hasCustomFont = false; persist(); return; }
    if (customFontFace) {
      try { document.fonts.delete(customFontFace); } catch {}
    }
    customFontFace = new FontFace(state.customFontName, buffer);
    await customFontFace.load();
    document.fonts.add(customFontFace);
  } catch (e) {
    console.warn('Custom font load failed', e);
    state.hasCustomFont = false;
    persist();
  }
}

async function useFontFile(file) {
  try {
    if (!file) return;
    const validTypes = ['font/ttf', 'font/otf', 'application/font-sfnt', 'application/vnd.ms-opentype'];
    const name = (file.name || '').toLowerCase();
    const okType = validTypes.includes(file.type) || name.endsWith('.ttf') || name.endsWith('.otf');
    if (!okType) { toast(t('fontError')); return; }
    const buffer = await file.arrayBuffer();
    const probe = new FontFace('__Probe__', buffer);
    await probe.load();
    await idb.set('customFont', buffer);
    state.hasCustomFont = true;
    persist();
    await loadCustomFont();
    renderPreview();
    toast(t('fontReady'));
  } catch (e) {
    console.warn('Font upload failed', e);
    toast(t('fontError'));
  }
}

async function resetFont() {
  try {
    if (customFontFace) {
      try { document.fonts.delete(customFontFace); } catch {}
      customFontFace = null;
    }
    await idb.del('customFont');
  } catch {}
  state.hasCustomFont = false;
  persist();
  renderPreview();
  toast(t('fontReset'));
}

/* ---------------------------------------------------------- the secret */
function decode(code) {
  const d = code.split('').map(Number);
  if (state.mode === 'numbers') {
    const out = d.map(n => n === 0 ? 0 : 10 - n).join('');
    return { kind: 'num', text: String(parseInt(out, 10)) };
  }
  const sum = d[1] + d[2];
  const rank = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[sum] || String(sum);
  return {
    kind: 'card',
    rank,
    suit: ({ 1: 2, 2: 1, 3: 3, 4: 4 })[d[0]] || 0
  };
}

function resultLabel(r) {
  return r.kind === 'num' ? r.text : r.rank + (['', '♡', '♧', '♤', '♢'][r.suit]);
}

function demoResult() {
  const code = $('test-code').value;
  if (/^\d{4}$/.test(code)) return decode(code);
  return state.mode === 'numbers'
    ? { kind: 'num', text: '9870' }
    : { kind: 'card', rank: '5', suit: 1 };
}

/* ------------------------------------------------------------ drawing */
function suitPath(s) {
  const p = new Path2D();
  const stem = () => {
    p.moveTo(.5, .62);
    p.quadraticCurveTo(.49, .88, .34, .99);
    p.lineTo(.66, .99);
    p.quadraticCurveTo(.51, .88, .5, .62);
    p.closePath();
  };
  if (s === 1) {
    p.moveTo(.5, .96);
    p.bezierCurveTo(.12, .66, -.03, .42, .1, .2);
    p.bezierCurveTo(.22, .02, .44, .04, .5, .25);
    p.bezierCurveTo(.56, .04, .78, .02, .9, .2);
    p.bezierCurveTo(1.03, .42, .88, .66, .5, .96);
    p.closePath();
  } else if (s === 4) {
    p.moveTo(.5, 0);
    p.quadraticCurveTo(.66, .3, .86, .5);
    p.quadraticCurveTo(.66, .7, .5, 1);
    p.quadraticCurveTo(.34, .7, .14, .5);
    p.quadraticCurveTo(.34, .3, .5, 0);
    p.closePath();
  } else if (s === 3) {
    p.moveTo(.5, .02);
    p.bezierCurveTo(.88, .32, 1.04, .52, .88, .7);
    p.bezierCurveTo(.76, .84, .56, .8, .5, .64);
    p.bezierCurveTo(.44, .8, .24, .84, .12, .7);
    p.bezierCurveTo(-.04, .52, .12, .32, .5, .02);
    p.closePath();
    stem();
  } else if (s === 2) {
    [[.5, .26], [.26, .56], [.74, .56]].forEach(([cx, cy]) => {
      p.moveTo(cx + .21, cy);
      p.arc(cx, cy, .21, 0, Math.PI * 2);
    });
    p.moveTo(.5, .4);
    p.lineTo(.62, .6);
    p.lineTo(.38, .6);
    p.closePath();
    stem();
  }
  return p;
}

function suitSprite(suit, size, color, filled, lw) {
  const pad = Math.ceil(lw * 2 + 2);
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(size + pad * 2);
  const g = c.getContext('2d');
  const path = suitPath(suit);
  g.translate(pad, pad);
  g.scale(size, size);
  g.fillStyle = g.strokeStyle = color;
  g.lineJoin = g.lineCap = 'round';
  if (filled) {
    g.fill(path, 'nonzero');
  } else {
    g.lineWidth = (lw * 2) / size;
    g.stroke(path);
    g.globalCompositeOperation = 'destination-out';
    g.fill(path, 'nonzero');
  }
  return { c, pad };
}

function drawInk(ctx, W, H, r) {
  const fs = Math.max(8, state.size / 100 * W);
  let color = state.ink;
  ctx.save();
  ctx.translate(state.x / 100 * W, state.y / 100 * H);
  ctx.rotate(state.rot * Math.PI / 180);
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.94;
  ctx.textBaseline = 'alphabetic';

  let bw, bh;

  if (r.kind === 'num') {
    const fontFamily = state.hasCustomFont
      ? `"${state.customFontName}", Handwriting, "Segoe Print", "Comic Sans MS", cursive`
      : `Handwriting, "Segoe Print", "Comic Sans MS", cursive`;
    ctx.font = `${fs}px ${fontFamily}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    const m = ctx.measureText(r.text);
    const asc = m.actualBoundingBoxAscent || fs * .72;
    const desc = m.actualBoundingBoxDescent || 0;
    ctx.fillText(r.text, 0, (asc - desc) / 2);
    bw = m.width;
    bh = asc + desc;
  } else {
    if (state.redSuits && (r.suit === 1 || r.suit === 4)) color = '#b3121f';
    const cf = fs * 1.3;
    ctx.font = `${cf}px CardHand, Handwriting, "Comic Sans MS", cursive`;
    ctx.fillStyle = ctx.strokeStyle = color;
    ctx.textAlign = 'left';
    ctx.lineWidth = cf * 0.035;
    ctx.lineJoin = ctx.lineCap = 'round';
    const m = ctx.measureText(r.rank);
    const asc = m.actualBoundingBoxAscent || fs * .72;
    const desc = m.actualBoundingBoxDescent || 0;
    const sz = r.suit ? asc * 0.92 : 0;
    const gap = r.suit ? cf * 0.08 : 0;
    const total = m.width + gap + sz;
    const x0 = -total / 2;
    ctx.fillText(r.rank, x0, (asc - desc) / 2);
    ctx.strokeText(r.rank, x0, (asc - desc) / 2);
    if (r.suit) {
      const lw = Math.max(1.2, cf * 0.042);
      const sp = suitSprite(r.suit, sz, color, state.suit === 'filled', lw);
      ctx.drawImage(sp.c, x0 + m.width + gap - sp.pad, -sz / 2 - sp.pad);
    }
    bw = total;
    bh = asc + desc;
  }
  ctx.restore();
  return { w: bw, h: bh };
}

function composeFull(r) {
  const c = document.createElement('canvas');
  c.width = photo.naturalWidth;
  c.height = photo.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(photo, 0, 0);
  drawInk(g, c.width, c.height, r);
  return c;
}

/* ------------------------------------------------------------ preview */
let rafId = 0;
function renderPreview() {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    if (!$('screen-picture').classList.contains('active') || !photo.naturalWidth) return;
    const box = $('studio').getBoundingClientRect();
    if (box.width < 20) return;
    const iw = photo.naturalWidth, ih = photo.naturalHeight;
    const s = Math.min((box.width - 16) / iw, (box.height - 16) / ih);
    const cw = Math.round(iw * s), ch = Math.round(ih * s);
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const cv = $('preview-canvas');
    cv.width = Math.round(cw * dpr);
    cv.height = Math.round(ch * dpr);
    cv.style.width = cw + 'px';
    cv.style.height = ch + 'px';
    const g = cv.getContext('2d');
    g.drawImage(photo, 0, 0, cv.width, cv.height);
    const res = demoResult();
    const b = drawInk(g, cv.width, cv.height, res);
    const cvRect = cv.getBoundingClientRect();
    const tg = $('target');
    tg.style.left = (cvRect.left - box.left + state.x / 100 * cw) + 'px';
    tg.style.top = (cvRect.top - box.top + state.y / 100 * ch) + 'px';
    tg.style.width = (b.w / dpr + 22) + 'px';
    tg.style.height = (b.h / dpr + 22) + 'px';
    tg.style.transform = `translate(-50%,-50%) rotate(${state.rot}deg)`;
    $('test-out').textContent = '→ ' + resultLabel(res);
  });
}

function syncControls() {
  $('size-range').value = state.size;
  $('size-out').textContent = (+state.size).toFixed(1).replace('.0', '');
  $('rot-range').value = state.rot;
  $('rot-out').textContent = (+state.rot).toFixed(1).replace('.0', '') + '°';
  $$('#ink-swatches button').forEach(b => b.classList.toggle('on', b.dataset.ink === state.ink));
  $$('#suit-style button').forEach(b => b.classList.toggle('on', b.dataset.suit === state.suit));
  $('red-suits').checked = state.redSuits;
  $('opt-circles').checked = state.circles;
  $('lock-preview').classList.toggle('no-circles', !state.circles);
  document.body.classList.toggle('mode-cards', state.mode === 'cards');
  document.body.classList.toggle('mode-numbers', state.mode === 'numbers');
}

// Move the writing:
(() => {
  const studio = $('studio'), tg = $('target');
  let pid = null, sx = 0, sy = 0, ox = 0, oy = 0;
  const cvRect = () => $('preview-canvas').getBoundingClientRect();
  const clamp = v => Math.max(0, Math.min(100, v));

  tg.addEventListener('pointerdown', e => {
    pid = e.pointerId;
    tg.setPointerCapture?.(pid);
    sx = e.clientX; sy = e.clientY;
    ox = state.x; oy = state.y;
    studio.classList.add('dragging');
    e.preventDefault();
    e.stopPropagation();
  });
  tg.addEventListener('pointermove', e => {
    if (e.pointerId !== pid) return;
    const r = cvRect();
    state.x = clamp(ox + (e.clientX - sx) / r.width * 100);
    state.y = clamp(oy + (e.clientY - sy) / r.height * 100);
    renderPreview();
  });
  const end = e => {
    if (e.pointerId !== pid) return;
    pid = null;
    studio.classList.remove('dragging');
    persist();
  };
  tg.addEventListener('pointerup', end);
  tg.addEventListener('pointercancel', end);
  tg.addEventListener('click', e => e.stopPropagation());

  $('preview-canvas').addEventListener('click', e => {
    const r = cvRect();
    state.x = clamp((e.clientX - r.left) / r.width * 100);
    state.y = clamp((e.clientY - r.top) / r.height * 100);
    persist();
    renderPreview();
  });

  $$('#nudge [data-nx]').forEach(btn => {
    let t1, t2;
    const step = () => {
      state.x = clamp(state.x + (+btn.dataset.nx) * 0.4);
      state.y = clamp(state.y + (+btn.dataset.ny) * 0.4);
      renderPreview();
    };
    const stop = () => { clearTimeout(t1); clearInterval(t2); persist(); };
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      step();
      t1 = setTimeout(() => { t2 = setInterval(step, 45); }, 350);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, stop));
  });
})();

/* -------------------------------------------------------------- screens */
let current = 'settings';

function show(name) {
  current = name;
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
  document.querySelector('meta[name=theme-color]').content =
    name === 'reveal' ? '#000000' : name === 'lock' ? '#120d1c' : '#120d1c';
  hideToast();
  if (name === 'picture') { syncControls(); renderPreview(); }
  if (name === 'lockcfg') { syncControls(); tickClock(); }
  if (name !== 'settings') { try { history.pushState({ s: name }, ''); } catch {} }
}

function goHome() {
  if (current === 'reveal' || current === 'lock') { releaseWake(); }
  show('settings');
}

function backToLock() { startTrick(true); }

window.addEventListener('popstate', () => {
  if (current === 'lock') { try { history.pushState({ s: 'lock' }, ''); } catch {} return; }
  if (current === 'reveal') { backToLock(); return; }
  if (current !== 'settings' && current !== 'install') goHome();
});

/* ------------------------------------------------------------- toast */
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 2600);
}
function hideToast() { $('toast').classList.remove('show'); }

/* ----------------------------------------------------------- lock screen */
let pin = '', busy = false, clockTimer = 0, wake = null;

function tickClock() {
  const d = new Date(), loc = LANG().locale;
  const time = d.toLocaleTimeString(loc, {
    hour: LANG().h12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    hour12: LANG().h12
  }).replace(/\s?[AP]M$/i, '');
  const st1 = $('status-time-text'), st2 = $('status-time-text-pin');
  if (st1) st1.textContent = time;
  if (st2) st2.textContent = time;
  const t1 = $('idle-time-ios'); if (t1) t1.textContent = time;
  const t2 = $('idle-time-android'); if (t2) t2.textContent = time;
  const ds = d.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' });
  const fecha = ds.charAt(0).toUpperCase() + ds.slice(1);
  const d1 = $('idle-date-ios'); if (d1) d1.textContent = fecha;
  const d2 = $('idle-date-android'); if (d2) d2.textContent = fecha;
}

function renderDots() {
  const n = pin.length;
  const dotsHTML = Array.from({ length: 4 }, (_, i) =>
    `<i class="${i < n ? 'on' : ''}"></i>`
  ).join('');
  $('pin-dots-ios').innerHTML = dotsHTML;
  $('pin-dots-android').innerHTML = dotsHTML;
  $('pin-del-ios').classList.toggle('show', n > 0);
  $('pin-del-android').classList.toggle('show', n > 0);
}

async function requestWake() { try { wake = await navigator.wakeLock?.request('screen'); } catch {} }
function releaseWake() { try { wake?.release(); } catch {} wake = null; clearInterval(clockTimer); }

function buildKeypads() {
  const letters = { 1:'', 2:'ABC', 3:'DEF', 4:'GHI', 5:'JKL', 6:'MNO', 7:'PQRS', 8:'TUV', 9:'WXYZ', 0:'+' };

  const iosHTML = [1,2,3,4,5,6,7,8,9].map(d =>
    `<button class="key" data-d="${d}">${d}${letters[d] ? `<small>${letters[d]}</small>` : ''}</button>`
  ).join('') + `
    <button class="key key-erase" data-action="erase">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12h4l4-6v12l-4-6H3z"/><path d="M15 9l6 6M21 9l-6 6"/></svg>
    </button>
    <button class="key" data-d="0">0<small>+</small></button>
    <button class="key key-send" data-action="send">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </button>`;
  $('keypad-ios').innerHTML = iosHTML;

  const androidHTML = [1,2,3,4,5,6,7,8,9].map(d =>
    `<button class="key" data-d="${d}">${d}${letters[d] ? `<small>${letters[d]}</small>` : ''}</button>`
  ).join('') + `
    <button class="key" style="visibility:hidden"></button>
    <button class="key" data-d="0">0<small>+</small></button>
    <button class="key" style="visibility:hidden"></button>`;
  $('keypad-android').innerHTML = androidHTML;

  $$('.lock .key[data-d]').forEach(k => {
    k.addEventListener('pointerdown', e => { e.preventDefault(); k.classList.add('press'); press(k.dataset.d); });
    const up = () => k.classList.remove('press');
    k.addEventListener('pointerup', up);
    k.addEventListener('pointerleave', up);
    k.addEventListener('pointercancel', up);
    k.addEventListener('click', e => { if (e.detail === 0) press(k.dataset.d); });
  });

  $('pin-del-ios').onclick = backspace;
  $('pin-del-android').onclick = backspace;

  const eraseBtn = $('keypad-ios').querySelector('[data-action="erase"]');
  if (eraseBtn) {
    eraseBtn.addEventListener('pointerdown', e => { e.preventDefault(); eraseBtn.classList.add('press'); backspace(); });
    eraseBtn.addEventListener('pointerup', () => eraseBtn.classList.remove('press'));
    eraseBtn.addEventListener('pointerleave', () => eraseBtn.classList.remove('press'));
  }

  const sendBtn = $('keypad-ios').querySelector('[data-action="send"]');
  if (sendBtn) {
    sendBtn.addEventListener('pointerdown', e => { e.preventDefault(); sendBtn.classList.add('press'); if (pin.length === 4) { busy = true; setTimeout(unlock, 140); } });
    sendBtn.addEventListener('pointerup', () => sendBtn.classList.remove('press'));
    sendBtn.addEventListener('pointerleave', () => sendBtn.classList.remove('press'));
  }

  $('pin-emergency-ios').onclick = () => {};
  $('pin-emergency-android').onclick = () => {};
  $('pin-cancel-android').onclick = backToIdle;
  $('pin-back-ios').onclick = backToIdle;
}

function backToIdle() {
  pin = ''; busy = false; renderDots();
  $('screen-lock').classList.remove('pin-revealed');
}

function attachIdleSwipe() {
  const idle = $('lock-idle');
  if (!idle) return;
  let startY = 0, dragging = false;

  const onStart = e => {
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    dragging = true;
  };
  const onEnd = e => {
    if (!dragging) return;
    dragging = false;
    const endY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
    const dy = startY - endY;
    if (dy > 60) {
      $('screen-lock').classList.add('pin-revealed');
    }
  };

  idle.addEventListener('touchstart', onStart, { passive: true });
  idle.addEventListener('touchend', onEnd);
  idle.addEventListener('mousedown', onStart);
  idle.addEventListener('mouseup', onEnd);
  idle.addEventListener('mouseleave', () => { dragging = false; });

  idle.addEventListener('click', e => {
    if (e.target.closest('.idle-tool')) return;
    $('screen-lock').classList.add('pin-revealed');
  });
}

function startTrick(test) {
  if (!state.hasPhoto && !test) toast(t('tUsingDemo'));
  pin = ''; busy = false; renderDots();
  const lock = $('screen-lock');
  lock.classList.remove('unlocking', 'shake', 'pin-revealed');
  lock.classList.toggle('circles', state.circles);
  applyLockSkin();
  buildKeypads();
  tickClock();
  clearInterval(clockTimer);
  clockTimer = setInterval(tickClock, 15000);
  requestWake();
  show('lock');
  setTimeout(hideToast, 1200);
}

function press(d) {
  if (current !== 'lock' || busy || pin.length >= 4) return;
  pin += d;
  renderDots();
  navigator.vibrate?.(8);
  if (pin.length === 4) { busy = true; setTimeout(unlock, 140); }
}

function backspace() {
  if (current !== 'lock' || busy) return;
  pin = pin.slice(0, -1);
  renderDots();
}

let revealBlob = null, revealURL = null;

function unlock() {
  const r = decode(pin);
  const canvas = composeFull(r);
  canvas.toBlob(blob => {
    revealBlob = blob;
    if (revealURL) URL.revokeObjectURL(revealURL);
    revealURL = URL.createObjectURL(blob);
    const img = $('reveal-img');
    img.onload = () => {
      $('screen-lock').classList.add('unlocking');
      setTimeout(() => {
        const d = new Date();
        $('g-time').textContent = d.toLocaleTimeString(LANG().locale, {
          hour: LANG().h12 ? 'numeric' : '2-digit',
          minute: '2-digit',
          hour12: LANG().h12
        });
        const rv = $('screen-reveal');
        rv.classList.remove('clean');
        $('g-stage').classList.remove('zoom');
        $('g-fav').classList.remove('on');
        rv.classList.remove('enter');
        void rv.offsetWidth;
        rv.classList.add('enter');
        clearInterval(clockTimer);
        show('reveal');
      }, 330);
    };
    img.src = revealURL;
  }, 'image/jpeg', 0.93);
}

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `IMG_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.jpg`;
}

function downloadBlob(blob, silent) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = stamp();
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  if (!silent) toast(t('tExport'));
}

async function shareReveal() {
  if (!revealBlob) return;
  const file = new File([revealBlob], stamp(), { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  downloadBlob(revealBlob);
}

/* ---------------------------------------------------------- language */
function applyLang() {
  document.documentElement.lang = state.lang;
  $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-aria]').forEach(el => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  $('lang-toggle').textContent = state.lang.toUpperCase();
  $('instruction-body').innerHTML = INSTR[state.lang] || INSTR.es;
  $('about-body').innerHTML = ABOUT[state.lang] || ABOUT.es;
  $('cc-wa').href = WA[state.lang] || WA.es;
  $('cc-tg').href = TG[state.lang] || TG.es;
  $$('#lang-menu [data-lang]').forEach(b => b.classList.toggle('on', b.dataset.lang === state.lang));
  updatePictureStatus();
  tickClock();
}

function updatePictureStatus() {
  $('picture-status').textContent = state.hasPhoto ? t('rowPictureOwn') : t('rowPictureSub');
}

function setMode(m) {
  state.mode = m;
  persist();
  syncControls();
  ['cards', 'numbers'].forEach(k => $('mode-' + k).setAttribute('aria-checked', String(k === m)));
  renderPreview();
}

/* ------------------------------------------------------------- wiring */
$('mode-cards').onclick = () => setMode('cards');
$('mode-numbers').onclick = () => setMode('numbers');

$('lang-toggle').onclick = e => {
  e.stopPropagation();
  $('lang-menu').hidden = !$('lang-menu').hidden;
};
$('lang-menu').innerHTML = LANGS.map(l =>
  `<button type="button" data-lang="${l.code}"><span>${l.flag}</span>${l.name}</button>`
).join('');
$$('#lang-menu [data-lang]').forEach(b => b.onclick = () => {
  state.lang = b.dataset.lang;
  persist();
  applyLang();
  $('lang-menu').hidden = true;
});
document.addEventListener('click', e => {
  if (!e.target.closest('#lang-menu')) $('lang-menu').hidden = true;
});

$('picture-btn').onclick = () => show('picture');
$('lockcfg-btn').onclick = () => show('lockcfg');
$('instructions-btn').onclick = () => show('instructions');
$('about-btn').onclick = () => show('about');
$('start-btn').onclick = () => startTrick(false);

$$('[data-back]').forEach(b => b.onclick = () => {
  if (current === 'picture') persist();
  history.back();
});

$('camera-btn').onclick = () => $('camera-input').click();
$('gallery-btn').onclick = () => $('gallery-input').click();
['camera-input', 'gallery-input'].forEach(id => $(id).onchange = e => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (f) usePhotoFile(f);
});

$('demo-btn').onclick = async () => {
  if (photoURL) URL.revokeObjectURL(photoURL);
  photoURL = null;
  await idb.del('photo');
  Object.assign(state, { hasPhoto: false, x: DEFAULTS.x, y: DEFAULTS.y, size: DEFAULTS.size, rot: 0 });
  persist();
  syncControls();
  await setPhotoSrc(DEMO_PHOTO);
  updatePictureStatus();
  toast(t('tDemo'));
};

$('size-range').oninput = e => { state.size = +e.target.value; syncControls(); renderPreview(); };
$('rot-range').oninput = e => { state.rot = +e.target.value; syncControls(); renderPreview(); };
['size-range', 'rot-range'].forEach(id => $(id).onchange = persist);

$$('#ink-swatches button').forEach(b => b.onclick = () => {
  state.ink = b.dataset.ink;
  persist();
  syncControls();
  renderPreview();
});
$$('#suit-style button').forEach(b => b.onclick = () => {
  state.suit = b.dataset.suit;
  persist();
  syncControls();
  renderPreview();
});
$('red-suits').onchange = e => { state.redSuits = e.target.checked; persist(); renderPreview(); };

$('test-code').oninput = e => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
  renderPreview();
};

$('center-btn').onclick = () => {
  Object.assign(state, state.hasPhoto
    ? { x: 50, y: 55, rot: 0 }
    : { x: DEFAULTS.x, y: DEFAULTS.y, size: DEFAULTS.size, rot: 0 });
  persist();
  syncControls();
  renderPreview();
};

$('picture-done').onclick = () => { persist(); history.back(); toast(t('tSaved')); };

$('font-upload-btn').onclick = () => $('font-input').click();
$('font-input').onchange = e => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (f) useFontFile(f);
};
$('font-reset-btn').onclick = () => resetFont();

$('lockbg-btn').onclick = () => $('lockbg-input').click();
$('lockbg-input').onchange = e => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (f) useLockFile(f);
};
$('lockbg-reset').onclick = async () => {
  await idb.del('lockbg');
  state.hasLockBg = false;
  persist();
  setLockSrc(DEMO_LOCK);
  toast(t('tBgReset'));
};

$('opt-circles').onchange = e => {
  state.circles = e.target.checked;
  persist();
  syncControls();
};

$('lock-test').onclick = () => startTrick(true);

// Salida secreta: mantener pulsada la hora 2 segundos
['status-time', 'lock-clock', 'idle-time-ios', 'idle-time-android'].forEach(id => {
  let tm;
  const h = $(id);
  if (!h) return;
  h.addEventListener('pointerdown', e => {
    e.preventDefault();
    clearTimeout(tm);
    tm = setTimeout(() => {
      navigator.vibrate?.(40);
      goHome();
    }, 2000);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
    h.addEventListener(ev, () => clearTimeout(tm))
  );
  h.addEventListener('contextmenu', e => e.preventDefault());
});

$('g-back').onclick = backToLock;
$('g-share').onclick = shareReveal;
$('g-fav').onclick = () => $('g-fav').classList.toggle('on');

(() => {
  let last = 0, timer;
  $('g-stage').addEventListener('click', e => {
    const now = Date.now();
    if (now - last < 300) {
      clearTimeout(timer);
      const st = $('g-stage'), img = $('reveal-img'), r = img.getBoundingClientRect();
      img.style.transformOrigin = `${(e.clientX - r.left) / r.width * 100}% ${(e.clientY - r.top) / r.height * 100}%`;
      st.classList.toggle('zoom');
      last = 0;
      return;
    }
    last = now;
    timer = setTimeout(() => $('screen-reveal').classList.toggle('clean'), 260);
  });
})();

document.addEventListener('keydown', e => {
  if (current === 'lock') {
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') backspace();
    else if (e.key === 'Escape') goHome();
    return;
  }
  if (e.key === 'Escape' && current !== 'settings') goHome();
});

window.addEventListener('resize', renderPreview);

document.addEventListener('contextmenu', e => {
  if (!e.target.closest('input')) e.preventDefault();
});
document.addEventListener('selectstart', e => {
  if (!e.target.closest || !e.target.closest('input')) e.preventDefault();
});
document.addEventListener('dragstart', e => e.preventDefault());
document.addEventListener('gesturestart', e => e.preventDefault());

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    tickClock();
    if (current === 'lock' || current === 'reveal') requestWake();
  }
});

/* ------------------------------------------------------------ install */
const isInstalled = () =>
  ['fullscreen', 'standalone', 'minimal-ui'].some(m => matchMedia(`(display-mode: ${m})`).matches)
  || navigator.standalone === true;

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  $('install-btn').hidden = true;
  $('inst-manual').hidden = true;
  $('inst-done').hidden = false;
});

function manualSteps() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const st = STEPS[state.lang] || STEPS.es;
  const steps = ios ? st.ios : st.android;
  $('inst-steps').innerHTML = steps.map(x => `<li>${x}</li>`).join('');
  $('inst-manual').hidden = false;
}

$('install-btn').onclick = async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    try {
      const c = await deferredPrompt.userChoice;
      if (c.outcome === 'accepted') {
        $('install-btn').hidden = true;
        $('inst-done').hidden = false;
      }
    } catch {}
    deferredPrompt = null;
  } else manualSteps();
};

$('install-skip').onclick = () => {
  try { sessionStorage.setItem('mp_skip_install', '1'); } catch {}
  show('settings');
};

function firstScreen() {
  let skipped = false;
  try { skipped = sessionStorage.getItem('mp_skip_install') === '1'; } catch {}
  if (!isInstalled() && !skipped) {
    current = 'install';
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-install'));
  } else {
    current = 'settings';
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-settings'));
  }
}

firstScreen();

/* --------------------------------------------------------------- boot */
(async () => {
  try {
    const old = JSON.parse(localStorage.getItem('gee_mental_v2') || 'null');
    if (old && !localStorage.getItem(STORE_KEY)) {
      ['mode', 'x', 'y', 'size'].forEach(k => { if (old[k] != null) state[k] = old[k]; });
      if (old.photo) {
        const b = await (await fetch(old.photo)).blob();
        await idb.set('photo', b);
        state.hasPhoto = true;
      }
      persist();
    }
  } catch {}

  setMode(state.mode === 'cards' ? 'cards' : 'numbers');
  applyLang();
  syncControls();
  attachIdleSwipe();

  try {
    await Promise.all([
      document.fonts.load('40px Handwriting'),
      document.fonts.load('40px CardHand')
    ]);
  } catch {}

  await loadCustomFont();

  let src = DEMO_PHOTO;
  if (state.hasPhoto) {
    const b = await idb.get('photo');
    if (b) {
      photoURL = URL.createObjectURL(b);
      src = photoURL;
    } else {
      state.hasPhoto = false;
    }
  }
  await setPhotoSrc(src);
  updatePictureStatus();

  if (state.hasLockBg) {
    const b = await idb.get('lockbg');
    if (b) {
      lockURL = URL.createObjectURL(b);
      setLockSrc(lockURL);
    } else {
      state.hasLockBg = false;
    }
  }
  persist();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
})();

window.__mp = { decode: c => resultLabel(decode(c)), state: () => state };
})();