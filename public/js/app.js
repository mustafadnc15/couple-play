import { t, getLang, setLang, onLangChange, applyI18n } from './i18n.js';
import { el, throttle } from './lib/ui.js';
import { activities, getActivity } from './activities/index.js';
import { createChat } from './chat.js';

/* global io */
const socket = io();
const $ = (id) => document.getElementById(id);

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* storage unavailable */ }
  return null;
}

let clientId = store('cp.client');
if (!clientId) {
  clientId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
  store('cp.client', clientId);
}

const app = {
  me: null,
  room: null, // { code, players, activity }
  current: null, // { id, gen, instance }
};

/* ---------- views ---------- */

function show(view) {
  for (const v of ['home', 'lobby', 'activity']) $(`view-${v}`).hidden = v !== view;
  $('topbar-room').hidden = view === 'home';
  document.body.dataset.view = view;
}

function toast(msg, ms = 2600) {
  const node = $('toast');
  node.textContent = msg;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, ms);
}

function floatUp(content, { x, color, size = 34, count = 1 } = {}) {
  const layer = $('float-layer');
  for (let i = 0; i < count; i++) {
    const node = el('div', { class: 'floater', text: content });
    node.style.left = `${x ?? (10 + Math.random() * 80)}%`;
    node.style.fontSize = `${size + Math.random() * 18}px`;
    node.style.animationDelay = `${i * 90}ms`;
    node.style.animationDuration = `${2.4 + Math.random() * 1.6}s`;
    if (color) node.style.color = color;
    layer.append(node);
    setTimeout(() => node.remove(), 5000 + i * 90);
  }
}

function celebrate(msg) {
  floatUp('💖', { count: 18 });
  floatUp('✨', { count: 8, size: 24 });
  if (msg) toast(msg, 5000);
}

function player(pid) {
  return app.room?.players.find((p) => p.pid === pid) || null;
}

function partner() {
  return app.room?.players.find((p) => p.pid !== app.me) || null;
}

/* ---------- home ---------- */

function homeError(key) {
  $('home-error').textContent = key ? t(key) : '';
}

function readName() {
  const name = $('name-input').value.trim();
  if (!name) {
    homeError('err.name');
    $('name-input').focus();
    return null;
  }
  store('cp.name', name);
  return name;
}

function afterJoin(res) {
  if (!res || !res.ok) {
    homeError(`err.${res?.error || 'badRequest'}`);
    history.replaceState(null, '', '/');
    show('home');
    return;
  }
  homeError(null);
  app.me = res.me;
  const url = new URL(location.href);
  url.search = `?room=${res.room.code}`;
  history.replaceState(null, '', url);
  onRoom(res.room);
}

function joinRoom(code, name) {
  socket.emit('room:join', { code, name, clientId }, afterJoin);
}

$('create-btn').addEventListener('click', () => {
  const name = readName();
  if (name) socket.emit('room:create', { name, clientId }, afterJoin);
});

$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = readName();
  if (!name) return;
  const code = $('code-input').value.trim().toUpperCase();
  if (!code) {
    homeError('err.code');
    return;
  }
  joinRoom(code, name);
});

/* ---------- room ---------- */

function inviteUrl() {
  return `${location.origin}/?room=${app.room.code}`;
}

function renderPlayers() {
  const box = $('players');
  box.replaceChildren(...app.room.players.map((p) => el('span', {
    class: `player${p.online ? '' : ' offline'}`,
    style: { '--c': p.color },
    title: p.online ? '' : t('room.offline'),
  }, el('span', { class: 'dot' }), `${p.name}${p.pid === app.me ? ` (${t('room.you')})` : ''}`)));
  $('room-chip').textContent = `${t('room.code')}: ${app.room.code}`;
  $('big-code').textContent = app.room.code;
  $('invite-link').value = inviteUrl();
  const together = app.room.players.filter((p) => p.online).length >= 2;
  $('status-text').textContent = together ? t('room.together') : t('room.waiting');
  $('status-text').classList.toggle('pulse', !together);
  $('invite-card').classList.toggle('compact', together);
}

function renderActivityGrid() {
  $('activity-grid').replaceChildren(...activities.map((a) => el('button', {
    type: 'button',
    class: 'activity-card',
    style: { '--accent': a.accent },
    onclick: () => openOptions(a),
  },
  el('span', { class: 'activity-icon', text: a.icon }),
  el('span', { class: 'activity-name', text: t(`act.${a.id}`) }),
  el('span', { class: 'activity-desc', text: t(`act.${a.id}.desc`) }))));
}

function onRoom(room) {
  const prevActivity = app.room?.activity;
  app.room = room;
  renderPlayers();
  chat.rerender();
  if (!room.activity) {
    unmountActivity();
    renderActivityGrid();
    show('lobby');
  } else if (room.activity !== prevActivity && app.current && app.current.id !== room.activity) {
    unmountActivity();
  }
  app.current?.instance?.onPlayers?.();
}

socket.on('room:update', onRoom);
socket.on('room:kicked', () => {
  app.room = null;
  chat.reset();
  unmountActivity();
  homeError('err.kicked');
  show('home');
});

$('copy-btn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(inviteUrl());
  } catch {
    $('invite-link').select();
    document.execCommand('copy');
  }
  toast(t('room.copied'));
});

if (navigator.share) {
  $('share-btn').hidden = false;
  $('share-btn').addEventListener('click', () => {
    navigator.share({ title: 'CouplePlay 💞', url: inviteUrl() }).catch(() => {});
  });
}

$('leave-btn').addEventListener('click', () => {
  socket.emit('room:leave');
  app.room = null;
  chat.reset();
  unmountActivity();
  history.replaceState(null, '', '/');
  show('home');
});

$('back-btn').addEventListener('click', () => socket.emit('room:lobby'));

/* ---------- activity options ---------- */

function openOptions(activity) {
  const modal = $('options-modal');
  $('options-title').textContent = `${activity.icon} ${t(`act.${activity.id}`)}`;
  const fields = $('options-fields');
  fields.replaceChildren();
  const collect = activity.renderOptions ? activity.renderOptions(fields, { t, lang: getLang() }) : () => ({});
  const submit = $('options-form').querySelector('button[type=submit]');
  submit.disabled = false;
  submit.textContent = t('opt.start');
  $('options-form').onsubmit = async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    submit.textContent = t('opt.preparing');
    try {
      const options = await collect();
      socket.emit('room:select', { id: activity.id, options });
      modal.close();
    } catch (err) {
      console.error(err);
      toast(t('opt.failed'));
    } finally {
      submit.disabled = false;
      submit.textContent = t('opt.start');
    }
  };
  $('options-cancel').onclick = () => modal.close();
  modal.showModal();
}

/* ---------- running activity ---------- */

function unmountActivity() {
  if (!app.current) return;
  try {
    app.current.instance?.destroy?.();
  } catch (err) {
    console.error(err);
  }
  app.current = null;
  $('activity-root').replaceChildren();
  $('activity-tools').replaceChildren();
}

const sendCursor = throttle((x, y) => socket.emit('cursor', { x, y }), 50);

function mountActivity(id, gen) {
  unmountActivity();
  const activity = getActivity(id);
  if (!activity) return;
  $('activity-title').textContent = `${activity.icon} ${t(`act.${id}`)}`;
  const api = {
    get me() { return app.me; },
    t,
    get lang() { return getLang(); },
    player,
    partner,
    send: (type, data) => socket.emit('act', { type, data }),
    cursor: sendCursor,
    toast,
    celebrate,
    tools: $('activity-tools'),
    newGame: () => openOptions(activity),
  };
  app.current = { id, gen, instance: activity.mount($('activity-root'), api) };
  show('activity');
}

socket.on('activity:state', ({ id, gen, state }) => {
  if (!app.room) return;
  if (!app.current || app.current.id !== id || app.current.gen !== gen) mountActivity(id, gen);
  if (!app.current) return;
  app.current.instance.onState(state);
});

socket.on('activity:event', ({ type, data }) => {
  app.current?.instance?.onEvent?.(type, data);
});

socket.on('cursor', ({ pid, x, y }) => {
  app.current?.instance?.onCursor?.(pid, x, y);
});

/* ---------- chat ---------- */

const chat = createChat({ socket, t, getLang, me: () => app.me, player });
document.body.append(chat.nodes.panel, chat.nodes.preview);
document.addEventListener('cp:toast', (e) => toast(e.detail));

/* ---------- reactions ---------- */

const REACTIONS = ['❤️', '😘', '😂', '🥰', '👏', '🔥'];
$('reactions').append(chat.nodes.toggle, el('span', { class: 'reactions-sep' }), ...REACTIONS.map((emoji) => el('button', {
  type: 'button',
  class: 'reaction',
  text: emoji,
  onclick: () => socket.emit('react', { emoji }),
})));

socket.on('react', ({ pid, emoji }) => {
  floatUp(emoji, { count: 5, x: pid === app.me ? 80 + Math.random() * 10 : 5 + Math.random() * 10 });
});

/* ---------- language ---------- */

function syncLangButtons() {
  document.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('active', b.dataset.lang === getLang()));
}

document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

onLangChange(() => {
  syncLangButtons();
  chat.relabel();
  if (app.room) {
    renderPlayers();
    renderActivityGrid();
  }
  if (app.current) {
    // Re-mount so every activity re-renders its texts in the new language, then fetch fresh state.
    const { id, gen } = app.current;
    mountActivity(id, gen);
    socket.emit('room:sync');
  }
});

/* ---------- connection lifecycle ---------- */

let wasConnected = false;
socket.on('connect', () => {
  if (wasConnected && app.room) {
    // Reconnected: reclaim our seat (the server matches us by clientId).
    socket.emit('room:join', { code: app.room.code, name: store('cp.name') || 'Player', clientId }, (res) => {
      if (res?.ok) {
        app.me = res.me;
        onRoom(res.room);
      }
    });
  }
  wasConnected = true;
});

socket.on('disconnect', () => {
  if (app.room) toast(t('err.offline'), 4000);
});

/* ---------- boot ---------- */

applyI18n(document);
syncLangButtons();
$('name-input').value = store('cp.name') || '';
const initialCode = new URLSearchParams(location.search).get('room');
if (initialCode) {
  $('code-input').value = initialCode.toUpperCase();
  const name = store('cp.name');
  if (name) joinRoom(initialCode, name);
  else $('name-input').focus();
}
show('home');
