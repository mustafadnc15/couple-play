import { el, throttle } from './ui.js';

const CURSOR_TTL = 4000;
const MAX_ZOOM = 6;

/**
 * A canvas "world" where both partners drag pieces at the same time. Rendering of the background
 * and of each piece is delegated to the activity; this class handles the view (fit, zoom, pan),
 * pointer input, optimistic dragging, network sync and the partner's cursor.
 *
 * opts: { world: {w, h}, drawBackground(ctx), drawPiece(ctx, piece, highlightColor), hit(piece, x, y) }
 *
 * Zoom: mouse wheel / trackpad pinch / two-finger pinch, or the +/− buttons.
 * Pan: drag the empty table, two-finger drag, or trackpad scroll.
 */
export class DragBoard {
  constructor(root, api, opts) {
    this.api = api;
    this.opts = opts;
    this.world = opts.world;
    this.pieces = [];
    this.byId = new Map();
    this.cursors = new Map();
    this.drag = null;
    this.pan = null;
    this.touches = new Map();
    this.pinch = null;
    this.dirty = true;
    this.view = { zoom: 1, cx: this.world.w / 2, cy: this.world.h / 2 };

    this.canvas = el('canvas', { class: 'board-canvas' });
    const zoomBtn = (text, label, fn) => el('button', { type: 'button', class: 'zoom-btn', text, 'aria-label': label, onclick: fn });
    this.zoomLabel = el('span', { class: 'zoom-label', text: '100%' });
    const controls = el('div', { class: 'board-zoom' },
      zoomBtn('−', 'zoom out', () => this.zoomBy(1 / 1.4)),
      this.zoomLabel,
      zoomBtn('+', 'zoom in', () => this.zoomBy(1.4)),
      zoomBtn('⤢', 'fit', () => this.fit()));
    this.wrap = el('div', { class: 'board-wrap' }, this.canvas, controls);
    root.append(this.wrap);
    this.ctx = this.canvas.getContext('2d');

    this.sendMove = throttle((id, x, y) => api.send('move', { id, x, y }), 40);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.wrap);

    for (const [type, fn] of [['pointerdown', this.onDown], ['pointermove', this.onMove], ['pointerup', this.onUp], ['pointercancel', this.onUp]]) {
      this.canvas.addEventListener(type, fn.bind(this));
    }
    this.canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });

    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (this.dirty || this.cursors.size) this.render();
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
  }

  setWorld(world) {
    if (world.w === this.world.w && world.h === this.world.h) return;
    this.world = world;
    this.fit();
  }

  setPieces(pieces) {
    this.pieces = pieces.map((p) => ({ ...p }));
    this.byId = new Map(this.pieces.map((p) => [p.id, p]));
    this.drag = null;
    this.dirty = true;
  }

  applyPiece(delta) {
    const piece = this.byId.get(delta.id);
    if (!piece) return;
    if (this.drag && this.drag.id === delta.id) {
      if (delta.heldBy !== undefined && delta.heldBy !== this.api.me) {
        this.drag = null; // someone else got it first, or it was placed
        Object.assign(piece, delta);
      } else if (delta.z !== undefined) {
        piece.z = delta.z;
      }
    } else {
      Object.assign(piece, delta);
    }
    this.dirty = true;
  }

  setCursor(pid, x, y) {
    this.cursors.set(pid, { x, y, at: performance.now() });
  }

  /* ---------- view ---------- */

  resize() {
    const rect = this.wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = dpr;
    this.dirty = true;
  }

  /** Current world → screen transform. */
  transform() {
    const fitScale = Math.min(this.width / this.world.w, this.height / this.world.h) || 1;
    const s = fitScale * this.view.zoom;
    return { s, ox: this.width / 2 - this.view.cx * s, oy: this.height / 2 - this.view.cy * s };
  }

  clampView() {
    const v = this.view;
    v.zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom));
    v.cx = Math.min(this.world.w, Math.max(0, v.cx));
    v.cy = Math.min(this.world.h, Math.max(0, v.cy));
    this.zoomLabel.textContent = `${Math.round(v.zoom * 100)}%`;
    this.dirty = true;
  }

  fit() {
    this.view = { zoom: 1, cx: this.world.w / 2, cy: this.world.h / 2 };
    this.clampView();
  }

  /** Zoom keeping the world point under screen point (sx, sy) in place (defaults to the centre). */
  zoomBy(factor, sx = this.width / 2, sy = this.height / 2) {
    const before = this.screenToWorld(sx, sy);
    this.view.zoom *= factor;
    this.clampView();
    const { s } = this.transform();
    this.view.cx = before.x - (sx - this.width / 2) / s;
    this.view.cy = before.y - (sy - this.height / 2) / s;
    this.clampView();
  }

  panBy(dx, dy) {
    const { s } = this.transform();
    this.view.cx -= dx / s;
    this.view.cy -= dy / s;
    this.clampView();
  }

  screenToWorld(sx, sy) {
    const { s, ox, oy } = this.transform();
    return { x: (sx - ox) / s, y: (sy - oy) / s };
  }

  local(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }

  /* ---------- input ---------- */

  topPieceAt(x, y) {
    const candidates = this.pieces
      .filter((p) => !p.placed && (!p.heldBy || p.heldBy === this.api.me))
      .sort((a, b) => b.z - a.z);
    return candidates.find((p) => this.opts.hit(p, x, y)) || null;
  }

  onWheel(e) {
    e.preventDefault();
    const { sx, sy } = this.local(e);
    // Mouse wheels (big line/notch steps) and trackpad pinches (ctrlKey) zoom; trackpad scrolling pans.
    const isWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || isWheel) {
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.zoomBy(Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015)), sx, sy);
    } else {
      this.panBy(-e.deltaX, -e.deltaY);
    }
  }

  onDown(e) {
    const { sx, sy } = this.local(e);
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { sx, sy });
      if (this.touches.size === 2 && !this.drag) {
        this.pan = null;
        this.pinch = this.pinchInfo();
        return;
      }
      if (this.touches.size > 1) return;
    } else if (e.button !== 0) {
      return;
    }
    if (this.drag || this.pan) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const { x, y } = this.screenToWorld(sx, sy);
    const piece = this.topPieceAt(x, y);
    if (!piece) {
      this.pan = { pointerId: e.pointerId, sx, sy };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    const maxZ = this.pieces.reduce((m, p) => Math.max(m, p.z), 0);
    piece.heldBy = this.api.me;
    piece.z = maxZ + 1;
    this.drag = { id: piece.id, dx: x - piece.x, dy: y - piece.y, pointerId: e.pointerId };
    this.api.send('grab', { id: piece.id });
    this.dirty = true;
  }

  pinchInfo() {
    const [a, b] = [...this.touches.values()];
    return { dist: Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1, mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
  }

  onMove(e) {
    const { sx, sy } = this.local(e);
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { sx, sy });
    if (this.pinch && this.touches.size >= 2) {
      const next = this.pinchInfo();
      this.panBy(next.mx - this.pinch.mx, next.my - this.pinch.my);
      this.zoomBy(next.dist / this.pinch.dist, next.mx, next.my);
      this.pinch = next;
      return;
    }
    const { x, y } = this.screenToWorld(sx, sy);
    this.api.cursor(x, y);
    if (this.pan && e.pointerId === this.pan.pointerId) {
      this.panBy(sx - this.pan.sx, sy - this.pan.sy);
      this.pan.sx = sx;
      this.pan.sy = sy;
      return;
    }
    if (!this.drag || e.pointerId !== this.drag.pointerId) {
      if (e.pointerType === 'mouse') this.canvas.style.cursor = this.topPieceAt(x, y) ? 'grab' : 'default';
      return;
    }
    const piece = this.byId.get(this.drag.id);
    piece.x = x - this.drag.dx;
    piece.y = y - this.drag.dy;
    this.sendMove(piece.id, piece.x, piece.y);
    this.dirty = true;
  }

  onUp(e) {
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = null;
    if (this.pan && e.pointerId === this.pan.pointerId) {
      this.pan = null;
      this.canvas.style.cursor = 'default';
    }
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const piece = this.byId.get(this.drag.id);
    this.drag = null;
    this.api.send('drop', { id: piece.id, x: piece.x, y: piece.y });
  }

  /* ---------- drawing ---------- */

  render() {
    this.dirty = false;
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const { s, ox, oy } = this.transform();
    const k = s * this.dpr;
    ctx.setTransform(k, 0, 0, k, ox * this.dpr, oy * this.dpr);
    this.opts.drawBackground(ctx);

    const placed = this.pieces.filter((p) => p.placed);
    const loose = this.pieces.filter((p) => !p.placed).sort((a, b) => a.z - b.z);
    for (const p of placed) this.opts.drawPiece(ctx, p, null);
    for (const p of loose) {
      const holder = p.heldBy && this.api.player(p.heldBy);
      this.opts.drawPiece(ctx, p, holder ? holder.color : null);
    }

    const now = performance.now();
    for (const [pid, c] of this.cursors) {
      const age = now - c.at;
      if (age > CURSOR_TTL) {
        this.cursors.delete(pid);
        this.dirty = true;
        continue;
      }
      const who = this.api.player(pid);
      if (!who) continue;
      drawCursor(ctx, c.x, c.y, who.color, who.name, 1 - Math.max(0, age - CURSOR_TTL + 800) / 800, 1 / s);
    }
  }
}

function drawCursor(ctx, x, y, color, name, alpha, unit) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.translate(x, y);
  ctx.scale(unit, unit); // draw in screen pixels so the cursor keeps its size
  ctx.fillStyle = color;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 18);
  ctx.lineTo(5, 14);
  ctx.lineTo(9, 22);
  ctx.lineTo(12, 20);
  ctx.lineTo(8, 13);
  ctx.lineTo(14, 13);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.font = '700 12px Nunito, sans-serif';
  const tw = ctx.measureText(name).width;
  ctx.fillStyle = color;
  roundRect(ctx, 14, 20, tw + 12, 18, 9);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(name, 20, 33);
  ctx.restore();
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
