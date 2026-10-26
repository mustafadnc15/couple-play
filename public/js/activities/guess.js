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
    let currentRow = null; // the row being typed, updated in place while typing
    let shown = { me: 0, partner: 0 }; // guesses already revealed, so only new rows animate
    // Phones and tablets type with their own keyboard; desktops get the on-screen one too.
    const touch = window.matchMedia('(pointer: coarse)').matches;

    // Layout: [top: status + boards] [bar: persistent input] [bottom: keyboard / buttons].
    // The input bar is never re-created, so the phone keyboard stays open across updates.
    const top = el('div', { class: 'guess-top' });
    const bottom = el('div', { class: 'guess-bottom' });
    const input = el('input', {
      class: 'guess-input',
      autocomplete: 'off',
      autocorrect: 'off',
      autocapitalize: 'characters',
      spellcheck: 'false',
    });
    const barBtn = el('button', { type: 'submit', class: 'btn btn-primary' });
    const bar = el('form', { class: 'guess-bar', hidden: true }, input, barBtn);
    const view = el('div', { class: 'guess' }, top, bar, bottom);
    root.append(view);
    const kind = () => api.t(`guess.kind${state.mode}`);

    function clean(raw) {
      const s = String(raw || '').replace(/\s+/g, '');
      const chars = state.mode === 'number'
        ? s.replace(/\D/g, '')
        : Array.from(s.toLocaleUpperCase(LOCALE[state.lang])).filter((c) => /\p{L}/u.test(c)).join('');
      return Array.from(chars).slice(0, state.length).join('');
    }

    function canType() {
      return state && state.phase === 'play' && !state.me.solved && !state.me.pending
        && state.me.guesses.length < state.maxAttempts;
    }

    function updateCurrentRow() {
      if (!currentRow) return;
      const chars = Array.from(typed);
      [...currentRow.children].forEach((cell, i) => {
        cell.textContent = chars[i] || '';
        cell.classList.toggle('filled', Boolean(chars[i]));
      });
    }

    function submitGuess() {
      if (!canType() || Array.from(typed).length !== state.length) return;
      api.send('guess', { value: typed });
      typed = '';
      input.value = '';
      updateCurrentRow();
    }

    /* ----- on-screen keyboard and physical keys (desktop) ----- */

    function press(key) {
      if (!canType()) return;
      if (key === 'ENTER') return submitGuess();
      if (key === 'BACK') typed = Array.from(typed).slice(0, -1).join('');
      else if (Array.from(typed).length < state.length) typed += key;
      updateCurrentRow();
    }

    function onKeydown(e) {
      const inField = (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        && !(e.target === input && bar.hidden); // our own hidden bar input doesn't count
      if (touch || inField || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') press('ENTER');
      else if (e.key === 'Backspace') press('BACK');
      else {
        const k = e.key.length === 1 ? clean(e.key) : '';
        if (k) press(k);
        else return;
      }
      e.preventDefault();
    }
    document.addEventListener('keydown', onKeydown);

    /* ----- input bar (secret word everywhere, guesses on phones) ----- */

    input.addEventListener('input', () => {
      const v = clean(input.value);
      if (v !== input.value) input.value = v;
      if (state.phase === 'play') {
        typed = v;
        updateCurrentRow();
      }
    });
    input.addEventListener('focus', () => {
      // Keep the board and the box visible above the phone keyboard.
      setTimeout(() => bar.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300);
    });
    // Tapping the button must not take focus from the input, or the phone keyboard closes.
    barBtn.addEventListener('pointerdown', (e) => e.preventDefault());
    bar.addEventListener('submit', (e) => {
      e.preventDefault();
      if (state.phase === 'setup') {
        const value = clean(input.value);
        if (Array.from(value).length === state.length) api.send('secret', { value });
        else api.toast(api.t('guess.invalid'));
      } else {
        submitGuess();
      }
    });

    function configureBar() {
      const setup = state.hasPartner && state.phase === 'setup' && !state.me.secret;
      const playing = touch && state.phase === 'play' && !state.me.solved && state.me.guesses.length < state.maxAttempts;
      const visible = setup || playing;
      if (bar.hidden !== !visible) bar.hidden = !visible;
      if (!visible) {
        if (document.activeElement === input) input.blur(); // let physical keys reach the board
        return;
      }
      const mode = setup ? 'setup' : 'play';
      if (bar.dataset.mode !== mode) {
        bar.dataset.mode = mode;
        input.value = '';
        typed = '';
      }
      input.maxLength = state.length;
      input.inputMode = state.mode === 'number' ? 'numeric' : 'text';
      input.setAttribute('enterkeyhint', setup ? 'done' : 'send');
      const waiting = !setup && Boolean(state.me.pending);
      input.readOnly = waiting;
      input.placeholder = waiting ? api.t('guess.submitted') : '•'.repeat(state.length);
      barBtn.textContent = setup ? api.t('guess.confirm') : api.t('guess.send');
      barBtn.disabled = waiting;
    }

    /* ----- rendering ----- */

    function row(letters, marks, cls = '') {
      const chars = Array.from(letters || '');
      return el('div', { class: `g-row ${cls}` }, Array.from({ length: state.length }, (_, i) => el('div', {
        class: `g-cell${marks ? ` m-${marks[i]}` : ''}${chars[i] ? ' filled' : ''}`,
        style: cls.includes('reveal') ? { animationDelay: `${i * 90}ms` } : undefined,
        text: chars[i] || '',
      })));
    }

    function boardFor(guesses, extraRow, who) {
      const rows = guesses.map((g, i) => row(g.guess, g.marks, i >= shown[who] ? 'reveal' : ''));
      shown[who] = guesses.length;
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

    function render() {
      if (!state) return;
      currentRow = null;
      configureBar();
      if (!state.hasPartner) {
        top.replaceChildren(el('p', { class: 'status pulse', text: api.t('guess.waitPartner') }));
        bottom.replaceChildren();
        return;
      }
      const partnerStatus = el('p', {
        class: `status${state.partner.secretSet ? '' : ' pulse'}`,
        text: state.partner.secretSet ? api.t('guess.partnerReady') : api.t('guess.partnerChoosing', { kind: kind() }),
      });
      if (state.phase === 'setup') {
        top.replaceChildren(el('p', {
          class: 'lead center',
          text: state.me.secret
            ? api.t('guess.secretSet', { kind: kind(), secret: state.me.secret })
            : api.t('guess.setSecret', { kind: kind(), n: state.length, unit: api.t(`guess.unit${state.mode}`) }),
        }));
        bottom.replaceChildren(partnerStatus);
        view.classList.add('setup');
        return;
      }
      view.classList.remove('setup');

      const { me, partner } = state;
      let current = null;
      if (state.phase === 'play' && !me.solved && me.guesses.length < state.maxAttempts) {
        current = me.pending ? row(me.pending, null, 'pending') : row(typed, null, 'current');
        if (!me.pending) currentRow = current;
      }
      const over = state.phase === 'over';
      const myCol = el('div', { class: 'board-col' }, el('h3', { text: api.t('guess.yourBoard') }), boardFor(me.guesses, current, 'me'));
      const partnerCol = el('div', { class: 'board-col partner-col' },
        el('h3', { text: api.t('guess.theirBoard', { kind: kind() }) }),
        el('p', { class: 'secret-chip', text: me.secret }),
        boardFor(partner.guesses, null, 'partner'));
      // replaceChildren would print null as text, so drop the empty slots first.
      // Desktop: boards side by side above the keyboard. Phones: your board, then the input box,
      // then your partner's board, so the row you type into stays next to the box.
      top.replaceChildren(...[
        el('p', { class: `status big${over && state.result.won ? ' win' : ''}`, text: statusText() }),
        over ? el('p', { class: 'reveal-text', text: api.t('guess.reveal', { kind: kind(), secret: partner.secret }) }) : null,
        touch ? myCol : el('div', { class: 'boards' }, myCol, partnerCol),
      ].filter(Boolean));
      bottom.replaceChildren(...[
        over ? el('button', { type: 'button', class: 'btn btn-primary', text: api.t('guess.again'), onclick: () => api.send('restart', {}) }) : null,
        !over && !touch ? keyboard() : null,
        touch ? partnerCol : null,
        el('p', { class: 'muted small center', text: api.t('guess.legend') }),
      ].filter(Boolean));
    }

    return {
      onState(s) {
        const prev = state;
        state = s;
        if (prev && prev.phase === 'play' && s.phase === 'over' && s.result.won) api.celebrate();
        if (!prev || s.phase === 'setup') shown = { me: s.me.guesses.length, partner: s.partner ? s.partner.guesses.length : 0 };
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
