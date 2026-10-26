import { el, choiceField } from '../lib/ui.js';

const LAYOUTS = {
  tr: ['ERTYUIOPĞÜ', 'ASDFGHJKLŞİ', 'ZCVBNMÖÇ'],
  en: ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'],
  number: ['1234567890'],
};
const RANK = { g: 3, y: 2, x: 1 };
const LOCALE = { tr: 'tr-TR', en: 'en-US' };

export default {
  id: 'guess',
  icon: '🔤',
  accent: '#2bb24c',

  renderOptions(container, { t, lang }) {
    const mode = choiceField(t('opt.mode'), [
      { value: 'word', label: `🔤 ${t('opt.word')}` },
      { value: 'number', label: `🔢 ${t('opt.number')}` },
    ], 'word');
    const length = choiceField(t('opt.length'), [3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) })), '5');
    const wordLang = choiceField(t('opt.lang'), [
      { value: 'tr', label: t('opt.tr') },
      { value: 'en', label: t('opt.en') },
    ], lang);
    const attempts = choiceField(t('opt.attempts'), [6, 8, 10].map((n) => ({ value: String(n), label: String(n) })), '8');
    const syncFields = () => {
      const isWord = mode.get() === 'word';
      wordLang.node.hidden = !isWord;
      const three = length.group.querySelector('[data-value="3"]');
      three.disabled = isWord;
      if (isWord && length.get() === '3') length.set('4');
    };
    mode.group.addEventListener('click', syncFields);
    syncFields();
    container.append(mode.node, length.node, wordLang.node, attempts.node);
    return () => ({ mode: mode.get(), length: Number(length.get()), lang: wordLang.get(), maxAttempts: Number(attempts.get()) });
  },

  mount(root, api) {
    let state = null;
    let typed = '';
    const view = el('div', { class: 'guess' });
    root.append(view);
    const kind = () => api.t(`guess.kind${state.mode}`);

    function normalizeKey(key) {
      if (state.mode === 'number') return /^\d$/.test(key) ? key : null;
      const up = key.toLocaleUpperCase(LOCALE[state.lang]);
      return /^\p{L}$/u.test(up) ? up : null;
    }

    function canType() {
      return state && state.phase === 'play' && !state.me.solved && !state.me.pending
        && state.me.guesses.length < state.maxAttempts;
    }

    function press(key) {
      if (!canType()) return;
      if (key === 'ENTER') {
        if (Array.from(typed).length === state.length) {
          api.send('guess', { value: typed });
          typed = '';
        }
      } else if (key === 'BACK') {
        typed = Array.from(typed).slice(0, -1).join('');
      } else if (Array.from(typed).length < state.length) {
        typed += key;
      }
      render();
    }

    function onKeydown(e) {
      if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') press('ENTER');
      else if (e.key === 'Backspace') press('BACK');
      else {
        const k = e.key.length === 1 ? normalizeKey(e.key) : null;
        if (k) press(k);
        else return;
      }
      e.preventDefault();
    }
    document.addEventListener('keydown', onKeydown);

    function row(letters, marks, cls = '') {
      const chars = Array.from(letters || '');
      return el('div', { class: `g-row ${cls}` }, Array.from({ length: state.length }, (_, i) => el('div', {
        class: `g-cell${marks ? ` m-${marks[i]}` : ''}${chars[i] ? ' filled' : ''}`,
        style: marks ? { animationDelay: `${i * 90}ms` } : undefined,
        text: chars[i] || '',
      })));
    }

    function boardFor(guesses, extraRow) {
      const rows = guesses.map((g) => row(g.guess, g.marks));
      if (extraRow) rows.push(extraRow);
      while (rows.length < state.maxAttempts) rows.push(row(''));
      return el('div', { class: 'g-board' }, rows.slice(0, state.maxAttempts));
    }

    function keyboard() {
      const best = {};
      for (const g of state.me.guesses) {
        Array.from(g.guess).forEach((ch, i) => {
          if (!best[ch] || RANK[g.marks[i]] > RANK[best[ch]]) best[ch] = g.marks[i];
        });
      }
      const rows = state.mode === 'number' ? LAYOUTS.number : LAYOUTS[state.lang];
      const key = (k, label = k, cls = '') => el('button', {
        type: 'button',
        class: `key ${cls}${best[k] ? ` m-${best[k]}` : ''}`,
        text: label,
        onclick: () => press(k),
      });
      return el('div', { class: 'keyboard' },
        rows.map((r, i) => el('div', { class: 'key-row' },
          i === rows.length - 1 ? key('ENTER', '↵', 'wide') : null,
          Array.from(r).map((k) => key(k)),
          i === rows.length - 1 ? key('BACK', '⌫', 'wide') : null)));
    }

    function renderSetup() {
      const nodes = [];
      if (!state.me.secret) {
        const input = el('input', {
          class: 'secret-input',
          maxlength: state.length,
          inputmode: state.mode === 'number' ? 'numeric' : 'text',
          autocomplete: 'off',
          autocapitalize: 'characters',
          spellcheck: 'false',
        });
        const submit = () => {
          const value = input.value.trim();
          if (value) api.send('secret', { value });
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
        nodes.push(
          el('p', { class: 'lead', text: api.t('guess.setSecret', { kind: kind(), n: state.length, unit: api.t(`guess.unit${state.mode}`) }) }),
          el('div', { class: 'secret-row' }, input, el('button', { type: 'button', class: 'btn btn-primary', text: api.t('guess.confirm'), onclick: submit })),
        );
        setTimeout(() => {
          const active = document.activeElement;
          if (!active || active === document.body) input.focus();
        }, 50);
      } else {
        nodes.push(el('p', { class: 'lead', text: api.t('guess.secretSet', { kind: kind(), secret: state.me.secret }) }));
      }
      nodes.push(el('p', {
        class: `status${state.partner.secretSet ? '' : ' pulse'}`,
        text: state.partner.secretSet ? api.t('guess.partnerReady') : api.t('guess.partnerChoosing', { kind: kind() }),
      }));
      return el('div', { class: 'card guess-setup' }, nodes);
    }

    function statusText() {
      const { me, partner } = state;
      if (state.phase === 'over') {
        const r = state.result;
        if (r.won) return api.t('guess.won');
        if (r.lost) return api.t('guess.lost');
        if (r.tie) return api.t('guess.tie');
        return api.t('guess.nobody');
      }
      if (me.solved) return `${api.t('guess.solved')} ${api.t('guess.waitOther')}`;
      if (me.pending) return api.t('guess.submitted');
      if (partner.submitted) return api.t('guess.partnerSubmitted');
      return api.t('guess.round', { n: state.round });
    }

    function renderPlay() {
      const { me, partner } = state;
      let current = null;
      if (state.phase === 'play' && !me.solved && me.guesses.length < state.maxAttempts) {
        current = me.pending ? row(me.pending, null, 'pending') : row(typed, null, 'current');
      }
      const over = state.phase === 'over';
      return el('div', { class: 'guess-play' },
        el('p', { class: `status big${over && state.result.won ? ' win' : ''}`, text: statusText() }),
        over ? el('p', { class: 'reveal', text: api.t('guess.reveal', { kind: kind(), secret: partner.secret }) }) : null,
        el('div', { class: 'boards' },
          el('div', { class: 'board-col' }, el('h3', { text: api.t('guess.yourBoard') }), boardFor(me.guesses, current)),
          el('div', { class: 'board-col partner-col' },
            el('h3', { text: api.t('guess.theirBoard', { kind: kind() }) }),
            el('p', { class: 'secret-chip', text: me.secret }),
            boardFor(partner.guesses, null))),
        over
          ? el('button', { type: 'button', class: 'btn btn-primary', text: api.t('guess.again'), onclick: () => api.send('restart', {}) })
          : keyboard(),
        el('p', { class: 'muted small', text: api.t('guess.legend') }));
    }

    function render() {
      if (!state) return;
      let content;
      if (!state.hasPartner) content = el('p', { class: 'status pulse', text: api.t('guess.waitPartner') });
      else if (state.phase === 'setup') content = renderSetup();
      else content = renderPlay();
      view.replaceChildren(content);
    }

    return {
      onState(s) {
        const prev = state;
        state = s;
        if (prev && prev.phase === 'play' && s.phase === 'over' && s.result.won) api.celebrate();
        render();
      },
      onEvent(type, data) {
        if (type === 'error' && data.code === 'invalid') api.toast(api.t('guess.invalid'));
      },
      onPlayers() {
        render();
      },
      destroy() {
        document.removeEventListener('keydown', onKeydown);
      },
    };
  },
};
