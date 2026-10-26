'use strict';

const { clamp } = require('./util');

// The partner who starts the game converts a picture into a template on their device (see
// public/js/lib/pbn.js) and sends it here; the server validates it and keeps the shared list of
// paint operations so a partner joining late sees the same canvas.
const GRID = { w: 600, h: 450 };
const MAX_COLORS = 24;
const MAX_OPS = 20000;
const MAX_POINTS_PER_OP = 600;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Template = { w, h, palette: ['#rrggbb'], rle: [colorIndex, runLength, ...] } covering the whole grid. */
function cleanTemplate(t) {
  if (!t || t.w !== GRID.w || t.h !== GRID.h) return null;
  const { palette, rle } = t;
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > MAX_COLORS) return null;
  if (!palette.every((c) => typeof c === 'string' && COLOR_RE.test(c))) return null;
  if (!Array.isArray(rle) || rle.length % 2 || rle.length > GRID.w * GRID.h * 2) return null;
  let total = 0;
  for (let i = 0; i < rle.length; i += 2) {
    const color = rle[i];
    const run = rle[i + 1];
    if (!Number.isInteger(color) || color < 0 || color >= palette.length) return null;
    if (!Number.isInteger(run) || run < 1) return null;
    total += run;
  }
  if (total !== GRID.w * GRID.h) return null;
  return { w: GRID.w, h: GRID.h, palette: palette.map((c) => c.toLowerCase()), rle };
}

function create(options) {
  const template = cleanTemplate(options.template);
  if (!template) throw new Error('invalid paint template');
  return {
    template,
    title: typeof options.title === 'string' ? options.title.slice(0, 40) : '',
    ops: [],
    completed: false,
  };
}

function cleanPoints(pts) {
  if (!Array.isArray(pts) || pts.length < 2 || pts.length > MAX_POINTS_PER_OP * 2) return null;
  const out = new Array(pts.length - (pts.length % 2));
  for (let i = 0; i < out.length; i++) {
    const v = Number(pts[i]);
    if (!Number.isFinite(v)) return null;
    out[i] = Math.round(clamp(v, -50, 700) * 10) / 10;
  }
  return out;
}

module.exports = {
  id: 'paint',
  create,
  actions: {
    stroke(state, data, ctx) {
      if (state.ops.length >= MAX_OPS || !COLOR_RE.test(data.color)) return;
      const p = cleanPoints(data.pts);
      if (!p) return;
      const op = { t: 's', c: data.color, w: clamp(data.size, 1, 80), p };
      state.ops.push(op);
      ctx.emitOthers('op', op);
    },
    fill(state, data, ctx) {
      if (state.ops.length >= MAX_OPS || !COLOR_RE.test(data.color)) return;
      const op = { t: 'f', c: data.color, r: clamp(data.region | 0, 0, GRID.w * GRID.h) };
      state.ops.push(op);
      ctx.emitOthers('op', op);
    },
    clear(state, _data, ctx) {
      state.ops = [];
      state.completed = false;
      ctx.emitAll('clear', {});
    },
    complete(state, _data, ctx) {
      // Each client checks its canvas against the template; the first to report 100% celebrates for both.
      if (state.completed) return;
      state.completed = true;
      ctx.emitAll('complete', {});
    },
  },
  _cleanTemplate: cleanTemplate,
};
