import { el, choiceField } from '../lib/ui.js';
import { DragBoard, roundRect } from '../lib/dragboard.js';
import { renderArt, ART_IDS } from '../lib/art.js';

const RS = 1.5; // piece bitmap resolution per world unit

// Jigsaw tab outline: u runs along the edge (0..1), v sticks out of the piece (in units of the cell's short side).
const TAB = [
  ['L', 0.38, 0],
  ['C', 0.42, 0, 0.44, 0.06, 0.40, 0.11],
  ['C', 0.33, 0.20, 0.40, 0.27, 0.50, 0.27],
  ['C', 0.60, 0.27, 0.67, 0.20, 0.60, 0.11],
  ['C', 0.56, 0.06, 0.58, 0, 0.62, 0],
  ['L', 1, 0],
];

function addEdge(path, x0, y0, x1, y1, sign, s) {
  if (!sign) {
    path.lineTo(x1, y1);
    return;
  }
  const len = Math.hypot(x1 - x0, y1 - y0);
  const dx = (x1 - x0) / len;
  const dy = (y1 - y0) / len;
  const nx = dy;
  const ny = -dx; // outward normal for clockwise traversal
  const pt = (u, v) => [x0 + dx * u * len + nx * v * s * sign, y0 + dy * u * len + ny * v * s * sign];
  for (const seg of TAB) {
    if (seg[0] === 'L') path.lineTo(...pt(seg[1], seg[2]));
    else path.bezierCurveTo(...pt(seg[1], seg[2]), ...pt(seg[3], seg[4]), ...pt(seg[5], seg[6]));
  }
}

function piecePath(state, r, c, cw, ch) {
  const s = Math.min(cw, ch);
  const top = r === 0 ? 0 : -state.hEdges[r - 1][c];
  const right = c === state.cols - 1 ? 0 : state.vEdges[r][c];
  const bottom = r === state.rows - 1 ? 0 : state.hEdges[r][c];
  const left = c === 0 ? 0 : -state.vEdges[r][c - 1];
  const path = new Path2D();
  path.moveTo(0, 0);
  addEdge(path, 0, 0, cw, 0, top, s);
  addEdge(path, cw, 0, cw, ch, right, s);
  addEdge(path, cw, ch, 0, ch, bottom, s);
  addEdge(path, 0, ch, 0, 0, left, s);
  path.closePath();
  return path;
}

async function loadImage(image) {
  if (image.kind === 'custom') {
    const img = new Image();
    img.src = image.data;
    await img.decode();
    return img;
  }
  return renderArt(image.id);
}

/** Center-crop an uploaded photo to 4:3 and shrink it so it travels well over the socket. */
async function photoToDataUrl(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const target = 4 / 3;
    let sw = img.naturalWidth;
    let sh = img.naturalHeight;
    if (sw / sh > target) sw = sh * target;
    else sh = sw / target;
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 720;
    canvas.getContext('2d').drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, 960, 720);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function thumb(source) {
  const canvas = el('canvas', { class: 'thumb' });
  canvas.width = 120;
  canvas.height = 90;
  canvas.getContext('2d').drawImage(source, 0, 0, 120, 90);
  return canvas;
}

export default {
  id: 'puzzle',
  icon: '🧩',
  accent: '#ff7eb6',

  renderOptions(container, { t }) {
    const difficulty = choiceField(t('opt.difficulty'), [
      { value: 'easy', label: `${t('opt.easy')} · 12` },
      { value: 'medium', label: `${t('opt.medium')} · 24` },
      { value: 'hard', label: `${t('opt.hard')} · 48` },
    ], 'medium');

    let custom = null;
    const uploadThumb = el('span', { class: 'thumb upload-thumb', text: '📷' });
    const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
    const image = choiceField(t('opt.image'), [
      ...ART_IDS.map((id) => ({ value: id, label: t(`art.${id}`), preview: thumb(renderArt(id, 240, 180)) })),
      { value: 'custom', label: t('opt.upload'), preview: uploadThumb },
    ], ART_IDS[0]);
    const uploadBtn = image.group.querySelector('[data-value="custom"]');
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      custom = await photoToDataUrl(file);
      const img = new Image();
      img.src = custom;
      await img.decode();
      uploadThumb.replaceWith(thumb(img));
      image.set('custom');
    });
    // Without a photo the custom choice falls back to the first built-in picture.
    container.append(difficulty.node, image.node, fileInput);
    return () => ({
      difficulty: difficulty.get(),
      image: image.get() === 'custom' && custom ? { kind: 'custom', data: custom } : { kind: 'builtin', id: image.get() === 'custom' ? ART_IDS[0] : image.get() },
    });
  },

  mount(root, api) {
    let state = null;
    let geo = null; // { cw, ch, pad, img, bitmaps[], paths[] }
    let showHint = true;
    let loadToken = 0;
    const hitCtx = document.createElement('canvas').getContext('2d');

    const progress = el('span', { class: 'chip' });
    const hintBtn = el('button', { type: 'button', class: 'btn btn-sm btn-ghost active', text: `💡 ${api.t('drag.hint')}` });
    const newBtn = el('button', { type: 'button', class: 'btn btn-sm btn-secondary', text: api.t('drag.new'), onclick: api.newGame });
    hintBtn.addEventListener('click', () => {
      showHint = !showHint;
      hintBtn.classList.toggle('active', showHint);
      board.dirty = true;
    });
    api.tools.append(progress, hintBtn, newBtn);

    const board = new DragBoard(root, api, {
      world: { w: 1600, h: 1000 },
      drawBackground(ctx) {
        if (!state) return;
        const b = state.board;
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        roundRect(ctx, 4, 4, state.world.w - 8, state.world.h - 8, 28);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.shadowColor = 'rgba(80, 30, 80, 0.15)';
        ctx.shadowBlur = 20;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.shadowColor = 'transparent';
        if (geo && (showHint || state.completed)) {
          ctx.globalAlpha = state.completed ? 1 : 0.22;
          ctx.drawImage(geo.img, b.x, b.y, b.w, b.h);
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = 'rgba(255, 79, 129, 0.45)';
        ctx.setLineDash([10, 8]);
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
        ctx.setLineDash([]);
      },
      drawPiece(ctx, p, color) {
        if (!geo) return;
        const { pad, cw, ch } = geo;
        if (!p.placed) {
          ctx.shadowColor = color || 'rgba(40, 0, 40, 0.35)';
          ctx.shadowBlur = color ? 18 : 6;
          ctx.shadowOffsetY = color ? 0 : 2;
        }
        ctx.drawImage(geo.bitmaps[p.id], p.x - pad, p.y - pad, cw + 2 * pad, ch + 2 * pad);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
      },
      hit(p, x, y) {
        return geo ? hitCtx.isPointInPath(geo.paths[p.id], x - p.x, y - p.y) : false;
      },
    });

    function updateProgress() {
      const done = board.pieces.filter((p) => p.placed).length;
      progress.textContent = api.t('drag.progress', { done, total: board.pieces.length });
    }

    async function build(s) {
      const token = ++loadToken;
      const img = await loadImage(s.image);
      if (token !== loadToken) return;
      const cw = s.board.w / s.cols;
      const ch = s.board.h / s.rows;
      const pad = Math.round(Math.min(cw, ch) * 0.3);
      const paths = [];
      const bitmaps = [];
      for (let r = 0; r < s.rows; r++) {
        for (let c = 0; c < s.cols; c++) {
          const path = piecePath(s, r, c, cw, ch);
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil((cw + 2 * pad) * RS);
          canvas.height = Math.ceil((ch + 2 * pad) * RS);
          const g = canvas.getContext('2d');
          g.scale(RS, RS);
          g.translate(pad, pad);
          g.save();
          g.clip(path);
          g.drawImage(img, -c * cw, -r * ch, s.board.w, s.board.h);
          g.restore();
          g.lineWidth = 1.4;
          g.strokeStyle = 'rgba(0,0,0,0.35)';
          g.stroke(path);
          g.translate(-0.7, -0.7);
          g.lineWidth = 0.9;
          g.strokeStyle = 'rgba(255,255,255,0.45)';
          g.stroke(path);
          paths.push(path);
          bitmaps.push(canvas);
        }
      }
      geo = { cw, ch, pad, img, paths, bitmaps };
      board.dirty = true;
    }

    return {
      onState(s) {
        const fresh = !state;
        state = s;
        board.setPieces(s.pieces);
        updateProgress();
        if (fresh) build(s);
      },
      onEvent(type, data) {
        if (type === 'piece') {
          board.applyPiece(data);
          updateProgress();
        } else if (type === 'complete') {
          state.completed = true;
          board.dirty = true;
          api.celebrate(api.t('puzzle.done'));
        }
      },
      onCursor(pid, x, y) {
        board.setCursor(pid, x, y);
      },
      onPlayers() {
        board.dirty = true;
      },
      destroy() {
        loadToken++;
        board.destroy();
      },
    };
  },
};
