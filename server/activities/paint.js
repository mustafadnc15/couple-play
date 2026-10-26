'use strict';

const { clamp, pick } = require('./util');

// Template drawings live on the client (public/js/activities/paintTemplates.js); the server only
// keeps the shared list of paint operations so a partner joining late sees the same canvas.
const TEMPLATES = ['sunset', 'house', 'balloons'];
const MAX_OPS = 20000;
const MAX_POINTS_PER_OP = 600;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

function create(options) {
  return { template: pick(TEMPLATES, options.template, TEMPLATES[0]), ops: [], completed: false };
}

function cleanPoints(pts) {
  if (!Array.isArray(pts) || pts.length < 2 || pts.length > MAX_POINTS_PER_OP * 2) return null;
  const out = new Array(pts.length - (pts.length % 2));
  for (let i = 0; i < out.length; i++) {
    const v = Number(pts[i]);
    if (!Number.isFinite(v)) return null;
    out[i] = Math.round(clamp(v, -50, 900) * 10) / 10;
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
      const op = { t: 'f', c: data.color, r: clamp(data.region | 0, 0, 500) };
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
};
