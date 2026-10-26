'use strict';

const { clamp } = require('./util');

/**
 * Shared real-time drag & drop logic for "move pieces into the board" activities
 * (puzzle, lego). `snap(state, piece)` returns the target {x, y} to lock the piece
 * into, or null when the drop is not close enough.
 */
function pieceView(p) {
  return { id: p.id, x: p.x, y: p.y, placed: p.placed, heldBy: p.heldBy, z: p.z };
}

function release(state, pid, ctx) {
  for (const p of state.pieces) {
    if (p.heldBy === pid) {
      p.heldBy = null;
      if (ctx) ctx.emitAll('piece', pieceView(p));
    }
  }
}

function dragActions(snap) {
  return {
    grab(state, data, ctx) {
      const piece = state.pieces[data.id | 0];
      if (!piece) return;
      if (piece.placed || (piece.heldBy && piece.heldBy !== ctx.pid)) {
        ctx.reply('piece', pieceView(piece)); // tell the grabber it lost the race
        return;
      }
      for (const other of state.pieces) {
        if (other !== piece && other.heldBy === ctx.pid) {
          other.heldBy = null;
          ctx.emitAll('piece', pieceView(other));
        }
      }
      piece.heldBy = ctx.pid;
      piece.z = ++state.z;
      ctx.emitAll('piece', pieceView(piece));
    },

    move(state, data, ctx) {
      const piece = state.pieces[data.id | 0];
      if (!piece || piece.heldBy !== ctx.pid) return;
      piece.x = clamp(data.x, -200, state.world.w);
      piece.y = clamp(data.y, -200, state.world.h);
      ctx.emitOthers('piece', { id: piece.id, x: piece.x, y: piece.y }, true);
    },

    drop(state, data, ctx) {
      const piece = state.pieces[data.id | 0];
      if (!piece || piece.heldBy !== ctx.pid) return;
      piece.x = clamp(data.x, -200, state.world.w);
      piece.y = clamp(data.y, -200, state.world.h);
      piece.heldBy = null;
      const target = snap(state, piece);
      if (target) {
        piece.x = target.x;
        piece.y = target.y;
        piece.placed = true;
      }
      ctx.emitAll('piece', pieceView(piece));
      if (target && !state.completed && state.pieces.every((p) => p.placed)) {
        state.completed = true;
        ctx.emitAll('complete', {});
      }
    },
  };
}

module.exports = { dragActions, release, pieceView };
