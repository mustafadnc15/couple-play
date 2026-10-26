'use strict';

const { clamp, pick, locale } = require('./util');

/**
 * Wordle-style guessing game. Each partner picks a secret number/word, then both guess the
 * other's secret in simultaneous rounds. A round is revealed once every player still guessing
 * has submitted.
 */

function normalize(raw, mode, lang) {
  const s = String(raw || '').replace(/\s+/g, '');
  if (mode === 'number') return /^\d+$/.test(s) ? s : null;
  const up = s.toLocaleUpperCase(locale(lang));
  return /^\p{L}+$/u.test(up) ? up : null;
}

/** Returns per-position marks: 'g' (right spot), 'y' (elsewhere), 'x' (absent). Handles repeats. */
function score(guess, secret) {
  const g = Array.from(guess);
  const s = Array.from(secret);
  const marks = g.map(() => 'x');
  const left = new Map();
  g.forEach((ch, i) => {
    if (ch === s[i]) marks[i] = 'g';
    else left.set(s[i], (left.get(s[i]) || 0) + 1);
  });
  g.forEach((ch, i) => {
    if (marks[i] === 'g') return;
    const n = left.get(ch) || 0;
    if (n > 0) {
      marks[i] = 'y';
      left.set(ch, n - 1);
    }
  });
  return marks;
}

function create(options, info) {
  const mode = pick(['number', 'word'], options.mode, 'word');
  const length = mode === 'number' ? clamp(options.length | 0, 3, 6) : clamp(options.length | 0, 4, 6);
  const state = {
    mode,
    length,
    lang: pick(['tr', 'en'], options.lang, 'tr'),
    maxAttempts: clamp(options.maxAttempts | 0 || 8, 4, 12),
    phase: 'setup',
    round: 1,
    players: {},
    result: null,
  };
  (info.players || []).forEach((pid) => ensure(state, pid));
  return state;
}

function ensure(state, pid) {
  if (!state.players[pid]) state.players[pid] = { secret: null, guesses: [], solved: false, pending: null };
  return state.players[pid];
}

function partnerOf(pids, pid) {
  return pids.find((p) => p !== pid) || null;
}

function stillGuessing(state, p) {
  return !p.solved && p.guesses.length < state.maxAttempts;
}

function resolveRound(state, pids) {
  const active = pids.filter((pid) => stillGuessing(state, state.players[pid]));
  if (active.length === 0 || active.some((pid) => !state.players[pid].pending)) return false;
  for (const pid of active) {
    const me = state.players[pid];
    const secret = state.players[partnerOf(pids, pid)].secret;
    const marks = score(me.pending, secret);
    me.guesses.push({ guess: me.pending, marks });
    me.solved = marks.every((m) => m === 'g');
    me.pending = null;
  }
  state.round++;
  if (pids.every((pid) => !stillGuessing(state, state.players[pid]))) {
    state.phase = 'over';
    const [a, b] = pids.map((pid) => state.players[pid]);
    const rank = (p) => (p.solved ? p.guesses.length : Infinity);
    let winner = null;
    if (rank(a) < rank(b)) winner = pids[0];
    else if (rank(b) < rank(a)) winner = pids[1];
    state.result = { winner, tie: winner === null && a.solved };
  }
  return true;
}

function view(state, pid, roomPids) {
  const pids = roomPids.slice(0, 2);
  const me = state.players[pid] || { secret: null, guesses: [], solved: false, pending: null };
  const partnerPid = partnerOf(pids, pid);
  const partner = (partnerPid && state.players[partnerPid]) || null;
  return {
    mode: state.mode,
    length: state.length,
    lang: state.lang,
    maxAttempts: state.maxAttempts,
    phase: state.phase,
    round: state.round,
    hasPartner: Boolean(partner),
    me: { secret: me.secret, guesses: me.guesses, solved: me.solved, pending: me.pending },
    partner: partner && {
      secretSet: Boolean(partner.secret),
      guesses: partner.guesses,
      solved: partner.solved,
      submitted: Boolean(partner.pending),
      secret: state.phase === 'over' ? partner.secret : null,
    },
    result: state.result && { won: state.result.winner === pid, lost: Boolean(state.result.winner) && state.result.winner !== pid, tie: state.result.tie },
  };
}

module.exports = {
  id: 'guess',
  create,
  view,
  actions: {
    secret(state, data, ctx) {
      if (state.phase !== 'setup') return;
      const value = normalize(data.value, state.mode, state.lang);
      if (!value || Array.from(value).length !== state.length) return ctx.reply('error', { code: 'invalid' });
      ensure(state, ctx.pid).secret = value;
      const pids = ctx.players.slice(0, 2);
      pids.forEach((pid) => ensure(state, pid));
      if (pids.length === 2 && pids.every((pid) => state.players[pid].secret)) state.phase = 'play';
      ctx.sync();
    },
    guess(state, data, ctx) {
      if (state.phase !== 'play') return;
      const me = state.players[ctx.pid];
      if (!me || !stillGuessing(state, me)) return;
      const value = normalize(data.value, state.mode, state.lang);
      if (!value || Array.from(value).length !== state.length) return ctx.reply('error', { code: 'invalid' });
      me.pending = value;
      resolveRound(state, ctx.players.slice(0, 2));
      ctx.sync();
    },
    restart(state, _data, ctx) {
      state.phase = 'setup';
      state.round = 1;
      state.result = null;
      state.players = {};
      ctx.players.slice(0, 2).forEach((pid) => ensure(state, pid));
      ctx.sync();
    },
  },
  _score: score,
  _normalize: normalize,
};
