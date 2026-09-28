// Çizim çekirdeği: editör ekranı ve dışa aktarma AYNI fonksiyonu kullanır,
// böylece ekranda görülen ile dışa aktarılan birebir aynıdır.

export const RATIOS = {
  '4:5': { w: 1080, h: 1350, label: 'Dikey 4:5' },
  '1:1': { w: 1080, h: 1080, label: 'Kare 1:1' },
  '3:4': { w: 1080, h: 1440, label: 'Dikey 3:4' },
  '9:16': { w: 1080, h: 1920, label: 'Hikâye 9:16' },
};

export const FONTS = [
  { name: 'Inter', reg: 400, bold: 800 },
  { name: 'Montserrat', reg: 400, bold: 900 },
  { name: 'Playfair Display', reg: 500, bold: 800 },
  { name: 'DM Serif Display', reg: 400, bold: 400 },
  { name: 'Bebas Neue', reg: 400, bold: 400 },
  { name: 'Caveat', reg: 500, bold: 700 },
  { name: 'Space Mono', reg: 400, bold: 700 },
];

export function slideSize(p) { return RATIOS[p.ratio] || RATIOS['4:5']; }

export function fontString(el) {
  return `${el.italic ? 'italic ' : ''}${el.weight || 400} ${el.size}px "${el.font}"`;
}

// Metni kutu genişliğine göre satırlara böler, el.h'yi günceller.
export function layoutText(ctx, el) {
  ctx.font = fontString(el);
  const lines = [];
  const paras = String(el.text ?? '').split('\n');
  for (const para of paras) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (line && ctx.measureText(test.trimEnd()).width > el.w) {
        lines.push(line.trimEnd());
        line = w.trimStart();
      } else line = test;
    }
    lines.push(line.trimEnd());
  }
  const lh = el.size * (el.lineHeight || 1.15);
  el.h = Math.max(lh, lines.length * lh);
  return { lines, lh };
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shapePath(ctx, el) {
  const { w, h } = el;
  if (el.type === 'shape' && el.kind === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else {
    // radius yüzde olarak: kısa kenarın yarısına göre 0..100
    const r = (Math.min(w, h) / 2) * ((el.radius || 0) / 100);
    roundRect(ctx, -w / 2, -h / 2, w, h, r);
  }
}

export function drawElement(ctx, el, images, opts = {}) {
  ctx.save();
  ctx.translate(el.x + el.w / 2, el.y + el.h / 2);
  if (el.rot) ctx.rotate(el.rot);
  ctx.globalAlpha = el.opacity ?? 1;

  if (el.type === 'text') {
    const { lines, lh } = layoutText(ctx, el);
    // layoutText h'yi değiştirmiş olabilir; merkezi yeni h'ye göre düzelt
    ctx.restore(); ctx.save();
    ctx.translate(el.x + el.w / 2, el.y + el.h / 2);
    if (el.rot) ctx.rotate(el.rot);
    ctx.globalAlpha = el.opacity ?? 1;
    ctx.font = fontString(el);
    ctx.fillStyle = el.color || '#000';
    ctx.textBaseline = 'middle';
    ctx.textAlign = el.align || 'left';
    const x = el.align === 'center' ? 0 : el.align === 'right' ? el.w / 2 : -el.w / 2;
    let y = -el.h / 2 + lh / 2;
    for (const l of lines) { ctx.fillText(l, x, y); y += lh; }
    ctx.restore();
    return;
  }

  if (el.shadow) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)';
    ctx.shadowBlur = Math.max(el.w, el.h) * 0.04;
    ctx.shadowOffsetY = Math.max(el.w, el.h) * 0.015;
    shapePath(ctx, el);
    ctx.fillStyle = el.type === 'shape' ? el.fill : (el.strokeColor || '#fff');
    ctx.fill();
    ctx.restore();
  }

  if (el.type === 'shape') {
    shapePath(ctx, el);
    ctx.fillStyle = el.fill || '#000';
    ctx.fill();
    ctx.restore();
    return;
  }

  // image / çerçeve
  const img = el.assetId ? images.get(el.assetId) : null;
  ctx.save();
  shapePath(ctx, el);
  ctx.clip();
  if (img) {
    if (el.filter && el.filter !== 'none') ctx.filter = el.filter;
    ctx.drawImage(img, el.cx - el.iw / 2, el.cy - el.ih / 2, el.iw, el.ih);
    ctx.filter = 'none';
  } else if (opts.editing) {
    ctx.fillStyle = '#c9c9d1';
    ctx.fillRect(-el.w / 2, -el.h / 2, el.w, el.h);
    const s = Math.min(el.w, el.h) * 0.12;
    ctx.strokeStyle = '#8a8a96';
    ctx.lineWidth = s * 0.18;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.moveTo(0, -s); ctx.lineTo(0, s);
    ctx.stroke();
  }
  if (el.stroke > 0 && (img || opts.editing)) {
    shapePath(ctx, el);
    ctx.lineWidth = el.stroke * 2;
    ctx.strokeStyle = el.strokeColor || '#fff';
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

// Bütün şeridi çizer. ctx, 1 birim = 1 tasarım pikseli olacak şekilde dönüştürülmüş olmalı.
export function drawProject(ctx, p, images, opts = {}) {
  const { w: W, h: H } = slideSize(p);
  const total = W * p.slides;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, total, H);
  ctx.clip();
  if (p.bg2) {
    const g = ctx.createLinearGradient(0, 0, total, 0);
    g.addColorStop(0, p.background);
    g.addColorStop(1, p.bg2);
    ctx.fillStyle = g;
  } else ctx.fillStyle = p.background || '#fff';
  ctx.fillRect(0, 0, total, H);
  for (const el of p.elements) {
    if (el.hidden) continue;
    drawElement(ctx, el, images, opts);
  }
  ctx.restore();
}

// Tek bir slaytı verilen ölçekte canvas'a çizer.
export function renderSlide(p, images, index, scale = 1) {
  const { w: W, h: H } = slideSize(p);
  const c = document.createElement('canvas');
  c.width = Math.round(W * scale);
  c.height = Math.round(H * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(scale, scale);
  ctx.translate(-index * W, 0);
  drawProject(ctx, p, images, {});
  return c;
}

// Bütün şeridi küçük boyutta çizer (proje kartı küçük resmi için).
export function renderStrip(p, images, height) {
  const { w: W, h: H } = slideSize(p);
  const scale = height / H;
  const c = document.createElement('canvas');
  c.width = Math.round(W * p.slides * scale);
  c.height = Math.round(height);
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  drawProject(ctx, p, images, {});
  ctx.strokeStyle = 'rgba(0,0,0,.25)';
  ctx.lineWidth = 1 / scale;
  for (let i = 1; i < p.slides; i++) { ctx.beginPath(); ctx.moveTo(i * W, 0); ctx.lineTo(i * W, H); ctx.stroke(); }
  return c;
}

export function canvasToBlob(c, type = 'image/jpeg', q = 0.95) {
  return new Promise(res => c.toBlob(res, type, q));
}
