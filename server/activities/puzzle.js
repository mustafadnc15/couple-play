'use strict';

const { clamp, pick, shuffle } = require('./util');
const { dragActions, release } = require('./drag');

const PIECE_COUNTS = [12, 24, 48, 108, 150, 192];
const CELL = 64; // piece height in world units; the world grows with the piece count
const BUILTIN_IMAGES = ['sunset', 'night', 'garden'];
const MAX_IMAGE_CHARS = 3.5e6;
/** { kind: 'builtin', id } | { kind: 'photo', id, url, aspect } (from the photo library) | { kind: 'custom', data, aspect } */
function parseImage(img, photos) {
  const aspect = clamp(img && img.aspect, 0.5, 2);
  if (img && img.kind === 'custom' && typeof img.data === 'string'
    && img.data.length < MAX_IMAGE_CHARS && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img.data)) {
    return { kind: 'custom', data: img.data, aspect };
  }
  const photo = img && img.kind === 'photo' && photos && typeof img.id === 'string' && photos.get(img.id);
  if (photo) return { kind: 'photo', id: photo.id, url: photo.url, aspect };
  return { kind: 'builtin', id: pick(BUILTIN_IMAGES, img && img.id, BUILTIN_IMAGES[0]), aspect: 4 / 3 };
}

/** Rows × cols close to `count` with roughly square pieces for this picture shape. */
function gridFor(count, aspect) {
  let best = null;
  for (let cols = 2; cols <= count / 2; cols++) {
    const rows = Math.max(2, Math.round(count / cols));
    // piece width/height = aspect * rows / cols; prefer square pieces, then the closest count
    const score = Math.abs(Math.log((aspect * rows) / cols)) + (2 * Math.abs(rows * cols - count)) / count;
    if (!best || score < best.score) best = { rows, cols, score };
  }
  return { rows: best.rows, cols: best.cols };
}

const MARGIN = 16;

/** Number of loose-piece spots in the two side areas for a given table size. */
function spotGrid(sideW, h, stepX, stepY) {
  return {
    cols: Math.max(0, Math.floor((sideW - 2 * MARGIN) / stepX)),
    rows: Math.max(0, Math.floor((h - 2 * MARGIN) / stepY)),
  };
}

/**
 * Size the board to the picture and grow the table around it until every loose piece has its own
 * spot beside the board, keeping the whole world at a screen-friendly shape.
 */
function layout(rows, cols, aspect) {
  const ch = CELL;
  const cw = (CELL * aspect * rows) / cols;
  const bw = cw * cols;
  const bh = ch * rows;
  const pad = Math.round(Math.min(cw, ch) * 0.3);
  const stepX = cw + 2 * pad;
  const stepY = ch + 2 * pad;
  let h = Math.max(bh + 120, stepY * 3 + 2 * MARGIN);
  let side = stepX + 2 * MARGIN;
  for (let i = 0; i < 500; i++) {
    const g = spotGrid(side, h, stepX, stepY);
    if (2 * g.cols * g.rows >= rows * cols) break;
    if ((bw + 2 * (side + stepX)) / h > 1.8) h += stepY;
    else side += stepX;
  }
  side = Math.ceil(side);
  h = Math.ceil(h);
  const world = { w: Math.ceil(bw + 2 * side), h };
  const board = { x: side, y: Math.round((h - bh) / 2), w: bw, h: bh };
  return { world, board, cw, ch, pad, stepX, stepY };
}

/** Lay loose pieces on a jittered grid in the side areas so they don't overlap. */
function spread(pieces, { world, board, pad, stepX, stepY }) {
  const spots = [];
  for (const [x0, x1] of [[0, board.x], [board.x + board.w, world.w]]) {
    const g = spotGrid(x1 - x0, world.h, stepX, stepY);
    const offX = x0 + ((x1 - x0) - g.cols * stepX) / 2;
    const offY = (world.h - g.rows * stepY) / 2;
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) spots.push([offX + c * stepX + pad, offY + r * stepY + pad]);
    }
  }
  shuffle(spots);
  const jitter = () => (Math.random() - 0.5) * pad * 0.5;
  shuffle(pieces.map((p) => p.id)).forEach((id, i) => {
    const [sx, sy] = spots[i % spots.length];
    pieces[id].x = Math.round(sx + jitter());
    pieces[id].y = Math.round(sy + jitter());
  });
}

function randomEdges(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => (Math.random() < 0.5 ? 1 : -1)));
}

function create(options, info = {}) {
  const image = parseImage(options.image, info.photos);
  const count = pick(PIECE_COUNTS, Number(options.pieces), 24);
  const { rows, cols } = gridFor(count, image.aspect);
  const geo = layout(rows, cols, image.aspect);

  const pieces = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pieces.push({ id: r * cols + c, r, c, x: 0, y: 0, placed: false, heldBy: null, z: 0 });
    }
  }
  spread(pieces, geo);

  return {
    world: geo.world,
    board: geo.board,
    rows,
    cols,
    image,
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
  const tolerance = Math.max(14, Math.min(cw, ch) * 0.3);
  return Math.hypot(piece.x - tx, piece.y - ty) <= tolerance ? { x: tx, y: ty } : null;
}

module.exports = {
  id: 'puzzle',
  create,
  actions: dragActions(snap),
  onLeave: (state, pid, ctx) => release(state, pid, ctx),
  PIECE_COUNTS,
  _gridFor: gridFor,
};
