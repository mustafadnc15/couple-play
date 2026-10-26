'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const activities = require('../server/activities');
const guess = require('../server/activities/guess');
const lego = require('../server/activities/lego');
const bluetooth = require('../server/activities/bluetooth');

function fakeCtx(pid, players) {
  const events = [];
  return {
    pid,
    players,
    events,
    emitAll: (type, data) => events.push(['all', type, data]),
    emitOthers: (type, data) => events.push(['others', type, data]),
    reply: (type, data) => events.push(['reply', type, data]),
    sync: () => events.push(['sync']),
  };
}

test('wordle scoring handles repeated letters', () => {
  assert.deepEqual(guess._score('KALEM', 'KALEM'), ['g', 'g', 'g', 'g', 'g']);
  assert.deepEqual(guess._score('ABBEY', 'BABES'), ['y', 'y', 'g', 'g', 'x']);
  assert.deepEqual(guess._score('1122', '1213'), ['g', 'y', 'y', 'x']);
  assert.deepEqual(guess._score('SPEED', 'ABIDE'), ['x', 'x', 'y', 'x', 'y']);
});

test('guess normalises Turkish letters with the right locale', () => {
  assert.equal(guess._normalize('istanbul', 'word', 'tr'), 'İSTANBUL');
  assert.equal(guess._normalize('istanbul', 'word', 'en'), 'ISTANBUL');
  assert.equal(guess._normalize('çiçek', 'word', 'tr'), 'ÇİÇEK');
  assert.equal(guess._normalize('12a', 'number', 'tr'), null);
});

test('guess game plays simultaneous rounds and picks a winner', () => {
  const pids = ['a', 'b'];
  const state = guess.create({ mode: 'word', length: 4, lang: 'en', maxAttempts: 6 }, { players: pids });
  guess.actions.secret(state, { value: 'love' }, fakeCtx('a', pids));
  assert.equal(state.phase, 'setup');
  guess.actions.secret(state, { value: 'kiss' }, fakeCtx('b', pids));
  assert.equal(state.phase, 'play');

  // a guesses b's secret (KISS), b guesses a's (LOVE)
  guess.actions.guess(state, { value: 'miss' }, fakeCtx('a', pids));
  assert.equal(state.players.a.guesses.length, 0, 'round waits for both players');
  assert.equal(guess.view(state, 'b', pids).partner.submitted, true);
  guess.actions.guess(state, { value: 'dove' }, fakeCtx('b', pids));
  assert.deepEqual(state.players.a.guesses[0].marks, ['x', 'g', 'g', 'g']);
  assert.deepEqual(state.players.b.guesses[0].marks, ['x', 'g', 'g', 'g']);

  guess.actions.guess(state, { value: 'kiss' }, fakeCtx('a', pids));
  guess.actions.guess(state, { value: 'cove' }, fakeCtx('b', pids));
  assert.equal(state.players.a.solved, true);
  assert.equal(state.phase, 'play');
  // b keeps guessing alone now
  guess.actions.guess(state, { value: 'love' }, fakeCtx('b', pids));
  assert.equal(state.phase, 'over');
  assert.equal(guess.view(state, 'a', pids).result.won, true);
  assert.equal(guess.view(state, 'b', pids).result.lost, true);
  assert.equal(guess.view(state, 'b', pids).partner.secret, 'LOVE');
});

test('guess view never leaks the partner secret before the end', () => {
  const pids = ['a', 'b'];
  const state = guess.create({ mode: 'number', length: 4 }, { players: pids });
  guess.actions.secret(state, { value: '1234' }, fakeCtx('a', pids));
  guess.actions.secret(state, { value: '9876' }, fakeCtx('b', pids));
  const v = guess.view(state, 'a', pids);
  assert.equal(v.partner.secret, null);
  assert.ok(!JSON.stringify(v).includes('9876'));
});

test('bluetooth finishes when both type the same word', () => {
  const pids = ['a', 'b'];
  const state = bluetooth.create({ lang: 'tr' });
  bluetooth.actions.word(state, { word: 'Elma' }, fakeCtx('a', pids));
  bluetooth.actions.word(state, { word: 'Armut' }, fakeCtx('b', pids));
  assert.equal(state.rounds.length, 1);
  assert.equal(state.done, false);

  const ctx = fakeCtx('a', pids);
  bluetooth.actions.word(state, { word: 'elma' }, ctx);
  assert.deepEqual(ctx.events[0], ['reply', 'error', { code: 'used' }]);

  bluetooth.actions.word(state, { word: 'Meyve' }, fakeCtx('a', pids));
  assert.equal(bluetooth.view(state, 'b', pids).partnerReady, true);
  bluetooth.actions.word(state, { word: 'MEYVE' }, fakeCtx('b', pids));
  assert.equal(state.done, true);
  assert.equal(state.rounds.length, 2);
});

test('lego splits rows into bricks covering every stud', () => {
  for (let len = 1; len <= 14; len++) {
    for (const row of [0, 1]) {
      const sizes = lego._splitRun(len, row);
      assert.equal(sizes.reduce((a, b) => a + b, 0), len);
      assert.ok(sizes.every((s) => s >= 1 && s <= 4));
    }
  }
  for (const design of Object.keys(lego.DESIGNS)) {
    const state = lego.create({ design });
    const studs = lego.DESIGNS[design].join('').replace(/\./g, '').length;
    assert.equal(state.slots.reduce((n, s) => n + s.len, 0), studs, design);
  }
});

test('drag pieces: grab is exclusive and a near drop snaps into place', () => {
  const pids = ['a', 'b'];
  const puzzle = activities.get('puzzle');
  const state = puzzle.create({ difficulty: 'easy' }, { players: pids });
  assert.equal(state.pieces.length, 12);
  const piece = state.pieces[5];
  puzzle.actions.grab(state, { id: 5 }, fakeCtx('a', pids));
  assert.equal(piece.heldBy, 'a');

  const ctxB = fakeCtx('b', pids);
  puzzle.actions.grab(state, { id: 5 }, ctxB);
  assert.equal(piece.heldBy, 'a');
  assert.equal(ctxB.events[0][0], 'reply');

  const cw = state.board.w / state.cols;
  const ch = state.board.h / state.rows;
  const tx = state.board.x + piece.c * cw;
  const ty = state.board.y + piece.r * ch;
  puzzle.actions.drop(state, { id: 5, x: tx + 6, y: ty - 5 }, fakeCtx('a', pids));
  assert.equal(piece.placed, true);
  assert.equal(piece.x, tx);
  assert.equal(piece.heldBy, null);
});

test('lego bricks snap to any free slot of the same size and colour', () => {
  const pids = ['a'];
  const state = lego.create({ design: 'heart' });
  const piece = state.pieces[0];
  const twin = state.slots.find((s) => s.id !== piece.id && s.len === piece.len && s.color === piece.color);
  lego.actions.grab(state, { id: piece.id }, fakeCtx('a', pids));
  lego.actions.drop(state, { id: piece.id, x: twin.x + 3, y: twin.y + 3 }, fakeCtx('a', pids));
  assert.equal(piece.placed, true);
  assert.equal(twin.filled, piece.id);
});

test('paint rejects malformed operations', () => {
  const paint = activities.get('paint');
  const state = paint.create({ template: 'house' });
  const ctx = fakeCtx('a', ['a']);
  paint.actions.stroke(state, { color: 'red', size: 5, pts: [1, 2] }, ctx);
  paint.actions.stroke(state, { color: '#ff0000', size: 5, pts: ['x', 2] }, ctx);
  paint.actions.stroke(state, { color: '#ff0000', size: 500, pts: [1, 2, 3, 4] }, ctx);
  assert.equal(state.ops.length, 1);
  assert.equal(state.ops[0].w, 80);
});
