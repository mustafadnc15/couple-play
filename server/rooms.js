'use strict';

const crypto = require('crypto');
const activities = require('./activities');

const MAX_PLAYERS = 2;
const COLORS = ['#ff4f81', '#6c63ff'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // drop rooms nobody has used for 6 hours
const REACTIONS = ['❤️', '😘', '😂', '🥰', '👏', '🔥'];

function randomCode(len = 5) {
  const bytes = crypto.randomBytes(len);
  let code = '';
  for (let i = 0; i < len; i++) code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return code;
}

function cleanName(name) {
  const s = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return s || 'Player';
}

function cleanCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.sweepTimer = setInterval(() => this.sweep(), 10 * 60 * 1000);
    this.sweepTimer.unref();
  }

  createRoom() {
    let code;
    do code = randomCode(); while (this.rooms.has(code));
    const room = { code, players: new Map(), activity: null, emptySince: Date.now() };
    this.rooms.set(code, room);
    return room;
  }

  sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.emptySince && now - room.emptySince > ROOM_TTL_MS) this.rooms.delete(code);
    }
  }

  roomView(room) {
    return {
      code: room.code,
      players: [...room.players.values()].map((p) => ({
        pid: p.pid, name: p.name, color: p.color, online: p.online,
      })),
      activity: room.activity ? room.activity.id : null,
    };
  }

  broadcastRoom(room) {
    this.io.to(room.code).emit('room:update', this.roomView(room));
  }

  playerPids(room) {
    return [...room.players.values()].map((p) => p.pid);
  }

  /** Send each online player its own view of the running activity. */
  syncActivity(room, onlyPlayer) {
    if (!room.activity) return;
    const mod = activities.get(room.activity.id);
    for (const p of room.players.values()) {
      if (!p.online || (onlyPlayer && p !== onlyPlayer)) continue;
      const state = mod.view ? mod.view(room.activity.state, p.pid, this.playerPids(room)) : room.activity.state;
      this.io.to(p.socketId).emit('activity:state', { id: room.activity.id, gen: room.activity.gen, state });
    }
  }

  makeCtx(room, player, socket) {
    return {
      pid: player.pid,
      players: this.playerPids(room),
      emitAll: (type, data) => this.io.to(room.code).emit('activity:event', { type, data }),
      emitOthers: (type, data, volatile = false) => {
        const target = volatile ? socket.volatile.to(room.code) : socket.to(room.code);
        target.emit('activity:event', { type, data });
      },
      reply: (type, data) => socket.emit('activity:event', { type, data }),
      sync: () => this.syncActivity(room),
    };
  }

  lookup(socket) {
    const { code, clientId } = socket.data || {};
    const room = code && this.rooms.get(code);
    const player = room && room.players.get(clientId);
    if (!room || !player || player.socketId !== socket.id) return {};
    return { room, player };
  }

  join(socket, room, name, clientId) {
    let player = room.players.get(clientId);
    if (!player) {
      if (room.players.size >= MAX_PLAYERS) {
        // A full room only accepts someone new if a seat is empty (its player is offline).
        const offline = [...room.players.entries()].find(([, p]) => !p.online);
        if (!offline) return { error: 'full' };
        room.players.delete(offline[0]);
        player = offline[1];
        player.clientId = clientId;
      } else {
        const used = new Set([...room.players.values()].map((p) => p.color));
        player = {
          pid: crypto.randomBytes(6).toString('hex'),
          clientId,
          color: COLORS.find((c) => !used.has(c)) || COLORS[0],
        };
      }
      room.players.set(clientId, player);
    }

    // The same browser opened the room twice: the newest tab wins.
    if (player.online && player.socketId && player.socketId !== socket.id) {
      const old = this.io.sockets.sockets.get(player.socketId);
      if (old) {
        old.leave(room.code);
        old.data = {};
        old.emit('room:kicked');
      }
    }

    this.leaveCurrent(socket);
    player.name = cleanName(name);
    player.socketId = socket.id;
    player.online = true;
    room.emptySince = null;
    socket.join(room.code);
    socket.data = { code: room.code, clientId };
    return { player };
  }

  leaveCurrent(socket) {
    const { room, player } = this.lookup(socket);
    if (!room) return;
    socket.leave(room.code);
    socket.data = {};
    this.markOffline(room, player);
  }

  markOffline(room, player) {
    player.online = false;
    if (room.activity) {
      const mod = activities.get(room.activity.id);
      if (mod.onLeave) {
        mod.onLeave(room.activity.state, player.pid, {
          pid: player.pid,
          players: this.playerPids(room),
          emitAll: (type, data) => this.io.to(room.code).emit('activity:event', { type, data }),
          sync: () => this.syncActivity(room),
        });
      }
    }
    if (![...room.players.values()].some((p) => p.online)) room.emptySince = Date.now();
    this.broadcastRoom(room);
  }

  attach(socket) {
    const ack = (fn) => (typeof fn === 'function' ? fn : () => {});

    const enter = (room, payload, reply) => {
      const clientId = String((payload && payload.clientId) || '').slice(0, 64);
      if (!clientId) return reply({ ok: false, error: 'badRequest' });
      const res = this.join(socket, room, payload.name, clientId);
      if (res.error) return reply({ ok: false, error: res.error });
      reply({ ok: true, me: res.player.pid, room: this.roomView(room) });
      this.broadcastRoom(room);
      // Activities with per-player views depend on who is in the room, so refresh everyone.
      const mod = room.activity && activities.get(room.activity.id);
      this.syncActivity(room, mod && mod.view ? undefined : res.player);
    };

    socket.on('room:create', (payload, fn) => {
      enter(this.createRoom(), payload || {}, ack(fn));
    });

    socket.on('room:join', (payload, fn) => {
      const room = this.rooms.get(cleanCode(payload && payload.code));
      if (!room) return ack(fn)({ ok: false, error: 'notFound' });
      enter(room, payload, ack(fn));
    });

    socket.on('room:leave', () => this.leaveCurrent(socket));

    socket.on('room:select', (payload) => {
      const { room, player } = this.lookup(socket);
      if (!room) return;
      const mod = activities.get(payload && payload.id);
      if (!mod) return;
      try {
        const state = mod.create((payload && payload.options) || {}, { players: this.playerPids(room), pid: player.pid });
        room.activity = { id: mod.id, gen: (room.gen = (room.gen || 0) + 1), state };
      } catch (err) {
        console.error('activity create failed', err);
        return;
      }
      this.broadcastRoom(room);
      this.syncActivity(room);
    });

    socket.on('room:sync', () => {
      const { room, player } = this.lookup(socket);
      if (room) this.syncActivity(room, player);
    });

    socket.on('room:lobby', () => {
      const { room } = this.lookup(socket);
      if (!room || !room.activity) return;
      room.activity = null;
      this.broadcastRoom(room);
    });

    socket.on('act', (msg) => {
      const { room, player } = this.lookup(socket);
      if (!room || !room.activity || !msg) return;
      const mod = activities.get(room.activity.id);
      const handler = mod.actions && Object.prototype.hasOwnProperty.call(mod.actions, msg.type) && mod.actions[msg.type];
      if (typeof handler !== 'function') return;
      try {
        handler(room.activity.state, msg.data || {}, this.makeCtx(room, player, socket));
      } catch (err) {
        console.error(`activity ${mod.id}.${msg.type} failed`, err);
      }
    });

    socket.on('cursor', (pos) => {
      const { room, player } = this.lookup(socket);
      if (!room || !pos) return;
      const x = Number(pos.x);
      const y = Number(pos.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      socket.volatile.to(room.code).emit('cursor', { pid: player.pid, x, y });
    });

    socket.on('react', (payload) => {
      const { room, player } = this.lookup(socket);
      if (!room || !payload || !REACTIONS.includes(payload.emoji)) return;
      this.io.to(room.code).emit('react', { pid: player.pid, emoji: payload.emoji });
    });

    socket.on('disconnect', () => {
      const { room, player } = this.lookup(socket);
      if (room) this.markOffline(room, player);
    });
  }
}

module.exports = { RoomManager, MAX_PLAYERS, REACTIONS };
