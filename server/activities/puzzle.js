'use strict';

const { pick, scatter } = require('./util');
const { dragActions, release } = require('./drag');

const WORLD = { w: 1600, h: 1000 };
const BOARD = { x: 440, y: 230, w: 720, h: 540 }; // 4:3, images are cropped to match
const DIFFICULTY = { easy: [3, 4], medium: [4, 6], hard: [6, 8] };
const BUILTIN_IMAGES = ['sunset', 'night', 'garden'];
const MAX_IMAGE_CHARS = 3.5e6;

function parseImage(img) {
  if (img && img.kind === 'custom' && typeof img.data === 'string'
    && img.data.length < MAX_IMAGE_CHARS && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img.data)) {
    return { kind: 'custom', data: img.data };
  }
  return { kind: 'builtin', id: pick(BUILTIN_IMAGES, img && img.id, BUILTIN_IMAGES[0]) };
}

function randomEdges(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => (Math.random() < 0.5 ? 1 : -1)));
}

function create(options) {
  const difficulty = pick(Object.keys(DIFFICULTY), options.difficulty, 'medium');
  const [rows, cols] = DIFFICULTY[difficulty];
  const cw = BOARD.w / cols;
  const ch = BOARD.h / rows;
  const pad = Math.round(Math.min(cw, ch) * 0.3);

  const pieces = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pieces.push({ id: r * cols + c, r, c, x: 0, y: 0, placed: false, heldBy: null, z: 0 });
    }
  }
  scatter(pieces, WORLD, BOARD, () => ({ w: cw, h: ch, padX: pad, padTop: pad }));

  return {
    world: WORLD,
    board: BOARD,
    rows,
    cols,
    difficulty,
    image: parseImage(options.image),
    // hEdges[r][c]: edge under piece (r,c); vEdges[r][c]: edge right of piece (r,c). +1 = tab points down/right.
    hEdges: randomEdges(rows - 1, cols),
    vEdges: randomEdges(rows, cols - 1),
    pieces,
    z: 0,
    completed: false,
  };
}

function snap(state, piece) {
  const cw = state.board.w / state.cols;
  const ch = state.board.h / state.rows;
  const tx = state.board.x + piece.c * cw;
  const ty = state.board.y + piece.r * ch;
  const tolerance = Math.max(18, Math.min(cw, ch) * 0.3);
  return Math.hypot(piece.x - tx, piece.y - ty) <= tolerance ? { x: tx, y: ty } : null;
}

module.exports = {
  id: 'puzzle',
  create,
  actions: dragActions(snap),
  onLeave: (state, pid, ctx) => release(state, pid, ctx),
  _snap: snap,
};
