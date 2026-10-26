import { el } from '../lib/ui.js';

export default {
  id: 'bluetooth',
  icon: '🔵',
  accent: '#2d7ff9',

  renderOptions(_container, { lang }) {
    return () => ({ lang });
  },

  mount(root, api) {
    let state = null;
    const view = el('div', { class: 'bt' });
    root.append(view);

    const input = el('input', { class: 'bt-input', maxlength: 30, autocomplete: 'off', placeholder: api.t('bt.ph') });
    const submit = () => {
      const word = input.value.trim();
      if (!word) return;
      api.send('word', { word });
      input.value = '';
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    const form = el('div', { class: 'bt-form' }, input,
      el('button', { type: 'button', class: 'btn btn-primary', text: api.t('bt.send'), onclick: submit }));

    function render() {
      if (!state) return;
      const partner = api.partner();
      const me = api.player(api.me);
      const nodes = [el('p', { class: 'lead center', text: api.t('bt.intro') })];
      const rounds = state.rounds;

      if (!state.hasPartner) {
        nodes.push(el('p', { class: 'status pulse', text: api.t('bt.waitPartner') }));
      } else if (state.done) {
        const last = rounds[rounds.length - 1];
        nodes.push(
          el('div', { class: 'bt-match' },
            el('div', { class: 'bt-orbs' }, el('span', { class: 'orb', style: { '--c': me?.color } }), el('span', { class: 'orb', style: { '--c': partner?.color } })),
            el('p', { class: 'status big win', text: api.t('bt.match', { n: rounds.length, w: last.mine }) })),
          el('button', { type: 'button', class: 'btn btn-primary', text: api.t('bt.again'), onclick: () => api.send('restart', {}) }),
        );
      } else {
        nodes.push(
          el('div', { class: 'bt-status' },
            el('span', { class: `bt-dot${state.myPending ? ' on' : ''}`, style: { '--c': me?.color } }),
            el('span', { class: 'bt-link' }),
            el('span', { class: `bt-dot${state.partnerReady ? ' on' : ''}`, style: { '--c': partner?.color } })),
          el('p', { class: 'status', text: state.myPending ? api.t('bt.yours', { w: state.myPending }) : api.t('bt.round', { n: rounds.length + 1 }) }),
          el('p', { class: `status${state.partnerReady ? '' : ' pulse'}`, text: state.partnerReady ? api.t('bt.ready') : api.t('bt.thinking') }),
          form,
        );
        if (rounds.length) nodes.push(el('p', { class: 'muted small center', text: api.t('bt.hint') }));
      }

      if (rounds.length) {
        nodes.push(el('div', { class: 'bt-history' },
          el('div', { class: 'bt-row bt-head' }, el('span'), el('span', { text: api.t('bt.you') }), el('span', { text: api.t('bt.partner') })),
          [...rounds].reverse().map((r, i) => el('div', { class: `bt-row${r.match ? ' match' : ''}` },
            el('span', { class: 'muted', text: `#${rounds.length - i}` }),
            el('span', { class: 'word', style: { '--c': me?.color }, text: r.mine }),
            el('span', { class: 'word', style: { '--c': partner?.color }, text: r.theirs })))));
      }
      const hadFocus = document.activeElement === input;
      view.replaceChildren(...nodes);
      if (hadFocus || (!state.done && state.hasPartner && !state.myPending)) input.focus({ preventScroll: true });
    }

    return {
      onState(s) {
        const wasDone = state && state.done;
        state = s;
        if (!wasDone && s.done && s.rounds.length) api.celebrate();
        render();
      },
      onEvent(type, data) {
        if (type === 'error') api.toast(api.t(data.code === 'used' ? 'bt.used' : 'bt.invalid'));
      },
      onPlayers() {
        render();
      },
    };
  },
};
