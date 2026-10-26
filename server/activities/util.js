'use strict';

function clamp(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

function pick(arr, value, fallback) {
  return arr.includes(value) ? value : fallback;
}

function shuffle(arr, rand = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const LOCALES = { tr: 'tr-TR', en: 'en-US' };

function locale(lang) {
  return LOCALES[lang] || LOCALES.en;
}

/** Spread pieces over the left and right margins of the world, around the central board. */
function scatter(pieces, world, board, sizeOf, rand = Math.random) {
  const margin = 16;
  shuffle(pieces, rand).forEach((p, i) => {
    const { w, h, padX = 0, padTop = 0 } = sizeOf(p);
    const left = i % 2 === 0;
    const minX = left ? margin + padX : board.x + board.w + margin + padX;
    const maxX = left ? board.x - margin - w - padX : world.w - margin - w - padX;
    const minY = margin + padTop;
    const maxY = world.h - margin - h - padX;
    p.x = Math.round(minX + rand() * Math.max(0, maxX - minX));
    p.y = Math.round(minY + rand() * Math.max(0, maxY - minY));
  });
  pieces.sort((a, b) => a.id - b.id);
}

module.exports = { clamp, pick, shuffle, locale, scatter };
