import { el, throttle } from './ui.js';

const CURSOR_TTL = 4000;

/**
 * A canvas "world" where both partners drag pieces at the same time. Rendering of the background
 * and of each piece is delegated to the activity; this class handles scaling, pointer input,
 * optimistic dragging, network sync and the partner's cursor.
 *
 * opts: { world: {w, h}, drawBackground(ctx), drawPiece(ctx, piece, highlightColor), hit(piece, x, y) }
 */
export class DragBoard {
  constructor(root, api, opts) {
    this.api = api;
    this.opts = opts;
    this.pieces = [];
    this.byId = new Map();
    this.cursors = new Map();
    this.drag = null;
    this.dirty = true;

    this.canvas = el('canvas', { class: 'board-canvas' });
    this.wrap = el('div', { class: 'board-wrap' }, this.canvas);
    root.append(this.wrap);
    this.ctx = this.canvas.getContext('2d');

    this.sendMove = throttle((id, x, y) => api.send('move', { id, x, y }), 40);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.wrap);

    this.onDown = this.onDown.bind(this);
    this.onMove = this.onMove.bind(this);
    this.onUp = this.onUp.bind(this);
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);

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

  resize() {
    const rect = this.wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    const { w, h } = this.opts.world;
    this.scale = Math.min(rect.width / w, rect.height / h);
    this.offX = (rect.width - w * this.scale) / 2;
    this.offY = (rect.height - h * this.scale) / 2;
    this.dpr = dpr;
    this.dirty = true;
  }

  toWorld(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - this.offX) / this.scale,
      y: (e.clientY - rect.top - this.offY) / this.scale,
    };
  }

  topPieceAt(x, y) {
    const candidates = this.pieces
      .filter((p) => !p.placed && (!p.heldBy || p.heldBy === this.api.me))
      .sort((a, b) => b.z - a.z);
    return candidates.find((p) => this.opts.hit(p, x, y)) || null;
  }

  onDown(e) {
    if (!e.isPrimary || this.drag) return;
    const { x, y } = this.toWorld(e);
    const piece = this.topPieceAt(x, y);
    if (!piece) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const maxZ = this.pieces.reduce((m, p) => Math.max(m, p.z), 0);
    piece.heldBy = this.api.me;
    piece.z = maxZ + 1;
    this.drag = { id: piece.id, dx: x - piece.x, dy: y - piece.y, pointerId: e.pointerId };
    this.api.send('grab', { id: piece.id });
    this.dirty = true;
  }

  onMove(e) {
    const { x, y } = this.toWorld(e);
    this.api.cursor(x, y);
    if (!this.drag || e.pointerId !== this.drag.pointerId) {
      if (e.pointerType === 'mouse') {
        this.canvas.style.cursor = this.topPieceAt(x, y) ? 'grab' : 'default';
      }
      return;
    }
    const piece = this.byId.get(this.drag.id);
    piece.x = x - this.drag.dx;
    piece.y = y - this.drag.dy;
    this.sendMove(piece.id, piece.x, piece.y);
    this.dirty = true;
  }

  onUp(e) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const piece = this.byId.get(this.drag.id);
    this.drag = null;
    this.api.send('drop', { id: piece.id, x: piece.x, y: piece.y });
  }

  render() {
    this.dirty = false;
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const s = this.scale * this.dpr;
    ctx.setTransform(s, 0, 0, s, this.offX * this.dpr, this.offY * this.dpr);
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
      drawCursor(ctx, c.x, c.y, who.color, who.name, 1 - Math.max(0, age - CURSOR_TTL + 800) / 800, 1 / this.scale);
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
