// Hazır yerleşimler. Her şablon slayt sayısına ve orana göre yeniden üretilir,
// yani 3 slaytlık da 10 slaytlık da aynı şablon düzgün görünür.

import { uid } from './store.js';

export function frame(x, y, w, h, extra = {}) {
  return { id: uid(), type: 'image', x, y, w, h, rot: 0, assetId: null, iw: w, ih: h, cx: 0, cy: 0,
    radius: 0, stroke: 0, strokeColor: '#ffffff', shadow: false, opacity: 1, filter: 'none', ...extra };
}

export function text(x, y, w, str, extra = {}) {
  return { id: uid(), type: 'text', x, y, w, h: 100, rot: 0, text: str, font: 'Inter', size: 80, weight: 800,
    italic: false, color: '#111111', align: 'left', lineHeight: 1.1, opacity: 1, ...extra };
}

export function shape(x, y, w, h, extra = {}) {
  return { id: uid(), type: 'shape', kind: 'rect', x, y, w, h, rot: 0, fill: '#111111', radius: 0, opacity: 1, ...extra };
}

export const TEMPLATES = [
  { id: 'blank', name: 'Boş', make: () => ({ elements: [] }) },

  { id: 'panorama', name: 'Panorama', make: (n, W, H) => ({ elements: [frame(0, 0, n * W, H)] }) },

  { id: 'across', name: 'Sınırı aşan', make: (n, W, H) => {
    const els = [];
    if (n === 1) return { elements: [frame(W * 0.1, H * 0.1, W * 0.8, H * 0.8)] };
    const w = W * 0.78, h = H * 0.56;
    const yOf = k => (k % 2 ? H * 0.09 : H - h - H * 0.09);
    els.push(frame(W * 0.08, yOf(0), W * 0.5, h));
    // her slayt sınırının tam üstüne oturan çerçeve: kaydırınca ikiye bölünür
    for (let k = 1; k < n; k++) els.push(frame(k * W - w / 2, yOf(k), w, h));
    els.push(frame((n - 1) * W + W * 0.42, yOf(n), W * 0.5, h));
    return { elements: els, background: '#f4f1ec' };
  } },

  { id: 'collage', name: 'Kaydırmalı kolaj', make: (n, W, H) => {
    const m = 60, g = 30, rowH = (H - 2 * m - g) / 2;
    const els = [];
    for (let i = 0; i < n; i++) els.push(frame(i * W + m, m, W - 2 * m, rowH));
    // alt sıra yarım slayt kaydırılmış: kesintisiz akış hissi
    els.push(frame(m, m + rowH + g, W / 2 - m - g / 2, rowH));
    for (let i = 0; i < n - 1; i++) els.push(frame(i * W + W / 2 + g / 2, m + rowH + g, W - g, rowH));
    els.push(frame((n - 1) * W + W / 2 + g / 2, m + rowH + g, W / 2 - m - g / 2, rowH));
    return { elements: els, background: '#ffffff' };
  } },

  { id: 'cover', name: 'Kapak + galeri', make: (n, W, H) => {
    const els = [frame(0, 0, W, H)];
    els.push(shape(0, H * 0.62, W, H * 0.38, { fill: '#000000', opacity: 0.35 }));
    els.push(text(70, H * 0.68, W - 140, 'Başlığını\nburaya yaz', { color: '#ffffff', size: 110, font: 'Playfair Display', weight: 800 }));
    const m = 60, g = 20, cw = (W - 2 * m - g) / 2, ch = (H - 2 * m - g) / 2;
    for (let i = 1; i < n; i++) {
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) els.push(frame(i * W + m + c * (cw + g), m + r * (ch + g), cw, ch));
    }
    return { elements: els, background: '#ffffff' };
  } },

  { id: 'scatter', name: 'Dağınık polaroid', make: (n, W, H) => {
    const els = [];
    const count = Math.max(1, 2 * n - 1);
    const fw = W * 0.56, fh = fw * 1.18;
    for (let j = 0; j < count; j++) {
      const cx = (j + 1) * W / 2, cy = j % 2 ? H * 0.60 : H * 0.40;
      const rot = [-0.08, 0.06, -0.03, 0.09, -0.06][j % 5];
      els.push(frame(cx - fw / 2, cy - fh / 2, fw, fh, { rot, stroke: 26, strokeColor: '#ffffff', shadow: true }));
    }
    return { elements: els, background: '#e9e2d6' };
  } },

  { id: 'gallery', name: 'Galeri + yazı', make: (n, W, H) => {
    const els = [];
    for (let i = 0; i < n; i++) {
      els.push(frame(i * W + 80, 80, W - 160, H - 330, { radius: 6 }));
      els.push(text(i * W + 80, H - 210, W - 160, `0${i + 1} — Açıklama`.slice(-20), { size: 54, weight: 600, font: 'Montserrat' }));
    }
    return { elements: els, background: '#ffffff' };
  } },

  { id: 'bigtype', name: 'Dev başlık', make: (n, W, H) => {
    const els = [];
    els.push(frame(n * W * 0.5 - W * 0.45, H * 0.52, W * 0.9, H * 0.4, { radius: 4 }));
    els.push(text(W * 0.08, H * 0.06, n * W - W * 0.16, 'KAYDIRMAYA DEVAM →', { font: 'Bebas Neue', weight: 400, size: H * 0.3, color: '#ffffff', lineHeight: 0.95 }));
    return { elements: els, background: '#16161b' };
  } },
];

export function applyTemplate(tpl, n, W, H) {
  const r = tpl.make(n, W, H);
  return { elements: r.elements, background: r.background };
}
