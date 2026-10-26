'use strict';

const { pick, locale } = require('./util');

/**
 * "Bluetooth" (a.k.a. mind meld): both partners type a word at the same time; words are revealed
 * together and the round repeats until both type the same word. Words already used can't be reused.
 */

function clean(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 30 || !/^[\p{L}\p{N}' -]+$/u.test(s)) return null;
  return s;
}

function key(word, lang) {
  return word.toLocaleLowerCase(locale(lang));
}

function create(options) {
  return { lang: pick(['tr', 'en'], options.lang, 'tr'), rounds: [], pending: {}, used: [], done: false };
}

function view(state, pid, roomPids) {
  const partner = roomPids.find((p) => p !== pid) || null;
  return {
    hasPartner: Boolean(partner),
    done: state.done,
    rounds: state.rounds.map((r) => ({ mine: r.words[pid] || '', theirs: (partner && r.words[partner]) || '', match: r.match })),
    myPending: state.pending[pid] || null,
    partnerReady: Boolean(partner && state.pending[partner]),
  };
}

module.exports = {
  id: 'bluetooth',
  create,
  view,
  actions: {
    word(state, data, ctx) {
      if (state.done) return;
      const word = clean(data.word);
      if (!word) return ctx.reply('error', { code: 'invalid' });
      if (state.used.includes(key(word, state.lang))) return ctx.reply('error', { code: 'used' });
      state.pending[ctx.pid] = word;
      const pids = ctx.players.slice(0, 2);
      if (pids.length === 2 && pids.every((p) => state.pending[p])) {
        const [a, b] = pids.map((p) => state.pending[p]);
        const match = key(a, state.lang) === key(b, state.lang);
        state.rounds.push({ words: { ...state.pending }, match });
        for (const w of [a, b]) {
          const k = key(w, state.lang);
          if (!state.used.includes(k)) state.used.push(k);
        }
        state.pending = {};
        state.done = match;
      }
      ctx.sync();
    },
    restart(state, _data, ctx) {
      Object.assign(state, create({ lang: state.lang }));
      ctx.sync();
    },
  },
  _clean: clean,
};
