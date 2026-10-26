'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager } = require('./rooms');

function createServer() {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  const httpServer = http.createServer(app);
  // Custom puzzle photos are sent as data URLs, so allow a few MB per message.
  const io = new Server(httpServer, { maxHttpBufferSize: 4e6 });
  const rooms = new RoomManager(io);
  io.on('connection', (socket) => rooms.attach(socket));

  return { app, httpServer, io, rooms };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { httpServer } = createServer();
  httpServer.listen(port, () => {
    console.log(`CouplePlay running on http://localhost:${port}`);
  });
}

module.exports = { createServer };
