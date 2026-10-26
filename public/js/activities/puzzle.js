import { el, choiceField } from '../lib/ui.js';
import { DragBoard, roundRect } from '../lib/dragboard.js';
import { renderArt, ART_IDS } from '../lib/art.js';
import { photoToDataUrl, loadImage, aspectOf, thumb, addPhotoChoices, PHOTO_DIR } from '../lib/photo.js';

const PIECE_COUNTS = [12, 24, 48, 108, 150, 192];
const SHADOW = 6; // extra bitmap margin (world units) for the baked-in drop shadow

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

async function loadPicture(image, board) {
  if (image.kind === 'custom') return loadImage(image.data);
  if (image.kind === 'photo') return loadImage(`${PHOTO_DIR}/${encodeURIComponent(image.file)}`);
  // Built-in pictures are drawn in code, so render them sharp at twice the board size.
  return renderArt(image.id, Math.round(board.w * 2), Math.round(board.h * 2));
}

export default {
  id: 'puzzle',
  icon: '🧩',
  accent: '#ff7eb6',

  renderOptions(container, { t, lang }) {
    const pieces = choiceField(t('opt.pieces'), PIECE_COUNTS.map((n) => ({ value: String(n), label: String(n) })), '48');

    let custom = null; // { data, img }
    const photos = new Map();
    const uploadThumb = el('span', { class: 'thumb upload-thumb', text: '📷' });
    const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
    const image = choiceField(t('opt.image'), [
      { value: 'custom', label: t('opt.upload'), preview: uploadThumb },
      ...ART_IDS.map((id) => ({ value: id, label: t(`art.${id}`), preview: thumb(renderArt(id, 240, 180)) })),
    ], ART_IDS[0]);
    const uploadBtn = image.group.querySelector('[data-value="custom"]');
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      const data = await photoToDataUrl(file);
      const img = await loadImage(data);
      custom = { data, img };
      uploadBtn.replaceChild(thumb(img), uploadBtn.firstChild);
      image.set('custom');
    });
    addPhotoChoices(image, uploadBtn, lang, (value, file, img) => photos.set(value, { file, img }));
    container.append(image.node, pieces.node, fileInput);

    return () => {
      const choice = image.get();
      let picture;
      if (choice === 'custom' && custom) picture = { kind: 'custom', data: custom.data, aspect: aspectOf(custom.img) };
      else if (photos.has(choice)) picture = { kind: 'photo', file: photos.get(choice).file, aspect: aspectOf(photos.get(choice).img) };
      // Without an uploaded photo the custom choice falls back to the first built-in picture.
      else picture = { kind: 'builtin', id: ART_IDS.includes(choice) ? choice : ART_IDS[0] };
      return { pieces: Number(pieces.get()), image: picture };
    };
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
        const m = geo.pad + SHADOW;
        // Shadows are baked into the bitmaps; only pieces in someone's hand get a live glow.
        if (color) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 16;
        }
        ctx.drawImage(geo.bitmaps[p.id], p.x - m, p.y - m, geo.cw + 2 * m, geo.ch + 2 * m);
        if (color) {
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
        }
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
      const img = await loadPicture(s.image, s.board);
      if (token !== loadToken) return;
      const cw = s.board.w / s.cols;
      const ch = s.board.h / s.rows;
      const pad = Math.round(Math.min(cw, ch) * 0.3);
      const m = pad + SHADOW;
      const imgW = img.naturalWidth || img.width;
      const imgH = img.naturalHeight || img.height;
      const kx = imgW / s.board.w; // image pixels per world unit
      const ky = imgH / s.board.h;
      const rs = Math.min(2.5, Math.max(1, kx)); // bitmap pixels per world unit
      const paths = [];
      const bitmaps = [];
      for (let r = 0; r < s.rows; r++) {
        for (let c = 0; c < s.cols; c++) {
          const path = piecePath(s, r, c, cw, ch);
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil((cw + 2 * m) * rs);
          canvas.height = Math.ceil((ch + 2 * m) * rs);
          const g = canvas.getContext('2d');
          g.scale(rs, rs);
          g.translate(m, m);
          // drop shadow (shadow sizes are in device pixels, so scale them by rs)
          g.save();
          g.shadowColor = 'rgba(40, 0, 40, 0.4)';
          g.shadowBlur = 4 * rs;
          g.shadowOffsetY = 1.5 * rs;
          g.fillStyle = '#888';
          g.fill(path);
          g.restore();
          // only the part of the picture this piece covers (cheap even for 200 pieces)
          g.save();
          g.clip(path);
          const x0 = Math.max(0, c * cw - pad);
          const y0 = Math.max(0, r * ch - pad);
          const x1 = Math.min(s.board.w, (c + 1) * cw + pad);
          const y1 = Math.min(s.board.h, (r + 1) * ch + pad);
          g.drawImage(img, x0 * kx, y0 * ky, (x1 - x0) * kx, (y1 - y0) * ky, x0 - c * cw, y0 - r * ch, x1 - x0, y1 - y0);
          g.restore();
          g.lineWidth = 1.2;
          g.strokeStyle = 'rgba(0,0,0,0.3)';
          g.stroke(path);
          g.translate(-0.6, -0.6);
          g.lineWidth = 0.8;
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
        board.setWorld(s.world);
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
