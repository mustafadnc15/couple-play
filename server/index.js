'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager } = require('./rooms');
const { PhotoLibrary } = require('./photos');

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 10;

/** Constant-time password check (hashing first makes the lengths equal). */
function samePassword(given, expected) {
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Admin routes are enabled only when an admin password is configured. Failed logins are
 * limited per IP to slow down guessing.
 */
function adminAuth(password) {
  const failures = new Map(); // ip -> { count, since }
  return (req, res, next) => {
    if (!password) return res.status(503).json({ error: 'disabled' });
    const now = Date.now();
    const ip = req.ip;
    const f = failures.get(ip);
    if (f && now - f.since > LOGIN_WINDOW_MS) failures.delete(ip);
    if (failures.get(ip)?.count >= MAX_FAILED_LOGINS) return res.status(429).json({ error: 'tooMany' });
    // The password is URL-encoded by the client so non-ASCII (e.g. Turkish) characters survive the header.
    const header = req.get('authorization') || '';
    let given = '';
    try {
      given = header.startsWith('Bearer ') ? decodeURIComponent(header.slice(7)) : '';
    } catch { /* malformed encoding counts as a wrong password */ }
    if (!given || !samePassword(given, password)) {
      const entry = failures.get(ip) || { count: 0, since: now };
      entry.count++;
      failures.set(ip, entry);
      return res.status(401).json({ error: 'unauthorized' });
    }
    failures.delete(ip);
    next();
  };
}

function createServer(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const adminPassword = options.adminPassword ?? process.env.ADMIN_PASSWORD ?? '';
  const photos = new PhotoLibrary(dataDir);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind the hosting provider's proxy, so req.ip is the visitor
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Picture library shared by the jigsaw and paint-by-number activities.
  app.get('/api/photos', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json(photos.list().map(({ id, url, title, bundled }) => ({ id, url, title, bundled })));
  });
  // Only files the library generated itself (u-<hex>.<ext>) are served from the upload folder.
  app.use('/uploads/photos', (req, res, next) => {
    if (!/^\/u-[0-9a-f]{16}\.(jpg|png|webp)$/.test(req.path)) return res.status(404).end();
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  }, express.static(photos.dir, { index: false, maxAge: '30d', immutable: true }));

  const admin = express.Router();
  admin.use(adminAuth(adminPassword));
  admin.get('/check', (_req, res) => res.json({ ok: true }));
  admin.post('/photos', express.json({ limit: '12mb' }), (req, res) => {
    try {
      res.status(201).json(photos.add(req.body && req.body.data, req.body && req.body.title));
    } catch (err) {
      if (!err.code) throw err;
      res.status(err.code === 'full' ? 409 : 400).json({ error: err.code });
    }
  });
  admin.delete('/photos/:id', (req, res) => {
    if (!photos.remove(req.params.id)) return res.status(404).json({ error: 'notFound' });
    res.json({ ok: true });
  });
  app.use('/api/admin', admin);
  app.get('/api/admin-enabled', (_req, res) => res.json({ enabled: Boolean(adminPassword) }));

  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'tooBig' });
    console.error(err);
    res.status(500).json({ error: 'server' });
  });

  const httpServer = http.createServer(app);
  // Custom puzzle photos are sent as data URLs, so allow a few MB per message.
  const io = new Server(httpServer, { maxHttpBufferSize: 4e6 });
  const rooms = new RoomManager(io, { photos });
  io.on('connection', (socket) => rooms.attach(socket));

  return { app, httpServer, io, rooms, photos };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { httpServer } = createServer();
  httpServer.listen(port, () => {
    console.log(`CouplePlay running on http://localhost:${port}`);
    if (!process.env.ADMIN_PASSWORD) console.log('Photo uploads (/admin) are disabled: set ADMIN_PASSWORD to enable them.');
  });
}

module.exports = { createServer };
