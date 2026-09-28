// Video desteği (sınırlı): proje başına en fazla 2 video, videonun ilk 30 saniyesi kullanılır.
// Video içeren slaytlar tarayıcının kendi kaydedicisiyle (MediaRecorder) MP4 olarak dışa aktarılır.
// Kayıt gerçek zamanlıdır: 10 saniyelik video, slayt başına ~10 saniyede kaydedilir.

import { drawProject, slideSize } from './render.js';

export const MAX_VIDEOS = 2;
export const MAX_SECONDS = 30;
export const MAX_VIDEO_MB = 200;

export const isVideo = d => typeof HTMLVideoElement !== 'undefined' && d instanceof HTMLVideoElement;
export const dims = d => (isVideo(d) ? { w: d.videoWidth, h: d.videoHeight } : { w: d.width, h: d.height });
export const isVideoFile = f => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(f.name);

// iOS Safari görünmeyen (DOM dışı) videoların karelerini bazen çizmez; bu yüzden gizli bir kapta tutulur
let holder = null;
function videoHolder() {
  if (!holder) {
    holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;';
    document.body.append(holder);
  }
  return holder;
}

export async function blobToVideo(blob) {
  const v = document.createElement('video');
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('muted', '');
  v.preload = 'auto';
  v.src = URL.createObjectURL(blob);
  videoHolder().append(v);
  // iOS Safari oynatma başlamadan veri yüklemeyebilir: hemen (sessiz) oynat, yalnızca boyut bilgisini bekle
  v.play().catch(() => {});
  await new Promise((res, rej) => {
    if (v.readyState >= 1) return res();
    const t = setTimeout(() => rej(new Error('Video açılamadı (zaman aşımı)')), 20000);
    v.onloadedmetadata = () => { clearTimeout(t); res(); };
    v.onerror = () => { clearTimeout(t); rej(v.error || new Error('Video açılamadı')); };
  });
  // 30 saniyeden uzunsa başa sar (düzenleme sırasında da yalnızca kullanılacak kısım dönsün)
  v.addEventListener('timeupdate', () => { if (v.currentTime >= MAX_SECONDS) v.currentTime = 0; });
  return v;
}

export function disposeDrawable(d) {
  if (isVideo(d)) { d.pause(); URL.revokeObjectURL(d.src); d.removeAttribute('src'); d.load(); d.remove(); }
  else d.close?.();
}

export function videoLength(v) {
  return Math.min(MAX_SECONDS, Number.isFinite(v.duration) ? v.duration : MAX_SECONDS);
}

// Öğenin (döndürülmüş olabilir) eksen hizalı sınırları hangi slaytlara değiyor
export function slidesTouchedBy(el, W, n) {
  const a = el.rot || 0;
  const hw = (Math.abs(Math.cos(a)) * el.w + Math.abs(Math.sin(a)) * el.h) / 2;
  const cx = el.x + el.w / 2;
  const out = [];
  for (let i = 0; i < n; i++) if (cx + hw > i * W && cx - hw < (i + 1) * W) out.push(i);
  return out;
}

export function videoElements(p, images) {
  return p.elements.filter(e => !e.hidden && e.assetId && isVideo(images.get(e.assetId)));
}

// Video içeren slaytların listesi
export function videoSlides(p, images) {
  const { w: W } = slideSize(p);
  const set = new Set();
  for (const el of videoElements(p, images)) for (const i of slidesTouchedBy(el, W, p.slides)) set.add(i);
  return [...set].sort((a, b) => a - b);
}

export function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const list = [
    'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
    'video/mp4;codecs=avc1', 'video/mp4',
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
  ];
  return list.find(m => MediaRecorder.isTypeSupported(m)) || null;
}

let audioCtx = null;
const audioSources = new WeakMap();

// Dışa aktarma düğmesine basıldığı anda çağrılmalı (iOS ses izni kullanıcı dokunuşu ister)
export function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
  } catch { audioCtx = null; }
}

function audioTrackFor(v) {
  if (!audioCtx) return null;
  try {
    let src = audioSources.get(v);
    if (!src) { src = audioCtx.createMediaElementSource(v); audioSources.set(v, src); }
    const dest = audioCtx.createMediaStreamDestination();
    src.connect(dest);
    return { track: dest.stream.getAudioTracks()[0], done: () => { try { src.disconnect(dest); } catch { /* */ } } };
  } catch { return null; }
}

const seek = (v, t) => new Promise(res => {
  if (Math.abs(v.currentTime - t) < 0.01 && v.readyState >= 2) return res();
  const on = () => { v.removeEventListener('seeked', on); res(); };
  v.addEventListener('seeked', on);
  v.currentTime = t;
});

// Tek bir slaytı, projedeki videolar baştan oynarken gerçek zamanlı kaydeder.
export async function recordSlide(p, images, index, { mime, withSound, onProgress }) {
  const { w: W, h: H } = slideSize(p);
  const vids = videoElements(p, images);
  const players = [...new Set(vids.map(e => images.get(e.assetId)))];
  const duration = Math.max(...players.map(videoLength));

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const draw = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(-index * W, 0);
    drawProject(ctx, p, images, {});
  };

  if (document.hidden) throw new Error('hidden');
  for (const v of players) { v.pause(); await seek(v, 0); }
  draw();

  const stream = c.captureStream(30);
  // ses: sesi açık olan ilk videodan (bu slaytta görünmese bile tüm carousel aynı sesle çıksın)
  let audio = null;
  if (withSound) {
    const soundEl = vids.find(e => e.sound !== false);
    const sv = soundEl && images.get(soundEl.assetId);
    if (sv) { sv.muted = false; audio = audioTrackFor(sv); if (audio?.track) stream.addTrack(audio.track); }
  }

  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10_000_000, audioBitsPerSecond: 160_000 });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise(res => { rec.onstop = res; });

  rec.start(250);
  await Promise.all(players.map(v => v.play().catch(() => {})));
  const t0 = performance.now();
  // Ekran arka plana geçerse tarayıcı kareleri durdurur ve video bozuk çıkar → kaydı iptal et
  let aborted = false;
  const onHide = () => { if (document.hidden) aborted = true; };
  document.addEventListener('visibilitychange', onHide);
  try {
    await new Promise(res => {
      const tick = () => {
        if (aborted) return res();
        draw();
        const t = (performance.now() - t0) / 1000;
        onProgress?.(Math.min(1, t / duration));
        if (t >= duration) return res();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  } finally {
    document.removeEventListener('visibilitychange', onHide);
    rec.stop();
    await stopped;
    stream.getTracks().forEach(t => t.stop());
    audio?.done();
    for (const v of players) { v.muted = true; v.play().catch(() => {}); }
  }
  if (aborted) throw new Error('hidden');
  return new Blob(chunks, { type: mime.split(';')[0] });
}
