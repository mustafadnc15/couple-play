'use strict';

const { pick, scatter } = require('./util');
const { dragActions, release } = require('./drag');

const WORLD = { w: 1600, h: 1000 };
const UNIT = 40; // one stud
const STUD_H = 8;

const COLORS = {
  R: '#e3263b', P: '#ff7eb6', W: '#f4f4f4', Y: '#ffd23f', G: '#2bb24c',
  B: '#2d7ff9', O: '#ff8c1a', N: '#8b5a2b', L: '#8fd3ff', V: '#8e5cf7',
};

// Blueprints, front view. Each letter is one stud of a colour, '.' is empty.
const DESIGNS = {
  heart: [
    '..RRR....RRR..',
    '.RRRRR..RRRRR.',
    'RRWWRRRRRRRRRR',
    'RRWRRRRRRRRRRR',
    'RRRRRRRRRRRRRR',
    '.RRRRRRRRRRRR.',
    '..RRRRRRRRRR..',
    '...RRRRRRRR...',
    '....RRRRRR....',
    '.....RRRR.....',
    '......RR......',
  ],
  house: [
    '......RR......',
    '.....RRRR.....',
    '....RRRRRR....',
    '...RRRRRRRR...',
    '..RRRRRRRRRR..',
    '.RRRRRRRRRRRR.',
    '..WWWWWWWWWW..',
    '..WYYWWWWYYW..',
    '..WYYWWWWYYW..',
    '..WWWWNNWWWW..',
    '..WWWWNNWWWW..',
    'GGGGGGNNGGGGGG',
  ],
  flower: [
    '....PPPP......',
    '..PPPPPPPP....',
    '..PPPYYPPP....',
    '..PPYYYYPP....',
    '..PPPYYPPP....',
    '..PPPPPPPP....',
    '....PPPP......',
    '.....GG.......',
    '.....GG..GGG..',
    '.....GGGGGG...',
    '.....GG.......',
    '.NNNNNNNNNN...',
    '..NNNNNNNN....',
  ],
  rocket: [
    '.....RR.....',
    '....RRRR....',
    '....WWWW....',
    '....WLLW....',
    '....WLLW....',
    '....WWWW....',
    '...RWWWWR...',
    '..RRWWWWRR..',
    '..RR.OO.RR..',
    '.....YY.....',
  ],
};

/** Split a run of `len` equal studs into brick lengths, staggered on odd rows like a real wall. */
function splitRun(len, row) {
  const sizes = [];
  let rem = len;
  if (row % 2 === 1 && rem >= 3) {
    sizes.push(2);
    rem -= 2;
  }
  while (rem > 0) {
    if (rem === 5) {
      sizes.push(3, 2);
      rem = 0;
    } else {
      const s = Math.min(4, rem);
      sizes.push(s);
      rem -= s;
    }
  }
  return sizes;
}

function buildSlots(design) {
  const rows = design.length;
  const cols = Math.max(...design.map((r) => r.length));
  const board = { w: cols * UNIT, h: rows * UNIT };
  board.x = Math.round((WORLD.w - board.w) / 2);
  board.y = Math.round((WORLD.h - board.h) / 2);

  const slots = [];
  design.forEach((line, row) => {
    let col = 0;
    while (col < line.length) {
      const ch = line[col];
      if (!COLORS[ch]) { col++; continue; }
      let end = col;
      while (end < line.length && line[end] === ch) end++;
      for (const len of splitRun(end - col, row)) {
        slots.push({
          id: slots.length, row, col, len, color: COLORS[ch],
          x: board.x + col * UNIT, y: board.y + row * UNIT, filled: null,
        });
        col += len;
      }
    }
  });
  return { board, slots, rows, cols };
}

function create(options) {
  const designId = pick(Object.keys(DESIGNS), options.design, 'heart');
  const { board, slots, rows, cols } = buildSlots(DESIGNS[designId]);
  const pieces = slots.map((s) => ({
    id: s.id, len: s.len, color: s.color, x: 0, y: 0, placed: false, heldBy: null, z: 0,
  }));
  scatter(pieces, WORLD, board, (p) => ({ w: p.len * UNIT, h: UNIT, padX: 4, padTop: STUD_H }));
  return {
    world: WORLD, board, rows, cols, unit: UNIT, design: designId,
    slots, pieces, z: 0, completed: false,
  };
}

/** Bricks are interchangeable: any free slot with the same size and colour accepts the brick. */
function snap(state, piece) {
  let best = null;
  let bestDist = UNIT * 0.6;
  for (const slot of state.slots) {
    if (slot.filled !== null || slot.len !== piece.len || slot.color !== piece.color) continue;
    const d = Math.hypot(piece.x - slot.x, piece.y - slot.y);
    if (d <= bestDist) {
      best = slot;
      bestDist = d;
    }
  }
  if (!best) return null;
  best.filled = piece.id;
  return { x: best.x, y: best.y };
}

module.exports = {
  id: 'lego',
  create,
  actions: dragActions(snap),
  onLeave: (state, pid, ctx) => release(state, pid, ctx),
  DESIGNS,
  _splitRun: splitRun,
  _snap: snap,
};
