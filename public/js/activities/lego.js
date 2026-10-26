import { el, choiceField } from '../lib/ui.js';
import { DragBoard, roundRect } from '../lib/dragboard.js';

const STUD_H = 8;

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (amt > 0 ? (255 - v) * amt : v * amt))));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

function drawBrick(ctx, x, y, len, color, unit) {
  const w = len * unit;
  // studs
  for (let i = 0; i < len; i++) {
    const sx = x + i * unit + unit * 0.2;
    ctx.fillStyle = shade(color, -0.15);
    ctx.fillRect(sx, y - STUD_H, unit * 0.6, STUD_H + 1);
    ctx.fillStyle = shade(color, 0.25);
    ctx.fillRect(sx + 2, y - STUD_H + 1, unit * 0.6 - 4, 3);
  }
  // body
  ctx.fillStyle = color;
  roundRect(ctx, x + 0.5, y, w - 1, unit - 0.5, 3);
  ctx.fill();
  ctx.fillStyle = shade(color, 0.3);
  ctx.fillRect(x + 2, y + 1.5, w - 4, 4);
  ctx.fillStyle = shade(color, -0.25);
  ctx.fillRect(x + 2, y + unit - 6, w - 4, 4);
  ctx.strokeStyle = shade(color, -0.4);
  ctx.lineWidth = 1.2;
  roundRect(ctx, x + 0.5, y, w - 1, unit - 0.5, 3);
  ctx.stroke();
}

export default {
  id: 'lego',
  icon: '🧱',
  accent: '#ffd23f',

  renderOptions(container, { t }) {
    const icons = { heart: '❤️', house: '🏠', flower: '🌸', rocket: '🚀' };
    const design = choiceField(t('opt.design'), Object.entries(icons).map(([id, icon]) => ({
      value: id, label: t(`lego.${id}`), preview: el('span', { class: 'thumb emoji-thumb', text: icon }),
    })), 'heart');
    container.append(design.node);
    return () => ({ design: design.get() });
  },

  mount(root, api) {
    let state = null;
    const progress = el('span', { class: 'chip' });
    const newBtn = el('button', { type: 'button', class: 'btn btn-sm btn-secondary', text: api.t('drag.new'), onclick: api.newGame });
    api.tools.append(progress, newBtn);

    const board = new DragBoard(root, api, {
      world: { w: 1600, h: 1000 },
      drawBackground(ctx) {
        if (!state) return;
        const { board: b, unit } = state;
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        roundRect(ctx, 4, 4, state.world.w - 8, state.world.h - 8, 28);
        ctx.fill();

        // baseplate with studs
        ctx.fillStyle = '#dfe9f5';
        roundRect(ctx, b.x - 16, b.y - 24, b.w + 32, b.h + 40, 14);
        ctx.fill();
        ctx.fillStyle = '#cfdcec';
        for (let r = 0; r < state.rows; r++) {
          for (let c = 0; c < state.cols; c++) {
            ctx.beginPath();
            ctx.arc(b.x + c * unit + unit / 2, b.y + r * unit + unit / 2, unit * 0.22, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // blueprint: slots that are still empty
        const filled = new Set(board.pieces.filter((p) => p.placed).map((p) => `${p.x},${p.y}`));
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 2;
        for (const s of state.slots) {
          if (filled.has(`${s.x},${s.y}`)) continue;
          ctx.globalAlpha = 0.28;
          ctx.fillStyle = s.color;
          ctx.fillRect(s.x + 2, s.y + 2, s.len * unit - 4, unit - 4);
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = shade(s.color, -0.3);
          ctx.strokeRect(s.x + 2, s.y + 2, s.len * unit - 4, unit - 4);
        }
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
      },
      drawPiece(ctx, p, color) {
        if (!state) return;
        if (!p.placed) {
          ctx.shadowColor = color || 'rgba(0, 0, 40, 0.3)';
          ctx.shadowBlur = color ? 18 : 5;
          ctx.shadowOffsetY = color ? 0 : 3;
        }
        drawBrick(ctx, p.x, p.y, p.len, p.color, state.unit);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
      },
      hit(p, x, y) {
        return state && x >= p.x && x <= p.x + p.len * state.unit && y >= p.y - STUD_H && y <= p.y + state.unit;
      },
    });

    function updateProgress() {
      const done = board.pieces.filter((p) => p.placed).length;
      progress.textContent = api.t('drag.progress', { done, total: board.pieces.length });
    }

    return {
      onState(s) {
        state = s;
        board.setPieces(s.pieces);
        updateProgress();
      },
      onEvent(type, data) {
        if (type === 'piece') {
          board.applyPiece(data);
          updateProgress();
        } else if (type === 'complete') {
          state.completed = true;
          api.celebrate(api.t('lego.done'));
        }
      },
      onCursor(pid, x, y) {
        board.setCursor(pid, x, y);
      },
      onPlayers() {
        board.dirty = true;
      },
      destroy() {
        board.destroy();
      },
    };
  },
};
