import { store, uid } from './store.js';
import { Stage } from './stage.js';
import { RATIOS, FONTS, slideSize, renderSlide, renderStrip, renderBoard, canvasToBlob, drawSlidesApart, drawProject, layoutText } from './render.js';
import { TEMPLATES, applyTemplate, frame, text, shape } from './templates.js';
import { makeZip } from './zip.js';
import { isVideo, isVideoFile, dims, blobToVideo, disposeDrawable, videoLength, videoSlides, videoElements,
  pickMime, unlockAudio, recordSlide, MAX_VIDEOS, MAX_SECONDS, MAX_VIDEO_MB } from './video.js';

const $ = s => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};

const SWATCHES = ['#ffffff', '#000000', '#f4f1ec', '#e9e2d6', '#16161b', '#ff4f7b', '#ffb14f', '#ffd84f', '#4fd1a5', '#3d9bff', '#7b5cff', '#1f2a44'];
const FILTERS = [
  ['Yok', 'none'], ['S/B', 'grayscale(1)'], ['Sepya', 'sepia(.6)'], ['Canlı', 'saturate(1.35) contrast(1.08)'],
  ['Soluk', 'contrast(.88) brightness(1.08) saturate(.8)'], ['Sıcak', 'sepia(.25) saturate(1.2)'],
];
const MAX_PX = 3200;

// ---------------- durum ----------------
let P = null;             // açık proje
let images = new Map();   // assetId -> çizilebilir görsel
let hist = [], hi = -1;
let saveTimer = 0;
let pendingFrame = null;  // fotoğraf bekleyen boş çerçeve
let replaceTarget = null;

const stage = new Stage($('#stage'), {
  onSelect: () => buildPanel(),
  onChange: () => commit(),
  onViewChange: () => updateStrip(),
  onEmptyFrameTap: el => { pendingFrame = el.id; $('#filePhoto').click(); },
  onDoubleTapText: () => { buildPanel(); setTimeout(() => $('#panel textarea')?.focus(), 30); },
});

// ---------------- yardımcılar ----------------
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}

function openSheet(build) {
  const body = $('#sheetBody');
  body.innerHTML = '';
  build(body);
  $('#sheet').hidden = false;
  $('#sheetBackdrop').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; $('#sheetBackdrop').hidden = true; }
$('#sheetBackdrop').addEventListener('click', closeSheet);

function swatchRow(current, onPick, { onLive } = {}) {
  const row = h('div', { class: 'swatches' });
  for (const c of SWATCHES) {
    row.append(h('button', { class: 'sw' + (c.toLowerCase() === String(current).toLowerCase() ? ' on' : ''), style: `background:${c}`, 'aria-label': c,
      onclick: () => { onPick(c); [...row.children].forEach(x => x.classList.remove('on')); row.children[SWATCHES.indexOf(c)]?.classList.add('on'); } }));
  }
  const inp = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(current) ? current : '#888888' });
  inp.addEventListener('input', () => (onLive || onPick)(inp.value));
  inp.addEventListener('change', () => onPick(inp.value));
  row.append(h('label', { class: 'sw custom', title: 'Özel renk' }, inp));
  return row;
}

function slider(label, min, max, step, value, onInput, onDone) {
  const inp = h('input', { type: 'range', min, max, step, value });
  inp.addEventListener('input', () => onInput(parseFloat(inp.value)));
  inp.addEventListener('change', () => onDone?.());
  return h('label', { class: 'slider' }, label, inp);
}

async function ensureFonts(p) {
  const need = new Set(p.elements.filter(e => e.type === 'text').map(e => `${e.italic ? 'italic ' : ''}${e.weight} 40px "${e.font}"`));
  try { await Promise.all([...need].map(f => document.fonts.load(f))); } catch { /* çevrimdışı: yedek yazı tipi */ }
}
document.fonts?.addEventListener?.('loadingdone', () => stage.render());
// Şablon küçük resimleri doğru yazı tipiyle çizilsin diye hepsini baştan yükle
const fontsReady = Promise.all(FONTS.flatMap(f => [f.reg, f.bold].map(w => document.fonts.load(`${w} 40px "${f.name}"`).catch(() => {}))));

async function blobToDrawable(blob) {
  try { return await createImageBitmap(blob); }
  catch {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  }
}

// ---------------- geçmiş ve kayıt ----------------
const snapshot = () => JSON.stringify({ slides: P.slides, ratio: P.ratio, background: P.background, bg2: P.bg2 || null, elements: P.elements });

function resetHistory() { hist = [snapshot()]; hi = 0; updateUndo(); }

function commit() {
  const s = snapshot();
  if (s === hist[hi]) return;
  hist = hist.slice(0, hi + 1);
  hist.push(s);
  if (hist.length > 80) hist.shift();
  hi = hist.length - 1;
  updateUndo();
  scheduleSave();
  buildPanel(true);
}

function restore(s) {
  Object.assign(P, JSON.parse(s));
  if (!P.elements.some(e => e.id === stage.sel)) stage.sel = null;
  stage.crop = false;
  stage.render();
  updateStrip(true);
  buildPanel();
  updateUndo();
  scheduleSave();
}
function undo() { if (hi > 0) restore(hist[--hi]); }
function redo() { if (hi < hist.length - 1) restore(hist[++hi]); }
function updateUndo() { $('#btnUndo').disabled = hi <= 0; $('#btnRedo').disabled = hi >= hist.length - 1; }

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 700);
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (!P) return;
  P.updatedAt = Date.now();
  try {
    await ensureFonts(P);
    P.thumb = await canvasToBlob(P.kind === 'board' ? renderBoard(P, images, 640, 300) : renderStrip(P, images, 300), 'image/jpeg', 0.8);
  } catch { /* küçük resim olmasa da kaydet */ }
  await store.saveProject(P);
}

// ---------------- ana ekran ----------------
async function showHome() {
  if (P) await saveNow();
  P = null;
  for (const d of images.values()) disposeDrawable(d);
  images = new Map();
  $('#editor').hidden = true;
  $('#home').hidden = false;
  const all = await store.listProjects();
  const boards = all.filter(p => p.kind === 'board');
  const list = all.filter(p => p.kind !== 'board');
  for (const b of [$('#projectList'), $('#boardList')]) { b.querySelectorAll('img').forEach(i => URL.revokeObjectURL(i.src)); b.innerHTML = ''; }
  $('#emptyHome').hidden = list.length > 0;
  $('#hBoards').hidden = boards.length === 0;
  for (const p of all) {
    const isBoard = p.kind === 'board';
    const box = isBoard ? $('#boardList') : $('#projectList');
    const thumb = h('div', { class: 'thumb' });
    if (p.thumb) thumb.append(h('img', { src: URL.createObjectURL(p.thumb), alt: '' }));
    const del = h('button', { class: 'icon-btn small', 'aria-label': 'Sil', html: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
      onclick: async ev => {
        ev.stopPropagation();
        if (!confirm(`"${p.name}" silinsin mi? Bu geri alınamaz.`)) return;
        await store.deleteProject(p.id); showHome();
      } });
    const dup = h('button', { class: 'icon-btn small', 'aria-label': 'Kopyasını oluştur', html: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/></svg>',
      onclick: async ev => { ev.stopPropagation(); await duplicateProject(p); showHome(); } });
    const d = new Date(p.updatedAt);
    box.append(h('div', { class: 'pcard', onclick: () => openProject(p.id) }, thumb,
      h('div', { class: 'meta' },
        h('div', { style: 'min-width:0' }, h('b', {}, p.name), h('small', {}, isBoard
          ? `Pano · ${p.elements.length} öğe · ${d.toLocaleDateString('tr-TR')}`
          : `${p.slides} slayt · ${p.ratio} · ${d.toLocaleDateString('tr-TR')}`)),
        h('div', { style: 'display:flex' }, dup, del))));
  }
}

async function duplicateProject(p) {
  const np = JSON.parse(JSON.stringify({ ...p, thumb: null }));
  np.id = uid(); np.name = p.name + ' (kopya)'; np.createdAt = np.updatedAt = Date.now(); np.thumb = p.thumb;
  const assets = await store.getProjectAssets(p.id);
  const map = {};
  for (const a of assets) { const nid = uid(); map[a.id] = nid; await store.putAsset({ ...a, id: nid, projectId: np.id }); }
  for (const e of np.elements) if (e.assetId) e.assetId = map[e.assetId] || null;
  await store.saveProject(np);
}

// ---------------- yeni pano ----------------
const NOTE_COLORS = ['#ffd84f', '#ffb14f', '#ff8fa8', '#9be7c4', '#8fc8ff', '#c9b6ff', '#ffffff', '#2b2b33'];

function note(x, y, str, extra = {}) {
  return { id: uid(), type: 'note', x, y, w: 520, h: 200, rot: 0, text: str, size: 40, fill: '#ffd84f', color: '#1a1a1a', opacity: 1, ...extra };
}

async function createBoard() {
  const all = await store.listProjects();
  const n = all.filter(p => p.kind === 'board').length + 1;
  const p = {
    id: uid(), kind: 'board', name: `Pano ${n}`, elements: [
      note(-560, -220, 'Sonsuz panoya hoş geldin! 👋\n\nBoş bir yere dokunup sürükleyerek gezin, iki parmakla yakınlaş.', { rot: -0.03 }),
      note(40, -160, 'Alttan not, yazı, fotoğraf ve şekil ekle. Notu düzenlemek için iki kez dokun.', { fill: '#8fc8ff', rot: 0.025 }),
    ],
    createdAt: Date.now(), updatedAt: Date.now(), thumb: null,
  };
  await store.saveProject(p);
  await openProject(p.id);
  await saveNow();
}

// ---------------- yeni proje ----------------
async function newProjectSheet() {
  await Promise.race([fontsReady, new Promise(r => setTimeout(r, 1500))]);
  let ratio = '4:5', count = 3, tplId = 'blank';
  openSheet(body => {
    body.append(h('h3', {}, 'Yeni carousel'));
    body.append(h('h4', {}, 'Oran'));
    const rrow = h('div', { class: 'opt-row' });
    for (const [k, r] of Object.entries(RATIOS)) {
      const sc = 34 / r.h;
      rrow.append(h('button', { class: 'ratio-opt' + (k === ratio ? ' on' : ''), onclick: e => {
        ratio = k; rrow.querySelectorAll('.ratio-opt').forEach(x => x.classList.remove('on')); e.currentTarget.classList.add('on'); drawTpls();
      } }, h('i', { style: `width:${r.w * sc}px;height:${r.h * sc}px` }), r.label));
    }
    body.append(rrow);
    body.append(h('h4', {}, 'Slayt sayısı'));
    const num = h('b', {}, String(count));
    const step = d => { count = Math.max(1, Math.min(20, count + d)); num.textContent = count; drawTpls(); };
    body.append(h('div', { class: 'stepper' }, h('button', { onclick: () => step(-1) }, '−'), num, h('button', { onclick: () => step(1) }, '+')));
    body.append(h('h4', {}, 'Şablon'));
    const grid = h('div', { class: 'tpl-grid' });
    body.append(grid);
    const drawTpls = () => {
      grid.innerHTML = '';
      for (const t of TEMPLATES) {
        const btn = h('button', { class: 'tpl' + (t.id === tplId ? ' on' : ''), onclick: () => {
          tplId = t.id; grid.querySelectorAll('.tpl').forEach(x => x.classList.remove('on')); btn.classList.add('on');
        } }, tplPreview(t, ratio, count), h('span', {}, t.name));
        grid.append(btn);
      }
    };
    drawTpls();
    body.append(h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn ghost', onclick: closeSheet }, 'Vazgeç'),
      h('button', { class: 'btn primary', onclick: async () => { closeSheet(); await createProject(ratio, count, tplId); } }, 'Oluştur')));
  });
}

function tplPreview(t, ratio, count) {
  const { w: W, h: H } = RATIOS[ratio];
  const r = applyTemplate(t, count, W, H);
  const p = { ratio, slides: count, background: r.background || '#ffffff', elements: r.elements };
  const c = document.createElement('canvas');
  c.width = 520; c.height = 340;
  const ctx = c.getContext('2d');
  const gap = 10, pad = 16;
  // slaytları ayrı dikey kartlar olarak, kutuya sığacak ölçekte çiz
  const sc = Math.min((c.height - pad * 2) / H, (c.width - pad * 2 - gap * (count - 1)) / (W * count));
  const tw = W * count * sc + gap * (count - 1);
  ctx.fillStyle = '#0b0b0d'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate((c.width - tw) / 2, (c.height - H * sc) / 2);
  drawSlidesApart(ctx, p, new Map(), sc, gap, { editing: true });
  return c;
}

async function createProject(ratio, count, tplId) {
  const { w: W, h: H } = RATIOS[ratio];
  const t = TEMPLATES.find(x => x.id === tplId) || TEMPLATES[0];
  const r = applyTemplate(t, count, W, H);
  const list = await store.listProjects();
  const p = {
    id: uid(), name: `Carousel ${list.length + 1}`, ratio, slides: count,
    background: r.background || '#ffffff', bg2: null, elements: r.elements,
    createdAt: Date.now(), updatedAt: Date.now(), thumb: null,
  };
  await store.saveProject(p);
  await openProject(p.id);
  await saveNow(); // proje listesinde küçük resmi hemen görünsün
}

// ---------------- editörü aç ----------------
async function openProject(id) {
  const p = await store.getProject(id);
  if (!p) return;
  for (const d of images.values()) disposeDrawable(d);
  images = new Map();
  const assets = await store.getProjectAssets(id);
  const used = new Set(p.elements.map(e => e.assetId).filter(Boolean));
  await Promise.all(assets.map(async a => {
    if (!used.has(a.id)) { store.deleteAsset(a.id); return; } // artık kullanılmayan fotoğrafları temizle
    try { images.set(a.id, a.kind === 'video' ? await blobToVideo(a.blob) : await blobToDrawable(a.blob)); } catch { /* bozuk dosya */ }
  }));
  P = p;
  $('#home').hidden = true;
  $('#editor').hidden = false;
  $('#editor').classList.toggle('is-board', p.kind === 'board');
  $('#projName').value = p.name;
  await ensureFonts(P);
  for (const e of P.elements) if (e.type === 'text') layoutText($('#stage').getContext('2d'), e);
  stage.load(P, images);
  resetHistory();
  buildPanel();
  updateStrip(true);
}

$('#projName').addEventListener('change', e => { P.name = e.target.value.trim() || 'Adsız'; scheduleSave(); });
$('#projName').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });

// ---------------- slayt şeridi ----------------
function updateStrip(rebuild) {
  if (!P) return;
  const box = $('#slideStrip');
  if (P.kind === 'board') {
    for (const id of ['#btnPrevSlide', '#btnNextSlide', '#slideCount']) $(id).hidden = true;
    return;
  }
  if (rebuild || box.children.length !== P.slides) {
    box.innerHTML = '';
    for (let i = 0; i < P.slides; i++) box.append(h('button', { onclick: () => (stage.single ? stage.focusSlide(i) : stage.panToSlide(i)) }, String(i + 1)));
  }
  const cur = stage.currentSlide();
  [...box.children].forEach((b, i) => b.classList.toggle('on', i === cur));
  const single = stage.isSingle;
  $('#btnPrevSlide').hidden = !single || cur <= 0;
  $('#btnNextSlide').hidden = !single || cur >= P.slides - 1;
  $('#slideCount').hidden = !single;
  $('#slideCount').textContent = `${cur + 1} / ${P.slides}`;
  $('#btnMode').classList.toggle('on', !single);
  $('#btnMode').setAttribute('aria-label', single ? 'Tüm slaytları göster' : 'Tek slayt göster');
}
$('#btnPrevSlide').addEventListener('click', () => stage.focusSlide(stage.cur - 1));
$('#btnNextSlide').addEventListener('click', () => stage.focusSlide(stage.cur + 1));
$('#btnMode').addEventListener('click', () => { stage.setSingle(!stage.single); updateStrip(); });

// ---------------- fotoğraf içe aktarma ----------------
async function importVideo(file) {
  if (file.size > MAX_VIDEO_MB * 1048576) throw new Error(`Video çok büyük (en fazla ${MAX_VIDEO_MB} MB)`);
  const v = await blobToVideo(file);
  const asset = { id: uid(), projectId: P.id, blob: file, w: v.videoWidth, h: v.videoHeight, kind: 'video', duration: v.duration };
  await store.putAsset(asset);
  images.set(asset.id, v);
  if (v.duration > MAX_SECONDS + 0.5) toast(`Video ${Math.round(v.duration)} sn — yalnızca ilk ${MAX_SECONDS} saniyesi kullanılacak`, 4000);
  return asset;
}

const videoCount = () => new Set(videoElements(P, images).map(e => e.assetId)).size;

async function importFile(file) {
  if (isVideoFile(file)) return importVideo(file);
  let bmp = await blobToDrawable(file);
  const w0 = bmp.width, h0 = bmp.height;
  let blob = file;
  const k = Math.min(1, MAX_PX / Math.max(w0, h0));
  const okType = /^image\/(jpeg|png|webp)$/.test(file.type);
  if (k < 1 || !okType) {
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    blob = await canvasToBlob(c, file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.92);
    bmp = await blobToDrawable(blob);
  }
  const asset = { id: uid(), projectId: P.id, blob, w: bmp.width, h: bmp.height };
  await store.putAsset(asset);
  images.set(asset.id, bmp);
  return asset;
}

function fillFrame(el, asset) {
  const r = asset.w / asset.h;
  el.assetId = asset.id;
  if (el.w / el.h > r) { el.iw = el.w; el.ih = el.w / r; } else { el.ih = el.h; el.iw = el.h * r; }
  el.cx = 0; el.cy = 0;
}

function addFreePhoto(asset, cx, cy, maxW, maxH) {
  const sc = Math.min(maxW / asset.w, maxH / asset.h);
  const w = asset.w * sc, hh = asset.h * sc;
  const el = frame(cx - w / 2, cy - hh / 2, w, hh);
  fillFrame(el, asset);
  P.elements.push(el);
  return el;
}

async function importPhotos(files, dropPoint) {
  files = [...files].filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name) || isVideoFile(f));
  // video sınırı: proje başına en fazla MAX_VIDEOS
  let room = MAX_VIDEOS - videoCount();
  const skipped = files.filter(f => isVideoFile(f) && room-- <= 0);
  files = files.filter(f => !skipped.includes(f));
  if (skipped.length) toast(`Bir projede en fazla ${MAX_VIDEOS} video olabilir; ${skipped.length} video eklenmedi`, 4000);
  if (!files.length) return;
  if (!skipped.length) toast(files.length > 1 ? `${files.length} dosya yükleniyor…` : 'Yükleniyor…', 60000);
  const { w: W, h: H } = slideSize(P);
  // Önce boş çerçeveleri doldur (seçili/bekleyen çerçeveden başlayarak), kalanlar serbest eklenir
  const empties = P.elements.filter(e => e.type === 'image' && !e.assetId);
  const first = pendingFrame || (stage.selected()?.type === 'image' && !stage.selected().assetId ? stage.sel : null);
  if (first) { const i = empties.findIndex(e => e.id === first); if (i > 0) empties.unshift(...empties.splice(i, 1)); }
  pendingFrame = null;
  let slide = stage.currentSlide();
  let last = null;
  for (const f of files) {
    let asset;
    try { asset = await importFile(f); } catch (err) { toast(err.message?.startsWith('Video') ? err.message : `"${f.name}" açılamadı`, 4000); continue; }
    const target = empties.shift();
    if (target) { fillFrame(target, asset); last = target; continue; }
    if (P.kind === 'board' && !dropPoint) dropPoint = stage.viewCenter();
    if (dropPoint) { last = addFreePhoto(asset, dropPoint.x, dropPoint.y, W * 0.8, H * 0.8); dropPoint = { x: dropPoint.x + 40, y: dropPoint.y + 40 }; }
    else { last = addFreePhoto(asset, (Math.min(slide, P.slides - 1) + 0.5) * W, H / 2, W * 0.84, H * 0.84); slide++; }
  }
  // yalnızca "yükleniyor" bildirimini kapat; uyarı/hata mesajları kendi süresi dolana kadar kalsın
  if ($('#toast').textContent.endsWith('yükleniyor…') || $('#toast').textContent === 'Yükleniyor…') $('#toast').hidden = true;
  if (last) stage.select(last.id);
  stage.render();
  commit();
}

$('#filePhoto').addEventListener('change', e => { importPhotos(e.target.files); e.target.value = ''; });
$('#fileReplace').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  const el = P.elements.find(x => x.id === replaceTarget);
  if (!f || !el) return;
  const wasVideo = isVideo(images.get(el.assetId));
  if (isVideoFile(f) && !wasVideo && videoCount() >= MAX_VIDEOS) { toast(`Bir projede en fazla ${MAX_VIDEOS} video olabilir`); return; }
  let asset;
  try { asset = await importFile(f); } catch (err) { toast(err.message || 'Dosya açılamadı'); return; }
  fillFrame(el, asset);
  stage.render(); commit();
});

// Mac: fotoğrafı sürükleyip tuvale bırak
const wrap = $('#stageWrap');
wrap.addEventListener('dragover', e => { e.preventDefault(); });
wrap.addEventListener('drop', e => {
  e.preventDefault();
  if (!P || !e.dataTransfer.files.length) return;
  const r = wrap.getBoundingClientRect();
  const wp = stage.toWorld(e.clientX - r.left, e.clientY - r.top);
  const hit = stage.hitElement(wp);
  if (hit && hit.type === 'image' && !hit.assetId) pendingFrame = hit.id;
  importPhotos(e.dataTransfer.files, pendingFrame ? null : wp);
});
// Mac: panodan yapıştır
window.addEventListener('paste', e => {
  if (!P || document.activeElement?.matches('input, textarea')) return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); importPhotos(files); }
});

// ---------------- öğe ekleme ----------------
function addElement(el) {
  P.elements.push(el);
  stage.select(el.id);
  stage.render();
  commit();
}

function addText() {
  const { w: W } = slideSize(P);
  const c = stage.viewCenter();
  const el = text(c.x - W * 0.4, c.y - 60, W * 0.8, 'Metninizi yazın', { align: 'center', color: (P.kind === 'board' || isDark(P.background)) ? '#ffffff' : '#111111', size: 96 });
  layoutText($('#stage').getContext('2d'), el);
  el.y = c.y - el.h / 2;
  addElement(el);
  setTimeout(() => { const ta = $('#panel textarea'); if (ta) { ta.focus(); ta.select(); } }, 50);
}

function addNote() {
  const c = stage.viewCenter();
  // her yeni not bir önceki renkten farklı olsun
  const last = [...P.elements].reverse().find(e => e.type === 'note');
  const fill = NOTE_COLORS[(NOTE_COLORS.indexOf(last?.fill) + 1) % 6];
  const el = note(c.x - 260, c.y - 100, 'Yeni not', { fill, rot: (Math.random() - 0.5) * 0.06 });
  addElement(el);
  setTimeout(() => { const ta = $('#panel textarea'); if (ta) { ta.focus(); ta.select(); } }, 50);
}

function addFrame() {
  const { w: W } = slideSize(P);
  const c = stage.viewCenter();
  const w = W * 0.62, hh = w * 1.25;
  addElement(frame(c.x - w / 2, c.y - hh / 2, w, hh));
  toast('Boş çerçeve eklendi — fotoğraf koymak için dokun');
}

function isDark(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || '');
  if (!m) return false;
  const [r, g, b] = m.slice(1).map(x => parseInt(x, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

function shapeSheet() {
  const { w: W } = slideSize(P);
  const c = stage.viewCenter();
  const add = (el) => { closeSheet(); addElement(el); };
  const col = (P.kind === 'board' || isDark(P.background)) ? '#ffffff' : '#111111';
  openSheet(body => {
    body.append(h('h3', {}, 'Şekil ekle'));
    body.append(h('div', { class: 'opt-row' },
      h('button', { class: 'ratio-opt', onclick: () => add(shape(c.x - W * 0.3, c.y - W * 0.3, W * 0.6, W * 0.6, { fill: col })) }, h('i', { style: 'width:30px;height:30px' }), 'Kare'),
      h('button', { class: 'ratio-opt', onclick: () => add(shape(c.x - W * 0.3, c.y - W * 0.3, W * 0.6, W * 0.6, { kind: 'ellipse', fill: col })) }, h('i', { style: 'width:30px;height:30px;border-radius:50%' }), 'Daire'),
      h('button', { class: 'ratio-opt', onclick: () => add(shape(c.x - W * 0.3, c.y - W * 0.2, W * 0.6, W * 0.4, { fill: col, radius: 40 })) }, h('i', { style: 'width:36px;height:24px;border-radius:7px' }), 'Yuvarlak'),
      h('button', { class: 'ratio-opt', onclick: () => add(shape(c.x - W * 0.8, c.y - 4, W * 1.6, 8, { fill: col })) }, h('i', { style: 'width:40px;height:3px;margin:13px 0' }), 'Çizgi'),
      h('button', { class: 'ratio-opt', onclick: () => add(shape(c.x - W, c.y - 70, W * 2, 140, { fill: '#ff4f7b' })) }, h('i', { style: 'width:44px;height:10px;margin:10px 0' }), 'Şerit')));
  });
}

function bgSheet() {
  openSheet(body => {
    body.append(h('h3', {}, 'Arka plan'));
    body.append(h('h4', {}, 'Renk'));
    body.append(swatchRow(P.background, c => { P.background = c; stage.render(); commit(); }, { onLive: c => { P.background = c; stage.render(); } }));
    body.append(h('h4', {}, 'Geçiş (şerit boyunca soldan sağa)'));
    const row = h('div', { class: 'prow' }, h('button', { class: 'chip' + (P.bg2 ? '' : ' on'), onclick: () => { P.bg2 = null; stage.render(); commit(); closeSheet(); } }, 'Düz renk'));
    body.append(row);
    body.append(swatchRow(P.bg2 || '', c => { P.bg2 = c; stage.render(); commit(); }, { onLive: c => { P.bg2 = c; stage.render(); } }));
    body.append(h('h4', {}, 'Fotoğraf'));
    body.append(h('button', { class: 'btn', onclick: () => { closeSheet(); bgPhoto(); } }, 'Tüm şeride yayılan arka plan fotoğrafı'));
  });
}

function bgPhoto() {
  const inp = h('input', { type: 'file', accept: 'image/*' });
  inp.addEventListener('change', async () => {
    const f = inp.files[0]; if (!f) return;
    toast('Fotoğraf yükleniyor…', 60000);
    const asset = await importFile(f);
    const { w: W, h: H } = slideSize(P);
    const el = frame(0, 0, W * P.slides, H);
    fillFrame(el, asset);
    P.elements.unshift(el);
    $('#toast').hidden = true;
    stage.select(el.id); stage.render(); commit();
  });
  inp.click();
}

function slidesSheet() {
  openSheet(body => {
    body.append(h('h3', {}, 'Slaytlar'));
    body.append(h('h4', {}, 'Slayt sayısı'));
    const num = h('b', {}, String(P.slides));
    const step = d => {
      const n = Math.max(1, Math.min(20, P.slides + d));
      if (n === P.slides) return;
      P.slides = n; num.textContent = n;
      stage.fit(); updateStrip(true); commit();
    };
    body.append(h('div', { class: 'stepper' }, h('button', { onclick: () => step(-1) }, '−'), num, h('button', { onclick: () => step(1) }, '+')));
    body.append(h('p', { class: 'note' }, 'Instagram bir gönderide en fazla 20 görsel kabul eder. Slayt azaltınca sağda kalan öğeler silinmez, yalnızca dışarıda kalır.'));
    body.append(h('h4', {}, 'Oran'));
    const rrow = h('div', { class: 'opt-row' });
    for (const [k, r] of Object.entries(RATIOS)) {
      const sc = 34 / r.h;
      rrow.append(h('button', { class: 'ratio-opt' + (k === P.ratio ? ' on' : ''), onclick: e => {
        P.ratio = k; rrow.querySelectorAll('.ratio-opt').forEach(x => x.classList.remove('on')); e.currentTarget.classList.add('on');
        stage.fit(); commit();
      } }, h('i', { style: `width:${r.w * sc}px;height:${r.h * sc}px` }), r.label));
    }
    body.append(rrow);
  });
}

function templateSheet() {
  openSheet(body => {
    body.append(h('h3', {}, 'Şablon uygula'));
    body.append(h('p', { class: 'note', style: 'margin-top:0' }, 'Mevcut fotoğrafların yeni şablonun çerçevelerine sırayla yerleşir. Beğenmezsen geri al.'));
    const grid = h('div', { class: 'tpl-grid', style: 'margin-top:12px' });
    for (const t of TEMPLATES) {
      grid.append(h('button', { class: 'tpl', onclick: () => { closeSheet(); useTemplate(t); } }, tplPreview(t, P.ratio, P.slides), h('span', {}, t.name)));
    }
    body.append(grid);
  });
}

function useTemplate(t) {
  const { w: W, h: H } = slideSize(P);
  const assets = P.elements.filter(e => e.type === 'image' && e.assetId && images.has(e.assetId)).map(e => e.assetId);
  const r = applyTemplate(t, P.slides, W, H);
  const extra = [];
  for (const el of r.elements) {
    if (el.type === 'image' && assets.length) {
      const id = assets.shift();
      const img = dims(images.get(id));
      fillFrame(el, { id, w: img.w, h: img.h });
    }
  }
  // şablonda çerçeve kalmadıysa artan fotoğraflar serbest olarak eklensin
  let s = 0;
  for (const id of assets) {
    const img = dims(images.get(id));
    const sc = Math.min(W * 0.84 / img.w, H * 0.84 / img.h);
    const el = frame((s % P.slides + 0.5) * W - img.w * sc / 2, H / 2 - img.h * sc / 2, img.w * sc, img.h * sc);
    fillFrame(el, { id, w: img.w, h: img.h });
    extra.push(el); s++;
  }
  P.elements = [...r.elements, ...extra];
  if (r.background) P.background = r.background;
  P.bg2 = null;
  const ctx = $('#stage').getContext('2d');
  for (const e of P.elements) if (e.type === 'text') layoutText(ctx, e);
  stage.select(null);
  stage.render();
  commit();
}

document.querySelectorAll('#toolbar button').forEach(b => b.addEventListener('click', () => {
  const t = b.dataset.tool;
  if (t === 'photo') { pendingFrame = null; $('#filePhoto').click(); }
  else if (t === 'text') addText();
  else if (t === 'note') addNote();
  else if (t === 'frame') addFrame();
  else if (t === 'shape') shapeSheet();
  else if (t === 'bg') bgSheet();
  else if (t === 'slides') slidesSheet();
  else if (t === 'template') templateSheet();
}));

// ---------------- seçili öğe paneli ----------------
const ICON = {
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  dup: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  crop: '<svg viewBox="0 0 24 24"><path d="M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14"/></svg>',
  img: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/></svg>',
};

function chip(label, onclick, { on = false, icon = null, danger = false } = {}) {
  const b = h('button', { class: 'chip' + (on ? ' on' : '') + (danger ? ' danger' : ''), onclick });
  if (icon) b.insertAdjacentHTML('beforeend', ICON[icon]);
  b.append(label);
  return b;
}

let panelFor = null;
function buildPanel(soft) {
  const panel = $('#panel');
  const el = stage.selected();
  $('#cropBanner').hidden = !stage.crop;
  if (!el) { panel.hidden = true; $('#toolbar').hidden = false; panelFor = null; return; }
  // yazarken paneli yeniden kurma (imleç kaybolmasın)
  if (soft && panelFor === el.id + ':' + stage.crop && panel.contains(document.activeElement)) return;
  panelFor = el.id + ':' + stage.crop;
  panel.hidden = false;
  $('#toolbar').hidden = true;
  panel.innerHTML = '';
  const live = () => stage.render();

  const common = h('div', { class: 'prow' },
    chip('Kapat', () => stage.select(null)),
    chip('Öne', () => { reorder(el, 1); }, { icon: 'up' }),
    chip('Arkaya', () => { reorder(el, -1); }, { icon: 'down' }),
    chip('Kopyala', () => duplicate(el), { icon: 'dup' }),
    chip('Sil', () => remove(el), { icon: 'del', danger: true }));

  if (el.type === 'image') {
    const r1 = h('div', { class: 'prow' });
    if (el.assetId) {
      r1.append(chip(stage.crop ? 'Kırpmayı bitir' : 'Kırp / konumla', () => stage.setCrop(!stage.crop), { on: stage.crop, icon: 'crop' }));
      r1.append(chip('Değiştir', () => { replaceTarget = el.id; $('#fileReplace').click(); }, { icon: 'img' }));
      if (isVideo(images.get(el.assetId))) {
        r1.append(chip(el.sound === false ? 'Ses: kapalı' : 'Ses: açık', () => { el.sound = el.sound === false; commit(); buildPanel(); }, { on: el.sound !== false }));
      }
      r1.append(chip('Ortala', () => { fillFrame(el, { id: el.assetId, w: el.iw, h: el.ih }); stage.render(); commit(); }));
      r1.append(chip('Boşalt', () => { el.assetId = null; stage.setCrop(false); stage.render(); commit(); buildPanel(); }));
    } else {
      r1.append(chip('Fotoğraf koy', () => { pendingFrame = el.id; $('#filePhoto').click(); }, { icon: 'img', on: true }));
    }
    panel.append(r1);
    if (el.assetId) {
      const fr = h('div', { class: 'prow' });
      for (const [n, f] of FILTERS) fr.append(chip(n, () => { el.filter = f; stage.render(); commit(); buildPanel(); }, { on: (el.filter || 'none') === f }));
      panel.append(fr);
    }
    panel.append(h('div', { class: 'prow' },
      slider('Köşe', 0, 100, 1, el.radius || 0, v => { el.radius = v; live(); }, commit),
      slider('Kenarlık', 0, 80, 1, el.stroke || 0, v => { el.stroke = v; live(); }, commit)));
    panel.append(h('div', { class: 'prow' },
      chip('Gölge', () => { el.shadow = !el.shadow; stage.render(); commit(); buildPanel(); }, { on: !!el.shadow }),
      slider('Saydamlık', 0.05, 1, 0.01, el.opacity ?? 1, v => { el.opacity = v; live(); }, commit)));
    if (el.stroke > 0 || el.shadow) {
      panel.append(h('div', { class: 'prow' }, h('span', { class: 'slider', style: 'flex:none;min-width:0' }, 'Kenarlık rengi'),
        swatchRow(el.strokeColor, c => { el.strokeColor = c; live(); commit(); }, { onLive: c => { el.strokeColor = c; live(); } })));
    }
  }

  if (el.type === 'text') {
    const ta = h('textarea', { class: 'text-edit', rows: 2 });
    ta.value = el.text;
    ta.addEventListener('input', () => { el.text = ta.value; live(); });
    ta.addEventListener('change', commit);
    ta.addEventListener('blur', commit);
    panel.append(ta);
    const fsel = h('select', { class: 'chip' });
    for (const f of FONTS) fsel.append(h('option', { value: f.name, selected: f.name === el.font }, f.name));
    fsel.addEventListener('change', async () => {
      const f = FONTS.find(x => x.name === fsel.value);
      const wasBold = el.weight >= 700;
      el.font = f.name; el.weight = wasBold ? f.bold : f.reg;
      await ensureFonts(P); live(); commit();
    });
    const fdef = FONTS.find(x => x.name === el.font) || FONTS[0];
    const aligns = { left: 'Sola', center: 'Ortala', right: 'Sağa' };
    panel.append(h('div', { class: 'prow' }, fsel,
      chip('Kalın', async () => { el.weight = el.weight >= 700 ? fdef.reg : fdef.bold; await ensureFonts(P); live(); commit(); buildPanel(); }, { on: el.weight >= 700 }),
      chip('İtalik', async () => { el.italic = !el.italic; await ensureFonts(P); live(); commit(); buildPanel(); }, { on: !!el.italic }),
      ...Object.entries(aligns).map(([k, n]) => chip(n, () => { el.align = k; live(); commit(); buildPanel(); }, { on: el.align === k }))));
    panel.append(h('div', { class: 'prow' }, swatchRow(el.color, c => { el.color = c; live(); commit(); }, { onLive: c => { el.color = c; live(); } })));
    panel.append(h('div', { class: 'prow' },
      slider('Boyut', 12, 600, 1, el.size, v => { const cy = el.y + el.h / 2; el.size = v; layoutText(stage.ctx, el); el.y = cy - el.h / 2; live(); }, commit),
      slider('Satır', 0.7, 2, 0.01, el.lineHeight || 1.15, v => { el.lineHeight = v; live(); }, commit)));
    panel.append(h('div', { class: 'prow' },
      slider('Saydamlık', 0.05, 1, 0.01, el.opacity ?? 1, v => { el.opacity = v; live(); }, commit)));
  }

  if (el.type === 'note') {
    const ta = h('textarea', { class: 'text-edit', rows: 3 });
    ta.value = el.text;
    ta.addEventListener('input', () => { el.text = ta.value; el.h = 10; live(); });
    ta.addEventListener('change', commit);
    ta.addEventListener('blur', commit);
    panel.append(ta);
    const cr = h('div', { class: 'swatches' });
    for (const c of NOTE_COLORS) cr.append(h('button', { class: 'sw' + (c === el.fill ? ' on' : ''), style: `background:${c}`, 'aria-label': c,
      onclick: () => { el.fill = c; el.color = c === '#2b2b33' ? '#ffffff' : '#1a1a1a'; live(); commit(); buildPanel(); } }));
    panel.append(h('div', { class: 'prow' }, cr));
    panel.append(h('div', { class: 'prow' },
      slider('Yazı', 16, 160, 1, el.size, v => { el.size = v; el.h = 10; live(); }, commit),
      slider('Saydamlık', 0.1, 1, 0.01, el.opacity ?? 1, v => { el.opacity = v; live(); }, commit)));
  }

  if (el.type === 'shape') {
    panel.append(h('div', { class: 'prow' }, swatchRow(el.fill, c => { el.fill = c; live(); commit(); }, { onLive: c => { el.fill = c; live(); } })));
    const r = h('div', { class: 'prow' });
    if (el.kind !== 'ellipse') r.append(slider('Köşe', 0, 100, 1, el.radius || 0, v => { el.radius = v; live(); }, commit));
    r.append(slider('Saydamlık', 0.05, 1, 0.01, el.opacity ?? 1, v => { el.opacity = v; live(); }, commit));
    panel.append(r);
    panel.append(h('div', { class: 'prow' }, chip('Gölge', () => { el.shadow = !el.shadow; stage.render(); commit(); buildPanel(); }, { on: !!el.shadow })));
  }

  panel.append(common);
}

function reorder(el, d) {
  const a = P.elements, i = a.indexOf(el), j = Math.max(0, Math.min(a.length - 1, i + d));
  if (i === j) return;
  a.splice(i, 1); a.splice(j, 0, el);
  stage.render(); commit();
  toast(d > 0 ? 'Bir kat öne alındı' : 'Bir kat arkaya alındı', 1000);
}
function duplicate(el) {
  const c = JSON.parse(JSON.stringify(el));
  c.id = uid(); c.x += 40; c.y += 40;
  P.elements.splice(P.elements.indexOf(el) + 1, 0, c);
  stage.select(c.id); stage.render(); commit();
}
function remove(el) {
  P.elements = P.elements.filter(e => e !== el);
  stage.select(null); stage.render(); commit();
}

// ---------------- önizleme ----------------
let previewUrls = [];
let previewVideoSlides = [];
let previewRaf = 0;
async function openPreview(mode = 'post') {
  previewVideoSlides = videoSlides(P, images);
  $('#previewBody').innerHTML = '<p class="grid-note" style="text-align:center;margin-top:30vh">Hazırlanıyor…</p>';
  $('#preview').hidden = false;
  await ensureFonts(P);
  previewUrls.forEach(u => URL.revokeObjectURL(u));
  previewUrls = [];
  for (let i = 0; i < P.slides; i++) previewUrls.push(URL.createObjectURL(await canvasToBlob(renderSlide(P, images, i, 0.5), 'image/jpeg', 0.85)));
  $('#preview').hidden = false;
  showPreviewMode(mode);
}
function showPreviewMode(mode) {
  document.querySelectorAll('#previewSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  const body = $('#previewBody');
  body.innerHTML = '';
  const n = P.slides;
  if (mode === 'post') {
    // video içeren slaytlar önizlemede canlı çizilir
    const live = [];
    const car = h('div', { class: 'ig-car' }, ...previewUrls.map((u, i) => {
      if (!previewVideoSlides.includes(i)) return h('img', { src: u, alt: '' });
      const { w: W, h: H } = slideSize(P);
      const c = h('canvas', { width: Math.round(W / 2), height: Math.round(H / 2) });
      live.push({ c, i });
      return c;
    }));
    cancelAnimationFrame(previewRaf);
    if (live.length) {
      const loop = () => {
        if ($('#preview').hidden) return;
        for (const { c, i } of live) {
          const x = c.getContext('2d');
          x.setTransform(0.5, 0, 0, 0.5, 0, 0);
          x.translate(-i * slideSize(P).w, 0);
          drawProject(x, P, images, {});
        }
        previewRaf = requestAnimationFrame(loop);
      };
      loop();
    }
    const counter = h('span', {}, `1/${n}`);
    const dots = h('div', { class: 'ig-dots' }, ...previewUrls.map((_, i) => h('i', { class: i === 0 ? 'on' : '' })));
    car.addEventListener('scroll', () => {
      const i = Math.round(car.scrollLeft / car.clientWidth);
      counter.textContent = `${i + 1}/${n}`;
      [...dots.children].forEach((d, j) => d.classList.toggle('on', j === i));
    }, { passive: true });
    body.append(h('div', { class: 'ig-post' },
      h('div', { class: 'ig-top' }, h('div', { class: 'ig-av' }), 'hesabiniz'),
      h('div', { class: 'ig-counter' }, car, n > 1 ? counter : null),
      n > 1 ? dots : null,
      h('div', { class: 'ig-actions', html: '<svg viewBox="0 0 24 24"><path d="M12 21s-8-5.3-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 5.7-8 11-8 11z"/></svg><svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 01-12 7l-5 1 1-5a8 8 0 1116-3z"/></svg><svg viewBox="0 0 24 24"><path d="M22 3L11 13M22 3l-7 19-4-9-9-4z"/></svg>' })));
  } else {
    const grid = h('div', { class: 'ig-grid' });
    grid.append(h('div', { class: 'first' }, h('img', { src: previewUrls[0], alt: '' })));
    for (let i = 0; i < 8; i++) grid.append(h('div'));
    body.append(h('div', {}, grid, h('p', { class: 'grid-note' }, 'Profil ızgarasında yalnızca ilk slayt görünür ve 3:4 oranında ortadan kırpılır. Kapak slaytındaki önemli yazıları kenarlara yakın koyma.')));
  }
}
document.querySelectorAll('#previewSeg button').forEach(b => b.addEventListener('click', () => showPreviewMode(b.dataset.mode)));
$('#btnClosePreview').addEventListener('click', () => { $('#preview').hidden = true; });
$('#btnPreview').addEventListener('click', () => openPreview());

// ---------------- dışa aktarma ----------------
function slug(s) {
  const tr = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u' };
  return (s || 'carousel').replace(/[çğıöşüÇĞİÖŞÜ]/g, c => tr[c]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'carousel';
}
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function exportBoard() {
  await saveNow();
  openSheet(async body => {
    body.append(h('h3', {}, 'Panoyu görsel olarak kaydet'));
    const info = h('p', { class: 'note' }, 'Hazırlanıyor…');
    const prev = h('div', { class: 'board-export' });
    const actions = h('div', { class: 'big-actions' });
    body.append(prev, info, actions);
    await ensureFonts(P);
    if (!P.elements.length) { info.textContent = 'Pano boş.'; return; }
    const c = renderBoard(P, images, 4000, 4000);
    const blob = await canvasToBlob(c, 'image/png');
    const name = `${slug(P.name)}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    prev.append(h('img', { src: URL.createObjectURL(blob), alt: 'Pano' }));
    info.textContent = `${c.width}×${c.height} px · ${(blob.size / 1048576).toFixed(1)} MB PNG. Panonun tamamı tek görsel olarak kaydedilir.`;
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
      actions.append(h('button', { class: 'btn primary', onclick: () => navigator.share({ files: [file] }).catch(() => {}) }, 'Paylaş / Fotoğraflar\'a kaydet'));
    }
    actions.append(h('button', { class: 'btn' + (actions.children.length ? '' : ' primary'), onclick: () => download(file, name) }, 'İndir'));
  });
}

async function exportSheet() {
  if (P.kind === 'board') return exportBoard();
  unlockAudio(); // iOS: ses kaydı için kullanıcının dokunuşu anında açılmalı
  await saveNow();
  let fmt = 'jpg';
  let busy = false;
  openSheet(async body => {
    body.append(h('h3', {}, 'Dışa aktar'));
    const fmtRow = h('div', { class: 'prow' });
    const thumbs = h('div', { class: 'export-thumbs' });
    const actions = h('div', { class: 'big-actions' });
    const info = h('p', { class: 'note' });
    const vnote = h('p', { class: 'note' });
    body.append(fmtRow, h('h4', {}, 'Slaytlar'), thumbs, info, vnote, actions,
      h('p', { class: 'note' }, 'Instagram\'da yeni gönderi → birden fazla seç → dosyaları 1\'den başlayarak sırayla işaretle.'));
    let files = [];
    const vSlides = videoSlides(P, images);
    const mime = vSlides.length ? pickMime() : null;
    const build = async () => {
      if (busy) return;
      busy = true;
      thumbs.innerHTML = ''; actions.innerHTML = ''; info.textContent = 'Hazırlanıyor…'; vnote.textContent = '';
      fmtRow.innerHTML = '';
      fmtRow.append(chip('JPG (önerilen)', () => { fmt = 'jpg'; build(); }, { on: fmt === 'jpg' }), chip('PNG', () => { fmt = 'png'; build(); }, { on: fmt === 'png' }));
      await ensureFonts(P);
      const { w: W, h: H } = slideSize(P);
      files = [];
      const base = slug(P.name);
      const slots = [];
      for (let i = 0; i < P.slides; i++) { const a = h('div', { class: 'slot' }); thumbs.append(a); slots.push(a); }
      const put = (i, blob, ext) => {
        const name = `${base}-${String(i + 1).padStart(2, '0')}.${ext}`;
        files[i] = new File([blob], name, { type: blob.type });
        const url = URL.createObjectURL(blob);
        const a = slots[i];
        a.innerHTML = '';
        a.append(blob.type.startsWith('video/')
          ? h('video', { src: url, muted: true, autoplay: true, loop: true, playsinline: true })
          : h('img', { src: url, alt: `${i + 1}. slayt` }));
        // her slaytın kendi indirme düğmesi (tıklama anında indirir, tarayıcı engellemez)
        a.append(h('button', { class: 'btn small slot-dl', onclick: () => download(files[i], name) }, `${i + 1} · İndir`));
      };
      // önce fotoğraf slaytları (anında)
      for (let i = 0; i < P.slides; i++) {
        if (vSlides.includes(i) && mime) { slots[i].append(h('div', { class: 'slot-wait' }, 'Video bekliyor')); continue; }
        put(i, await canvasToBlob(renderSlide(P, images, i, 1), fmt === 'png' ? 'image/png' : 'image/jpeg', 0.95), fmt);
      }
      // sonra video slaytları (gerçek zamanlı kayıt)
      if (vSlides.length && !mime) vnote.textContent = 'Bu tarayıcı video kaydedemiyor; video slaytları fotoğraf olarak çıktı. Chrome veya Safari\'nin güncel sürümünü kullan.';
      if (vSlides.length && mime) {
        const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
        const secs = Math.round(Math.max(...videoElements(P, images).map(e => videoLength(images.get(e.assetId)))));
        for (const [k, i] of vSlides.entries()) {
          info.textContent = `Video kaydediliyor: ${k + 1}/${vSlides.length} (slayt ${i + 1}, ~${secs} sn). Bu sırada ekranı kapatma, sekmeyi değiştirme.`;
          const bar = h('div', { class: 'slot-wait' }, '0%');
          slots[i].innerHTML = ''; slots[i].append(bar);
          let blob;
          try {
            blob = await recordSlide(P, images, i, { mime, withSound: true, onProgress: f => { bar.textContent = Math.round(f * 100) + '%'; } });
          } catch (err) {
            info.textContent = err.message === 'hidden'
              ? 'Video kaydı yarıda kaldı: kayıt sırasında ekran kapandı veya başka uygulamaya geçildi. Ekran açıkken tekrar dene.'
              : 'Video kaydedilemedi: ' + err.message;
            actions.innerHTML = '';
            actions.append(h('button', { class: 'btn primary', onclick: () => { unlockAudio(); build(); } }, 'Tekrar dene'));
            busy = false;
            return;
          }
          put(i, blob, ext);
        }
        if (ext === 'webm') vnote.textContent = 'Uyarı: bu tarayıcı yalnızca WebM üretebildi; Instagram WebM kabul etmeyebilir. En iyi sonuç için Safari (Mac/iPhone) veya güncel Chrome kullan.';
      }
      const mb = files.reduce((s, f) => s + f.size, 0) / 1048576;
      const nv = files.filter(f => f.type.startsWith('video/')).length;
      info.textContent = `${files.length} dosya${nv ? ` (${nv} video)` : ''} · ${W}×${H} px · ${mb.toFixed(1)} MB.`;
      const touch = matchMedia('(pointer: coarse)').matches;
      const canShare = navigator.canShare && navigator.canShare({ files });
      const btn = (label, fn) => h('button', { class: 'btn' + (actions.children.length ? '' : ' primary'), onclick: fn }, label);
      const share = async () => {
        try { await navigator.share({ files }); } catch (e) { if (e.name !== 'AbortError') toast('Paylaşım açılamadı: ' + e.message); }
      };
      // telefonda: paylaş menüsü (Fotoğraflar'a kaydet / Instagram)
      if (touch && canShare) actions.append(btn('Paylaş / Fotoğraflar\'a kaydet', share));
      // bilgisayarda (Chrome/Edge): bir klasör seç, tüm slaytlar tek tek dosya olarak yazılsın
      if (window.showDirectoryPicker) {
        actions.append(btn('Klasöre kaydet (ayrı ayrı dosyalar)', async () => {
          let dir;
          try { dir = await window.showDirectoryPicker({ id: 'kaydir', mode: 'readwrite', startIn: 'downloads' }); }
          catch (e) { if (e.name !== 'AbortError') toast('Klasör açılamadı: ' + e.message); return; }
          try {
            for (const f of files) {
              const fh = await dir.getFileHandle(f.name, { create: true });
              const w = await fh.createWritable();
              await w.write(f); await w.close();
            }
            toast(`${files.length} dosya "${dir.name}" klasörüne kaydedildi`, 3500);
          } catch (e) { toast('Kaydedilemedi: ' + e.message, 4000); }
        }));
      }
      actions.append(btn('Tek tek indir', async () => {
        for (const f of files) { download(f, f.name); await new Promise(r => setTimeout(r, 600)); }
        toast('Yalnızca biri indiyse: tarayıcı "birden fazla dosya" izni istiyor, adres çubuğundan İzin ver\'e bas', 6000);
      }));
      actions.append(btn('Hepsini ZIP olarak indir', async () => {
        download(await makeZip(files.map(f => ({ name: f.name, blob: f }))), `${base}.zip`);
      }));
      if (!touch && canShare) actions.append(h('button', { class: 'btn ghost', onclick: share }, 'Paylaş…'));
      busy = false;
    };
    build();
  });
}
$('#btnExport').addEventListener('click', exportSheet);

// ---------------- üst çubuk ve kısayollar ----------------
$('#btnBack').addEventListener('click', showHome);
$('#btnUndo').addEventListener('click', undo);
$('#btnRedo').addEventListener('click', redo);
$('#btnFit').addEventListener('click', () => stage.fit());
$('#btnZoomIn').addEventListener('click', () => stage.zoomBy(1.25));
$('#btnZoomOut').addEventListener('click', () => stage.zoomBy(0.8));
$('#btnCropDone').addEventListener('click', () => stage.setCrop(false));
$('#btnNew').addEventListener('click', newProjectSheet);
$('#btnNew2').addEventListener('click', newProjectSheet);
$('#btnNewBoard').addEventListener('click', createBoard);

window.addEventListener('keydown', e => {
  if (!P || $('#editor').hidden) return;
  if (e.target instanceof Element && e.target.matches('input, textarea, select')) { if (e.key === 'Escape') e.target.blur(); return; }
  const mod = e.metaKey || e.ctrlKey;
  const el = stage.selected();
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 'd' && el) { e.preventDefault(); duplicate(el); return; }
  if (e.key === 'Escape') { if (stage.crop) stage.setCrop(false); else if (!$('#sheet').hidden) closeSheet(); else stage.select(null); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && el) { e.preventDefault(); remove(el); return; }
  if (e.key === 'Enter' && el?.type === 'image' && el.assetId) { stage.setCrop(!stage.crop); return; }
  if (!el && stage.isSingle && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    stage.focusSlide(stage.cur + (e.key === 'ArrowRight' ? 1 : -1)); return;
  }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[e.key] && el) {
    e.preventDefault();
    const st = e.shiftKey ? 20 : 2;
    el.x += arrows[e.key][0] * st; el.y += arrows[e.key][1] * st;
    stage.render(); commitSoon();
  }
});
let commitT = 0;
function commitSoon() { clearTimeout(commitT); commitT = setTimeout(commit, 400); }

window.addEventListener('pagehide', () => { if (P) saveNow(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && P) saveNow(); });

// ---------------- ana ekrana yükleme rehberi ----------------
(function installGuide() {
  const ua = navigator.userAgent;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) { $('#installHelp').hidden = true; return; } // zaten uygulama olarak açılmış
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // Uygulama içi tarayıcı: adı bilinenler + iPhone'da "Safari/" imzası olmayan her gömülü tarayıcı
  // (gerçek Safari/Chrome/Firefox iOS'ta hep "Safari/" içerir) + Android WebView ("; wv)")
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Line\/|TikTok|musical_ly|BytedanceWebview|Snapchat|Twitter|LinkedInApp|Pinterest|WhatsApp/i.test(ua)
    || (ios && !/Safari\//.test(ua))
    || /; wv\)/.test(ua);
  $('#inAppWarn').hidden = !inApp;
  if (inApp) {
    // sayfanın en üstünde uyarı + gerçek tarayıcıda açma düğmesi
    $('#inAppTop').hidden = false;
    const url = location.href.split('#')[0];
    const bare = url.replace(/^https?:\/\//, '');
    const b = $('#btnOpenBrowser');
    if (ios) b.href = 'x-safari-https://' + bare; // iOS 17+: Safari'yi açar
    else if (/Android/i.test(ua)) { b.href = `intent://${bare}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`; b.textContent = "Chrome'da aç"; }
    else b.hidden = true;
    $('#inAppManual').innerHTML = ios
      ? 'Düğme çalışmazsa: sağ üstteki <span class="k">•••</span> → <span class="k">Safari\'de aç</span>'
      : 'Düğme çalışmazsa: sağ üstteki <span class="k">⋮</span> → <span class="k">Tarayıcıda aç</span>';
  }
  const os = ios ? 'ios' : /Android/i.test(ua) ? 'android' : 'mac';
  const mine = document.querySelector(`.install-os[data-os="${os}"]`);
  if (mine) {
    mine.open = true;
    const sum = mine.querySelector('summary');
    sum.replaceChildren(h('span', {}, sum.textContent, h('span', { class: 'mine-tag' }, 'Senin cihazın')));
    mine.parentNode.insertBefore(mine, document.querySelector('.install-os')); // en üste al
  }
  // Android / bilgisayar Chrome: tek dokunuşla yükleme
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    $('#btnInstall').hidden = false;
  });
  $('#btnInstall').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    $('#btnInstall').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('#btnInstall').hidden = true; toast('Uygulama yüklendi 🎉'); });
})();

// ---------------- başlat ----------------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
showHome();

// Hata ayıklama için konsoldan erişim
window.kaydir = { stage, get project() { return P; } };
