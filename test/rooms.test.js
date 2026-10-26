'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../server/index');

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function emit(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

test('two partners share a room and play bluetooth', async (t) => {
  const { httpServer, io } = createServer({ dataDir: require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'cp-')) });
  await new Promise((r) => httpServer.listen(0, r));
  const url = `http://localhost:${httpServer.address().port}`;
  const a = connect(url, { transports: ['websocket'] });
  const b = connect(url, { transports: ['websocket'] });
  const c = connect(url, { transports: ['websocket'] });
  t.after(() => {
    [a, b, c].forEach((s) => s.close());
    io.close();
    httpServer.close();
  });

  const created = await emit(a, 'room:create', { name: 'Ayşe', clientId: 'client-a' });
  assert.ok(created.ok);
  const { code } = created.room;

  const missing = await emit(b, 'room:join', { code: 'NOPE1', name: 'Mert', clientId: 'client-b' });
  assert.equal(missing.error, 'notFound');

  const joined = await emit(b, 'room:join', { code: code.toLowerCase(), name: 'Mert', clientId: 'client-b' });
  assert.ok(joined.ok);
  assert.equal(joined.room.players.length, 2);

  const full = await emit(c, 'room:join', { code, name: 'Third', clientId: 'client-c' });
  assert.equal(full.error, 'full');

  const stateA = once(a, 'activity:state');
  const stateB = once(b, 'activity:state');
  a.emit('room:select', { id: 'bluetooth', options: { lang: 'tr' } });
  assert.equal((await stateA).id, 'bluetooth');
  assert.equal((await stateB).state.hasPartner, true);

  a.emit('act', { type: 'word', data: { word: 'deniz' } });
  const ready = await once(b, 'activity:state');
  assert.equal(ready.state.partnerReady, true);

  const doneB = once(b, 'activity:state');
  b.emit('act', { type: 'word', data: { word: 'Deniz' } });
  const final = await doneB;
  assert.equal(final.state.done, true);
  assert.equal(final.state.rounds[0].theirs, 'deniz');

  // Partner drops off: their seat is freed for someone new.
  const update = once(a, 'room:update');
  b.close();
  const after = await update;
  assert.equal(after.players.filter((p) => p.online).length, 1);
  const third = await emit(c, 'room:join', { code, name: 'Third', clientId: 'client-c' });
  assert.ok(third.ok);
});
