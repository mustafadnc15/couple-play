/**
 * Room chat: a 💬 button (with unread badge) that opens a panel available in the lobby and during
 * every activity. Shows a short preview of new messages while the panel is closed and a
 * "typing…" line while the partner types.
 */
import { el } from './lib/ui.js';

const TYPING_SEND_EVERY = 2000;
const TYPING_IDLE = 3000;
const TYPING_SHOW_FOR = 4500;

export function createChat({ socket, t, getLang, me, player }) {
  let messages = [];
  let open = false;
  let unread = 0;
  let typingSentAt = 0;
  let typingIdle = null;
  let typingHide = null;
  let previewHide = null;

  const badge = el('span', { class: 'chat-badge', hidden: true });
  const toggle = el('button', { type: 'button', class: 'chat-toggle', 'aria-expanded': 'false' }, el('span', { text: '💬' }), badge);
  const list = el('div', { class: 'chat-list', role: 'log', 'aria-live': 'polite' });
  const typingLine = el('div', { class: 'chat-typing', hidden: true });
  const input = el('input', { class: 'chat-input', maxlength: 500, autocomplete: 'off', enterkeyhint: 'send' });
  const sendBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-sm chat-send', text: '➤' });
  const form = el('form', { class: 'chat-form' }, input, sendBtn);
  const title = el('h3');
  const closeBtn = el('button', { type: 'button', class: 'chat-close', text: '✕', onclick: () => setOpen(false) });
  const panel = el('aside', { class: 'chat-panel', hidden: true }, el('div', { class: 'chat-head' }, title, closeBtn), list, typingLine, form);
  const preview = el('button', { type: 'button', class: 'chat-preview', hidden: true, onclick: () => setOpen(true) });

  function texts() {
    title.textContent = `💬 ${t('chat.title')}`;
    input.placeholder = t('chat.ph');
    toggle.title = t('chat.title');
    toggle.setAttribute('aria-label', t('chat.title'));
    sendBtn.setAttribute('aria-label', t('chat.send'));
    closeBtn.setAttribute('aria-label', t('chat.close'));
  }

  function setOpen(next) {
    open = next;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('active', open);
    if (open) {
      unread = 0;
      renderBadge();
      preview.hidden = true;
      render();
      input.focus({ preventScroll: true });
    }
  }

  function renderBadge() {
    badge.hidden = unread === 0;
    badge.textContent = unread > 9 ? '9+' : String(unread);
  }

  function time(at) {
    return new Date(at).toLocaleTimeString(getLang() === 'tr' ? 'tr-TR' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  }

  function render() {
    if (!open) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    if (!messages.length) {
      list.replaceChildren(el('p', { class: 'chat-empty', text: t('chat.empty') }));
      return;
    }
    let prev = null;
    list.replaceChildren(...messages.map((m) => {
      const mine = m.pid === me();
      const who = player(m.pid);
      const grouped = prev && prev.pid === m.pid && m.at - prev.at < 3 * 60 * 1000;
      prev = m;
      return el('div', { class: `chat-msg${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}`, style: { '--c': who ? who.color : '#9a93a8' } },
        !mine && !grouped ? el('span', { class: 'chat-name', text: who ? who.name : m.name }) : null,
        el('span', { class: 'chat-bubble' }, el('span', { class: 'chat-text', text: m.text }), el('time', { text: time(m.at) })));
    }));
    if (nearBottom || messages[messages.length - 1].pid === me()) list.scrollTop = list.scrollHeight;
  }

  function showPreview(m) {
    const who = player(m.pid);
    preview.replaceChildren(el('strong', { text: `${who ? who.name : m.name}: ` }), m.text.length > 80 ? `${m.text.slice(0, 80)}…` : m.text);
    preview.hidden = false;
    clearTimeout(previewHide);
    previewHide = setTimeout(() => { preview.hidden = true; }, 5000);
  }

  function sendTyping(typing) {
    socket.emit('chat:typing', { typing });
    typingSentAt = typing ? Date.now() : 0;
  }

  toggle.addEventListener('click', () => setOpen(!open));

  input.addEventListener('input', () => {
    if (!input.value.trim()) return;
    if (Date.now() - typingSentAt > TYPING_SEND_EVERY) sendTyping(true);
    clearTimeout(typingIdle);
    typingIdle = setTimeout(() => sendTyping(false), TYPING_IDLE);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat:send', { text }, (res) => {
      if (res && res.ok) return;
      input.value = input.value || text; // give the text back so nothing is lost
      if (res && res.error === 'rate') document.dispatchEvent(new CustomEvent('cp:toast', { detail: t('chat.rate') }));
    });
    input.value = '';
    clearTimeout(typingIdle);
    sendTyping(false);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });

  socket.on('chat:history', (history) => {
    messages = Array.isArray(history) ? history : [];
    render();
  });

  socket.on('chat:msg', (m) => {
    messages.push(m);
    if (messages.length > 200) messages.shift();
    if (m.pid !== me()) {
      typingLine.hidden = true;
      if (!open) {
        unread++;
        renderBadge();
        showPreview(m);
      }
    }
    render();
  });

  socket.on('chat:typing', ({ pid, typing }) => {
    const who = player(pid);
    clearTimeout(typingHide);
    typingLine.hidden = !typing || !who;
    if (typing && who) {
      typingLine.textContent = t('chat.typing', { name: who.name });
      typingHide = setTimeout(() => { typingLine.hidden = true; }, TYPING_SHOW_FOR);
    }
  });

  texts();

  return {
    nodes: { toggle, panel, preview },
    /** Clear everything when leaving a room. */
    reset() {
      messages = [];
      unread = 0;
      renderBadge();
      preview.hidden = true;
      typingLine.hidden = true;
      setOpen(false);
      list.replaceChildren();
    },
    relabel() {
      texts();
      render();
    },
    rerender: render,
  };
}
