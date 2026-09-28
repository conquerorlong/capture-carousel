// Editör tuvali: görünüm (kaydır/yakınlaş), seçim, taşıma, köşeden büyütme,
// kenardan kırpma, döndürme, iki parmakla sıkıştırma ve kırpma modu.

import { drawProject, slideSize, layoutText } from './render.js';

const SEL = '#3d9bff';
const SNAP_PX = 8;

const rotV = (x, y, a) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const clone = o => JSON.parse(JSON.stringify(o));

export class Stage {
  constructor(canvas, hooks) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks; // { onSelect, onChange(commit), onViewChange, onEmptyFrameTap, onDoubleTapText }
    this.p = null;
    this.images = new Map();
    this.view = { s: 0.3, ox: 20, oy: 20 };
    this.sel = null;
    this.crop = false;
    this.pointers = new Map();
    this.g = null; // aktif hareket
    this.guides = [];
    this.lastTap = { t: 0, id: null };
    this.dpr = 1;
    this._raf = 0;
    this.single = true; // tek slayt görünümü (varsayılan)
    this.cur = 0;       // tek slayt görünümünde gösterilen slayt

    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', e => this.up(e));
    canvas.addEventListener('wheel', e => this.wheel(e), { passive: false });
    // iOS Safari'nin kendi sıkıştırma hareketini engelle
    for (const t of ['gesturestart', 'gesturechange']) canvas.addEventListener(t, e => e.preventDefault());

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }

  // ---------- kurulum ----------
  load(project, images) {
    this.p = project;
    this.images = images;
    this.sel = null;
    this.crop = false;
    this.cur = 0;
    this.resize();
    this.fit();
  }

  setSingle(on) {
    this.single = on;
    if (on) this.cur = this.centerSlide();
    this.fit();
  }

  // Tek slayt görünümünde, ekran tam bir slayta oturmuş mu (kullanıcı yakınlaştırmadıysa)
  singleFitScale() {
    const padTop = 52, padBot = 40;
    return Math.min((this.ch - padTop - padBot) / this.H, (this.cw - 96) / this.W);
  }

  resize() {
    const r = this.c.parentElement.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // Yükseklik değişirse (panel açıldı/kapandı) görünümü orantılı ölçekle, ortadaki nokta yerinde kalsın
    if (this.p && this.single && this.cw && (Math.abs(r.width - this.cw) > 1 || Math.abs(r.height - this.ch) > 1)) {
      const zoomed = Math.abs(this.view.s - this.singleFitScale()) > 0.001;
      this.cw = r.width; this.ch = r.height;
      this.setCanvasSize(r);
      if (!zoomed) this.focusSlide(this.cur); else this.render();
      return;
    }
    if (this.p && this.cw && this.ch && (Math.abs(r.width - this.cw) > 1 || Math.abs(r.height - this.ch) > 1)) {
      const v = this.view;
      const tw = this.W * this.p.slides * v.s;
      const wholeVisible = (v.ox >= -1 && v.ox + tw <= this.cw + 1) || tw <= r.width - 40;
      if (wholeVisible) {
        this.cw = r.width; this.ch = r.height;
        this.setCanvasSize(r);
        this.fit();
        return;
      }
      const wx = (this.cw / 2 - v.ox) / v.s, wy = (this.ch / 2 - v.oy) / v.s;
      v.s *= r.height / this.ch;
      v.ox = r.width / 2 - wx * v.s; v.oy = r.height / 2 - wy * v.s;
    }
    this.cw = r.width; this.ch = r.height;
    this.setCanvasSize(r);
    this.render();
  }

  setCanvasSize(r) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.c.width = Math.round(r.width * this.dpr);
    this.c.height = Math.round(r.height * this.dpr);
    this.render();
  }

  get W() { return slideSize(this.p).w; }
  get H() { return slideSize(this.p).h; }

  fit() {
    if (!this.p || !this.cw) return;
    if (this.single) { this.focusSlide(Math.min(this.cur, this.p.slides - 1)); return; }
    const { W, H } = this;
    const n = this.p.slides;
    const padX = 20, padTop = 52, padBot = 40;
    const sH = (this.ch - padTop - padBot) / H;
    let s = Math.min(sH, (this.cw - padX * 2) / (W * n));
    // Şerit çok uzunsa ve slaytlar ufacık kalıyorsa, yüksekliğe göre sığdır ve kaydırmaya izin ver
    // telefonda bir slayt neredeyse tam genişlikte, yanındaki kenardan görünsün
    if (s * W < Math.min(this.cw * 0.42, 260)) s = Math.min(sH, (this.cw - padX * 2) / (W * Math.min(n, window.innerWidth < 600 ? 1.12 : 2.3)));
    this.view.s = s;
    const total = W * n * s;
    this.view.ox = total < this.cw ? (this.cw - total) / 2 : padX;
    this.view.oy = padTop + (this.ch - padTop - padBot - H * s) / 2;
    this.render();
    this.hooks.onViewChange?.();
  }

  zoomBy(k, cx = this.cw / 2, cy = this.ch / 2) {
    const v = this.view;
    const ns = Math.max(0.02, Math.min(4, v.s * k));
    const wx = (cx - v.ox) / v.s, wy = (cy - v.oy) / v.s;
    v.s = ns; v.ox = cx - wx * ns; v.oy = cy - wy * ns;
    this.clampView(); this.render(); this.hooks.onViewChange?.();
  }

  // Tek slaytı ekrana sığdırıp ortalar (slayt numarasına basınca)
  focusSlide(i) {
    const v = this.view;
    const padTop = 52, padBot = 40;
    i = Math.max(0, Math.min(this.p.slides - 1, i));
    this.cur = i;
    v.s = this.singleFitScale();
    v.ox = this.cw / 2 - (i + 0.5) * this.W * v.s;
    v.oy = padTop + (this.ch - padTop - padBot - this.H * v.s) / 2;
    this.clampView(); this.render(); this.hooks.onViewChange?.();
  }

  currentSlide() { return this.single ? this.cur : this.centerSlide(); }

  // Ekranın ortasındaki slayt
  centerSlide() {
    const wx = (this.cw / 2 - this.view.ox) / this.view.s;
    return Math.max(0, Math.min(this.p.slides - 1, Math.floor(wx / this.W)));
  }

  // Görünürde yeni öğe koymak için merkez nokta (dünya koordinatı)
  viewCenter() {
    const i = this.currentSlide();
    return { x: (i + 0.5) * this.W, y: this.H / 2 };
  }

  clampView() {
    const v = this.view;
    const tw = this.W * this.p.slides * v.s, th = this.H * v.s;
    const m = 60;
    v.ox = Math.min(this.cw - m, Math.max(m - tw, v.ox));
    v.oy = Math.min(this.ch - m, Math.max(m - th, v.oy));
  }

  toWorld(sx, sy) { return { x: (sx - this.view.ox) / this.view.s, y: (sy - this.view.oy) / this.view.s }; }
  toScreen(wx, wy) { return { x: wx * this.view.s + this.view.ox, y: wy * this.view.s + this.view.oy }; }

  selected() { return this.p?.elements.find(e => e.id === this.sel) || null; }

  select(id) {
    if (this.sel !== id) this.crop = false;
    this.sel = id;
    this.render();
    this.hooks.onSelect?.(this.selected());
  }

  setCrop(on) {
    const el = this.selected();
    this.crop = !!(on && el && el.type === 'image' && el.assetId);
    this.render();
    this.hooks.onSelect?.(el);
  }

  // ---------- çizim ----------
  render() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); });
  }

  draw() {
    const { ctx, p } = this;
    if (!p) return;
    const { s, ox, oy } = this.view;
    const { W, H } = this;
    const n = p.slides;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);

    // slayt numaraları
    ctx.fillStyle = '#6b6b78';
    ctx.font = '600 12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let i = 0; i < n; i++) ctx.fillText(String(i + 1), ox + (i + 0.5) * W * s, oy - 8);

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    ctx.imageSmoothingQuality = 'medium';
    drawProject(ctx, p, this.images, { editing: true });

    const el = this.selected();
    if (el && this.crop && el.assetId && this.images.get(el.assetId)) {
      // Kırpma modu: çerçeve dışındaki fotoğraf kısmını soluk göster
      ctx.save();
      ctx.translate(el.x + el.w / 2, el.y + el.h / 2);
      ctx.rotate(el.rot || 0);
      ctx.globalAlpha = 0.35;
      ctx.drawImage(this.images.get(el.assetId), el.cx - el.iw / 2, el.cy - el.ih / 2, el.iw, el.ih);
      ctx.restore();
    }
    ctx.restore();

    // slayt ayraçları: her slaytın ayrı bir dikey sayfa olduğu belli olsun
    ctx.save();
    for (let i = 1; i < n; i++) {
      const x = Math.round(ox + i * W * s);
      ctx.fillStyle = '#0b0b0d';
      ctx.fillRect(x - 2, oy - 6, 4, H * s + 12);
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 0.5, oy); ctx.lineTo(x + 0.5, oy + H * s); ctx.stroke();
    }
    ctx.restore();
    // her slaytın altına ölçüsü
    ctx.fillStyle = '#6b6b78';
    ctx.font = '500 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    if (W * s > 70) for (let i = 0; i < n; i++) ctx.fillText(`${W}×${H}`, ox + (i + 0.5) * W * s, oy + H * s + 10);
    ctx.strokeStyle = '#34343d';
    ctx.strokeRect(ox - 0.5, oy - 0.5, W * n * s + 1, H * s + 1);

    // tek slayt görünümü: gösterilen slaytın dışını karart (taşan kısım soluk görünür)
    if (this.single) {
      const x0 = ox + this.cur * W * s, x1 = x0 + W * s;
      ctx.fillStyle = 'rgba(11,11,13,.72)';
      ctx.fillRect(0, 0, x0, this.ch);
      ctx.fillRect(x1, 0, this.cw - x1, this.ch);
      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 - 0.5, oy - 0.5, W * s + 1, H * s + 1);
    }

    // hizalama kılavuzları
    if (this.guides.length) {
      ctx.save();
      ctx.strokeStyle = '#ff4f7b';
      ctx.lineWidth = 1;
      for (const gd of this.guides) {
        ctx.beginPath();
        if (gd.x !== undefined) { const x = ox + gd.x * s; ctx.moveTo(x, oy - 10); ctx.lineTo(x, oy + H * s + 10); }
        else { const y = oy + gd.y * s; ctx.moveTo(ox - 10, y); ctx.lineTo(ox + W * n * s + 10, y); }
        ctx.stroke();
      }
      ctx.restore();
    }

    if (el) this.drawSelection(el);
  }

  // Öğenin (veya kırpma modunda içeriğin) ekran köşeleri ve tutamaçları
  handleGeom(el) {
    const s = this.view.s;
    const c = this.toScreen(el.x + el.w / 2, el.y + el.h / 2);
    let w = el.w * s, h = el.h * s, off = { x: 0, y: 0 };
    if (this.crop) { w = el.iw * s; h = el.ih * s; off = rotV(el.cx * s, el.cy * s, el.rot || 0); }
    const center = { x: c.x + off.x, y: c.y + off.y };
    const a = el.rot || 0;
    const pt = (lx, ly) => { const r = rotV(lx, ly, a); return { x: center.x + r.x, y: center.y + r.y }; };
    const hs = [];
    const corners = { nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1] };
    for (const [k, [sx, sy]] of Object.entries(corners)) hs.push({ k, sx, sy, ...pt(sx * w / 2, sy * h / 2) });
    if (!this.crop) {
      const big = Math.min(w, h) > 70;
      if (el.type === 'text') {
        if (big || w > 70) { hs.push({ k: 'e', sx: 1, sy: 0, ...pt(w / 2, 0) }); hs.push({ k: 'w', sx: -1, sy: 0, ...pt(-w / 2, 0) }); }
      } else if (big) {
        hs.push({ k: 'n', sx: 0, sy: -1, ...pt(0, -h / 2) });
        hs.push({ k: 's', sx: 0, sy: 1, ...pt(0, h / 2) });
        hs.push({ k: 'e', sx: 1, sy: 0, ...pt(w / 2, 0) });
        hs.push({ k: 'w', sx: -1, sy: 0, ...pt(-w / 2, 0) });
      }
      // döndürme tutamacı altta; ekranın dışına taşıyorsa üste al
      let rp = pt(0, h / 2 + 34);
      if (rp.y > this.ch - 14 || rp.y < 14 || rp.x < 14 || rp.x > this.cw - 14) rp = pt(0, -h / 2 - 34);
      hs.push({ k: 'rot', ...rp });
    }
    return { center, w, h, a, pt, hs };
  }

  drawSelection(el) {
    const { ctx } = this;
    const g = this.handleGeom(el);
    ctx.save();
    ctx.strokeStyle = SEL;
    ctx.lineWidth = 1.5;
    if (this.crop) ctx.setLineDash([5, 4]);
    ctx.beginPath();
    const c = ['nw', 'ne', 'se', 'sw'].map(k => g.hs.find(h => h.k === k));
    ctx.moveTo(c[0].x, c[0].y); for (const q of c.slice(1)) ctx.lineTo(q.x, q.y); ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    if (this.crop) {
      // çerçevenin kendisini de düz çizgiyle göster
      const s = this.view.s;
      const cc = this.toScreen(el.x + el.w / 2, el.y + el.h / 2);
      ctx.translate(cc.x, cc.y); ctx.rotate(el.rot || 0);
      ctx.strokeRect(-el.w * s / 2, -el.h * s / 2, el.w * s, el.h * s);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    const rot = g.hs.find(h => h.k === 'rot');
    if (rot) {
      const b1 = g.pt(0, g.h / 2), b2 = g.pt(0, -g.h / 2);
      const bm = dist(b1, rot) < dist(b2, rot) ? b1 : b2;
      ctx.beginPath(); ctx.moveTo(bm.x, bm.y); ctx.lineTo(rot.x, rot.y); ctx.stroke();
    }
    for (const h of g.hs) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      if (h.k === 'rot') {
        ctx.arc(h.x, h.y, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(h.x, h.y, 5, -Math.PI * 0.9, Math.PI * 0.5); ctx.stroke();
      } else if (h.sx && h.sy) {
        ctx.arc(h.x, h.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else {
        ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(g.a + (h.sx ? Math.PI / 2 : 0));
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-9, -3.5, 18, 7, 3.5) : ctx.rect(-9, -3.5, 18, 7);
        ctx.fill(); ctx.stroke(); ctx.restore();
      }
    }
    ctx.restore();
  }

  // ---------- isabet testi ----------
  hitElement(wp) {
    const els = this.p.elements;
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (el.hidden || el.locked) continue;
      const l = rotV(wp.x - (el.x + el.w / 2), wp.y - (el.y + el.h / 2), -(el.rot || 0));
      const pad = 4 / this.view.s;
      if (Math.abs(l.x) <= el.w / 2 + pad && Math.abs(l.y) <= el.h / 2 + pad) return el;
    }
    return null;
  }

  hitHandle(sp, touch) {
    const el = this.selected();
    if (!el) return null;
    const r = touch ? 22 : 12;
    const g = this.handleGeom(el);
    let best = null, bd = r;
    for (const h of g.hs) { const d = dist(sp, h); if (d <= bd) { bd = d; best = h; } }
    return best;
  }

  // ---------- işaretçi olayları ----------
  pt(e) { const r = this.c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  down(e) {
    if (!this.p) return;
    e.preventDefault();
    try { this.c.setPointerCapture(e.pointerId); } catch { /* bazı tarayıcılarda desteklenmez */ }
    const sp = this.pt(e);
    this.pointers.set(e.pointerId, sp);

    if (this.pointers.size === 2) { this.startPinch(); return; }
    if (this.pointers.size > 2) return;

    const wp = this.toWorld(sp.x, sp.y);
    const touch = e.pointerType !== 'mouse';
    const el = this.selected();
    const h = this.hitHandle(sp, touch);

    if (h && el) {
      this.g = { type: h.k === 'rot' ? 'rot' : (h.sx && h.sy ? 'scale' : 'edge'), h, sp0: sp, wp0: wp, el0: clone(el), moved: false };
      return;
    }

    // tek slayt görünümünde soluk yan slaytlardaki öğeler seçilmez; orası kaydırma/geçiş alanıdır
    const outside = this.single && (wp.x < this.cur * this.W || wp.x > (this.cur + 1) * this.W);
    const hit = outside ? null : this.hitElement(wp);

    if (this.crop && el) {
      if (hit && hit.id === el.id || this.insideContent(el, wp)) {
        this.g = { type: 'cropmove', sp0: sp, wp0: wp, el0: clone(el), moved: false };
        return;
      }
      this.setCrop(false);
    }

    if (hit) {
      const now = performance.now();
      const dbl = now - this.lastTap.t < 320 && this.lastTap.id === hit.id;
      this.lastTap = { t: now, id: hit.id };
      const wasSelected = this.sel === hit.id;
      if (!wasSelected) this.select(hit.id);
      this.g = { type: 'move', sp0: sp, wp0: wp, el0: clone(hit), moved: false, wasSelected, dbl };
    } else {
      if (this.sel) this.select(null);
      this.g = { type: 'pan', sp0: sp, v0: { ...this.view }, moved: false };
    }
  }

  insideContent(el, wp) {
    const l = rotV(wp.x - (el.x + el.w / 2), wp.y - (el.y + el.h / 2), -(el.rot || 0));
    return Math.abs(l.x - el.cx) <= el.iw / 2 && Math.abs(l.y - el.cy) <= el.ih / 2;
  }

  startPinch() {
    const [a, b] = [...this.pointers.values()];
    const el = this.selected();
    const onEl = el && this.g && ['move', 'cropmove', 'scale', 'edge', 'rot'].includes(this.g.type);
    // önceki tek parmak hareketinin yaptığı değişikliği koru
    const committedMove = this.g?.moved;
    this.g = {
      type: onEl ? 'pinchEl' : 'pinchView',
      d0: dist(a, b), a0: ang(a, b), m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      el0: el ? clone(el) : null, v0: { ...this.view }, moved: !!committedMove,
    };
  }

  move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const sp = this.pt(e);
    this.pointers.set(e.pointerId, sp);
    const g = this.g;
    if (!g) return;

    if (g.type === 'pinchView' || g.type === 'pinchEl') {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const k = dist(a, b) / g.d0;
      const da = ang(a, b) - g.a0;
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (g.type === 'pinchView') {
        const v = this.view, v0 = g.v0;
        const ns = Math.max(0.02, Math.min(4, v0.s * k));
        const wx = (g.m0.x - v0.ox) / v0.s, wy = (g.m0.y - v0.oy) / v0.s;
        v.s = ns; v.ox = m.x - wx * ns; v.oy = m.y - wy * ns;
        this.clampView();
        this.hooks.onViewChange?.();
      } else {
        const el = this.selected(), e0 = g.el0;
        if (this.crop) {
          this.scaleContent(el, e0, k);
        } else {
          const c0 = { x: e0.x + e0.w / 2, y: e0.y + e0.h / 2 };
          const dm = { x: (m.x - g.m0.x) / this.view.s, y: (m.y - g.m0.y) / this.view.s };
          this.applyScale(el, e0, k);
          el.rot = this.snapAngle((e0.rot || 0) + da);
          el.x = c0.x + dm.x - el.w / 2;
          el.y = c0.y + dm.y - el.h / 2;
        }
        g.moved = true;
      }
      this.render();
      return;
    }

    const dxs = sp.x - g.sp0.x, dys = sp.y - g.sp0.y;
    if (!g.moved && Math.hypot(dxs, dys) < 3) return;
    g.moved = true;
    const wp = this.toWorld(sp.x, sp.y);
    const el = this.selected();
    this.guides = [];

    switch (g.type) {
      case 'pan':
        this.view.ox = g.v0.ox + dxs; this.view.oy = g.v0.oy + dys;
        this.clampView();
        this.hooks.onViewChange?.();
        break;
      case 'move': {
        el.x = g.el0.x + (wp.x - g.wp0.x);
        el.y = g.el0.y + (wp.y - g.wp0.y);
        if (!e.altKey) this.snapMove(el);
        break;
      }
      case 'cropmove': {
        const d = rotV(wp.x - g.wp0.x, wp.y - g.wp0.y, -(el.rot || 0));
        el.cx = g.el0.cx + d.x; el.cy = g.el0.cy + d.y;
        this.clampContent(el);
        break;
      }
      case 'scale': this.dragScale(el, g, wp); break;
      case 'edge': this.dragEdge(el, g, wp); break;
      case 'rot': {
        const c = { x: g.el0.x + g.el0.w / 2, y: g.el0.y + g.el0.h / 2 };
        el.rot = this.snapAngle((g.el0.rot || 0) + ang(c, wp) - ang(c, g.wp0));
        break;
      }
    }
    this.render();
  }

  up(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const g = this.g;
    if (this.pointers.size > 0) {
      // iki parmaktan biri kalktı: hareketi bitir ama zıplamayı önlemek için yeni hareket başlatma
      if (g && (g.type === 'pinchEl' || g.type === 'pinchView')) {
        if (g.type === 'pinchEl' && g.moved) this.hooks.onChange?.(true);
        this.g = { type: 'none' };
      }
      return;
    }
    this.guides = [];
    this.g = null;
    if (!g) return;
    if (g.type === 'pan' && this.single) {
      if (!g.moved) {
        // soluk yan slayta dokunuldu: o slayta geç
        const wx = this.toWorld(g.sp0.x, g.sp0.y).x;
        if (wx < this.cur * this.W) this.focusSlide(this.cur - 1);
        else if (wx > (this.cur + 1) * this.W) this.focusSlide(this.cur + 1);
        return;
      }
      if (Math.abs(this.view.s - this.singleFitScale()) < 0.001) {
        const dx = this.pt(e).x - g.sp0.x;
        this.focusSlide(this.cur + (dx < -40 ? 1 : dx > 40 ? -1 : 0));
        return;
      }
    }
    if (g.type === 'move' && !g.moved) {
      const el = this.selected();
      if (g.dbl && el) {
        if (el.type === 'image' && el.assetId) this.setCrop(true);
        else if (el.type === 'text') this.hooks.onDoubleTapText?.(el);
      } else if (el && el.type === 'image' && !el.assetId && g.wasSelected) {
        this.hooks.onEmptyFrameTap?.(el);
      }
    }
    if (['move', 'cropmove', 'scale', 'edge', 'rot', 'pinchEl'].includes(g.type) && g.moved) this.hooks.onChange?.(true);
    this.render();
  }

  wheel(e) {
    if (!this.p) return;
    e.preventDefault();
    const sp = this.pt(e);
    if (e.ctrlKey || e.metaKey) {
      this.zoomBy(Math.exp(-e.deltaY * 0.01), sp.x, sp.y);
    } else {
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      // dikey tekerlek hareketi de şeridi yatay kaydırsın (fare kullanıcıları için)
      const onlyV = Math.abs(dx) < 1;
      this.view.ox -= onlyV ? dy : dx;
      if (!onlyV) this.view.oy -= dy;
      this.clampView(); this.render(); this.hooks.onViewChange?.();
      if (this.single && Math.abs(this.view.s - this.singleFitScale()) < 0.001) {
        clearTimeout(this._snap);
        this._snap = setTimeout(() => this.focusSlide(this.centerSlide()), 180);
      }
    }
  }

  // ---------- dönüşüm yardımcıları ----------
  snapAngle(a) {
    const step = Math.PI / 4;
    const n = Math.round(a / step);
    return Math.abs(a - n * step) < 0.06 ? n * step : a;
  }

  applyScale(el, e0, k) {
    const min = 24;
    k = Math.max(k, min / Math.min(e0.w, e0.h));
    el.w = e0.w * k;
    if (el.type === 'text') {
      el.size = Math.max(6, e0.size * k);
      layoutText(this.ctx, el);
    } else el.h = e0.h * k;
    if (el.type === 'image') { el.iw = e0.iw * k; el.ih = e0.ih * k; el.cx = e0.cx * k; el.cy = e0.cy * k; }
  }

  scaleContent(el, e0, k) {
    const f = Math.max(k, el.w / e0.iw, el.h / e0.ih);
    el.iw = e0.iw * f; el.ih = e0.ih * f; el.cx = e0.cx * f; el.cy = e0.cy * f;
    this.clampContent(el);
  }

  // İçerik çerçeveyi her zaman tamamen kaplasın
  clampContent(el) {
    if (el.type !== 'image') return;
    const f = Math.max(1, el.w / el.iw, el.h / el.ih);
    if (f > 1) { el.iw *= f; el.ih *= f; el.cx *= f; el.cy *= f; }
    const mx = (el.iw - el.w) / 2, my = (el.ih - el.h) / 2;
    el.cx = Math.max(-mx, Math.min(mx, el.cx));
    el.cy = Math.max(-my, Math.min(my, el.cy));
  }

  dragScale(el, g, wp) {
    const e0 = g.el0, h = g.h, a = e0.rot || 0;
    if (this.crop) {
      const c = { x: e0.x + e0.w / 2, y: e0.y + e0.h / 2 };
      const cc = rotV(e0.cx, e0.cy, a); const C = { x: c.x + cc.x, y: c.y + cc.y };
      this.scaleContent(el, e0, dist(wp, C) / Math.max(1, dist(g.wp0, C)));
      return;
    }
    const c0 = { x: e0.x + e0.w / 2, y: e0.y + e0.h / 2 };
    const oL = rotV(-h.sx * e0.w / 2, -h.sy * e0.h / 2, a);
    const O = { x: c0.x + oL.x, y: c0.y + oL.y };
    const d = rotV(wp.x - O.x, wp.y - O.y, -a);
    const lx = d.x * h.sx, ly = d.y * h.sy;
    const k = (lx * e0.w + ly * e0.h) / (e0.w * e0.w + e0.h * e0.h);
    this.applyScale(el, e0, k);
    const nL = rotV(h.sx * el.w / 2, h.sy * el.h / 2, a);
    el.x = O.x + nL.x - el.w / 2;
    el.y = O.y + nL.y - el.h / 2;
  }

  dragEdge(el, g, wp) {
    const e0 = g.el0, h = g.h, a = e0.rot || 0;
    const c0 = { x: e0.x + e0.w / 2, y: e0.y + e0.h / 2 };
    const horiz = !!h.sx;
    const sgn = horiz ? h.sx : h.sy;
    const oL = horiz ? rotV(-sgn * e0.w / 2, 0, a) : rotV(0, -sgn * e0.h / 2, a);
    const O = { x: c0.x + oL.x, y: c0.y + oL.y };
    const d = rotV(wp.x - O.x, wp.y - O.y, -a);
    const len = Math.max(24, (horiz ? d.x : d.y) * sgn);
    if (horiz) el.w = len; else el.h = len;
    if (el.type === 'text') { el.w = Math.max(40, el.w); layoutText(this.ctx, el); }
    const nL = horiz ? rotV(sgn * el.w / 2, 0, a) : rotV(0, sgn * el.h / 2, a);
    const C = { x: O.x + nL.x, y: O.y + nL.y };
    if (el.type === 'text' && !horiz) return;
    el.x = C.x - el.w / 2; el.y = C.y - el.h / 2;
    if (el.type === 'image') {
      // içerik dünyada yerinde kalsın → yeni merkeze göre ofseti yeniden hesapla
      const cc0 = rotV(e0.cx, e0.cy, a);
      const Cc = { x: c0.x + cc0.x, y: c0.y + cc0.y };
      const nc = rotV(Cc.x - C.x, Cc.y - C.y, -a);
      el.iw = e0.iw; el.ih = e0.ih; el.cx = nc.x; el.cy = nc.y;
      this.clampContent(el);
    }
  }

  // Slayt kenarlarına ve ortalarına mıknatıs
  snapMove(el) {
    const { W, H } = this;
    const n = this.p.slides;
    const thr = SNAP_PX / this.view.s;
    // döndürülmüş kutunun eksen hizalı sınırları
    const a = el.rot || 0;
    const hw = (Math.abs(Math.cos(a)) * el.w + Math.abs(Math.sin(a)) * el.h) / 2;
    const hh = (Math.abs(Math.sin(a)) * el.w + Math.abs(Math.cos(a)) * el.h) / 2;
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    const xs = [];
    for (let i = 0; i <= n; i++) { xs.push(i * W); if (i < n) xs.push((i + 0.5) * W); }
    const ys = [0, H / 2, H];
    const best = (lines, vals) => {
      let bd = thr, bv = null, bl = null;
      for (const v of vals) for (const l of lines) { const d = l - v.p; if (Math.abs(d) < Math.abs(bd)) { bd = d; bv = d; bl = l; } }
      return bv === null ? null : { d: bv, line: bl };
    };
    const sx = best(xs, [{ p: cx - hw }, { p: cx }, { p: cx + hw }]);
    const sy = best(ys, [{ p: cy - hh }, { p: cy }, { p: cy + hh }]);
    if (sx) { el.x += sx.d; this.guides.push({ x: sx.line }); }
    if (sy) { el.y += sy.d; this.guides.push({ y: sy.line }); }
  }
}
