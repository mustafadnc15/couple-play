'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../server/index');
const puzzle = require('../server/activities/puzzle');

// Smallest valid PNG (1×1 pixel).
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function start(t, adminPassword) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-photos-'));
  const server = createServer({ dataDir, adminPassword });
  await new Promise((r) => server.httpServer.listen(0, r));
  const base = `http://localhost:${server.httpServer.address().port}`;
  t.after(() => {
    server.io.close();
    server.httpServer.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const call = (method, url, { body, password } = {}) => fetch(base + url, {
    method,
    headers: { ...(password ? { Authorization: `Bearer ${encodeURIComponent(password)}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ...server, base, call, dataDir };
}

test('uploads are disabled without an admin password', async (t) => {
  const { call } = await start(t, '');
  assert.equal((await (await call('GET', '/api/admin-enabled')).json()).enabled, false);
  assert.equal((await call('POST', '/api/admin/photos', { body: { data: PNG }, password: 'x' })).status, 503);
});

test('admin can upload a photo that both activities can use, then delete it', async (t) => {
  const { call, photos, dataDir } = await start(t, 'gizli-şifre');

  assert.equal((await call('POST', '/api/admin/photos', { body: { data: PNG } })).status, 401);
  assert.equal((await call('POST', '/api/admin/photos', { body: { data: PNG }, password: 'wrong' })).status, 401);
  assert.equal((await call('GET', '/api/admin/check', { password: 'gizli-şifre' })).status, 200);

  const bad = await call('POST', '/api/admin/photos', { body: { data: 'data:image/png;base64,aGVsbG8gd29ybGQhISEhISEhIQ==' }, password: 'gizli-şifre' });
  assert.equal(bad.status, 400, 'content must really be an image');

  const res = await call('POST', '/api/admin/photos', { body: { data: PNG, title: { tr: 'Deniz kenarı', en: '' } }, password: 'gizli-şifre' });
  assert.equal(res.status, 201);
  const added = await res.json();
  assert.match(added.id, /^u-[0-9a-f]{16}$/);
  assert.deepEqual(added.title, { tr: 'Deniz kenarı', en: 'Deniz kenarı' });

  const list = await (await call('GET', '/api/photos')).json();
  assert.equal(list[0].id, added.id, 'uploads come first');
  assert.ok(list.some((p) => p.bundled), 'bundled photos are still listed');

  const img = await call('GET', added.url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await call('GET', '/uploads/photos/index.json')).status, 404, 'library index is not served');

  // The puzzle accepts the uploaded photo by id, and the upload survives a restart.
  const state = puzzle.create({ image: { kind: 'photo', id: added.id, aspect: 1 } }, { photos });
  assert.equal(state.image.url, added.url);
  const { PhotoLibrary } = require('../server/photos');
  assert.ok(new PhotoLibrary(dataDir).get(added.id));

  assert.equal((await call('DELETE', `/api/admin/photos/${added.id}`, { password: 'gizli-şifre' })).status, 200);
  assert.equal((await call('GET', added.url)).status, 404);
  assert.ok(!(await (await call('GET', '/api/photos')).json()).some((p) => p.id === added.id));
});

test('repeated wrong passwords are locked out', async (t) => {
  const { call } = await start(t, 'secret');
  for (let i = 0; i < 10; i++) await call('GET', '/api/admin/check', { password: `guess${i}` });
  assert.equal((await call('GET', '/api/admin/check', { password: 'secret' })).status, 429);
});
