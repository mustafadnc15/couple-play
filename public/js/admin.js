/** Photo library admin page: upload pictures once and they appear in the jigsaw and paint pickers. */
import { t, getLang, setLang, onLangChange, applyI18n } from './i18n.js';
import { el } from './lib/ui.js';
import { photoToDataUrl, loadImage, loadLibrary, photoTitle, thumb } from './lib/photo.js';
import { buildTemplate, decodeRle, GW, GH } from './lib/pbn.js';

const $ = (id) => document.getElementById(id);
const queue = []; // { file, data, titleTr, titleEn, node, status }
let password = '';

function session(value) {
  try {
    if (value === undefined) return sessionStorage.getItem('cp.admin') || '';
    if (value) sessionStorage.setItem('cp.admin', value);
    else sessionStorage.removeItem('cp.admin');
  } catch { /* storage unavailable */ }
  return '';
}

function toast(msg, ms = 3000) {
  const node = $('toast');
  node.textContent = msg;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, ms);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${encodeURIComponent(password)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) {
    logout();
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error(json.error || 'server');
  return json;
}

function show(view) {
  for (const id of ['disabled', 'login', 'panel']) $(id).hidden = id !== view;
}

function logout() {
  password = '';
  session(null);
  show('login');
}

/* ---------- login ---------- */

$('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  password = $('password').value;
  $('login-error').textContent = '';
  try {
    await api('GET', '/api/admin/check');
    session(password);
    $('password').value = '';
    openPanel();
  } catch (err) {
    $('login-error').textContent = t(err.message === 'tooMany' ? 'admin.err.tooMany' : 'admin.err.password');
  }
});

$('logout').addEventListener('click', logout);

/* ---------- upload queue ---------- */

function niceName(file) {
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base.charAt(0).toLocaleUpperCase(getLang() === 'tr' ? 'tr-TR' : 'en-US') + base.slice(1);
}

/** Small paint-by-number preview so you can judge how the picture will look in the paint game. */
function pbnPreview(img) {
  const tpl = buildTemplate(img, 'medium');
  const colors = decodeRle(tpl.rle, GW * GH);
  const canvas = document.createElement('canvas');
  canvas.width = GW;
  canvas.height = GH;
  const g = canvas.getContext('2d');
  const out = g.createImageData(GW, GH);
  const rgb = tpl.palette.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  for (let p = 0; p < colors.length; p++) {
    const [r, gg, b] = rgb[colors[p]];
    out.data.set([r, gg, b, 255], p * 4);
  }
  g.putImageData(out, 0, 0);
  return thumb(canvas, 160, 120);
}

let previewChain = Promise.resolve();

async function addFiles(files) {
  for (const file of files) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast(t('admin.err.type', { name: file.name }));
      continue;
    }
    let data;
    let img;
    try {
      data = await photoToDataUrl(file, 2000);
      img = await loadImage(data);
    } catch {
      toast(t('admin.err.read', { name: file.name }));
      continue;
    }
    const item = { file, data, status: 'ready' };
    const name = niceName(file);
    item.tr = el('input', { value: name, maxlength: 40, 'aria-label': 'TR' });
    item.en = el('input', { value: name, maxlength: 40, 'aria-label': 'EN' });
    item.statusEl = el('span', { class: 'queue-status' });
    const previewBox = el('div', { class: 'queue-preview' }, el('span', { class: 'muted small', text: t('admin.previewing') }));
    item.node = el('div', { class: 'queue-item' },
      el('div', { class: 'queue-thumbs' },
        el('figure', {}, thumb(img, 160, 120), el('figcaption', { text: t('admin.photo') })),
        el('figure', {}, previewBox, el('figcaption', { text: t('admin.paintPreview') }))),
      el('div', { class: 'queue-fields' },
        el('label', { class: 'field' }, el('span', { text: `${t('admin.titleTr')}` }), item.tr),
        el('label', { class: 'field' }, el('span', { text: `${t('admin.titleEn')}` }), item.en),
        item.statusEl),
      el('button', {
        type: 'button',
        class: 'btn btn-ghost btn-sm queue-remove',
        'aria-label': t('admin.removeFromQueue'),
        text: '✕',
        onclick: () => {
          queue.splice(queue.indexOf(item), 1);
          item.node.remove();
          renderQueueActions();
        },
      }));
    queue.push(item);
    $('queue').append(item.node);
    renderQueueActions();
    // Previews are CPU-heavy, so build them one at a time without blocking new files.
    previewChain = previewChain.then(() => new Promise((resolve) => setTimeout(() => {
      try {
        previewBox.replaceChildren(pbnPreview(img));
      } catch {
        previewBox.replaceChildren();
      }
      resolve();
    }, 20)));
  }
}

function renderQueueActions() {
  const pending = queue.filter((q) => q.status !== 'done').length;
  $('queue-actions').hidden = pending === 0;
  $('upload-all').textContent = t('admin.uploadAll', { n: pending });
}

$('files').addEventListener('change', () => {
  addFiles([...$('files').files]);
  $('files').value = '';
});

const drop = $('dropzone');
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  addFiles([...e.dataTransfer.files]);
});

$('clear-queue').addEventListener('click', () => {
  queue.splice(0).forEach((q) => q.node.remove());
  renderQueueActions();
});

$('upload-all').addEventListener('click', async () => {
  const btn = $('upload-all');
  btn.disabled = true;
  let ok = 0;
  for (const item of queue.filter((q) => q.status !== 'done')) {
    item.statusEl.textContent = t('admin.uploading');
    item.statusEl.className = 'queue-status';
    try {
      await api('POST', '/api/admin/photos', { data: item.data, title: { tr: item.tr.value, en: item.en.value } });
      item.status = 'done';
      item.statusEl.textContent = `✓ ${t('admin.uploaded')}`;
      item.statusEl.classList.add('ok');
      item.node.classList.add('done');
      ok++;
    } catch (err) {
      if (err.message === 'unauthorized') break;
      item.statusEl.textContent = t(`admin.err.${err.message}`) || err.message;
      item.statusEl.classList.add('error');
    }
  }
  btn.disabled = false;
  renderQueueActions();
  if (ok) {
    toast(t('admin.uploadedN', { n: ok }));
    setTimeout(() => {
      queue.filter((q) => q.status === 'done').forEach((q) => {
        q.node.remove();
        queue.splice(queue.indexOf(q), 1);
      });
      renderQueueActions();
    }, 1500);
    renderLibrary();
  }
});

/* ---------- library ---------- */

async function renderLibrary() {
  const photos = await loadLibrary();
  $('library').replaceChildren(...photos.map((photo) => {
    const del = photo.bundled ? el('span', { class: 'badge', text: t('admin.bundled') }) : el('button', {
      type: 'button',
      class: 'btn btn-ghost btn-sm',
      text: `🗑 ${t('admin.delete')}`,
      onclick: async () => {
        if (!confirm(t('admin.deleteConfirm', { name: photoTitle(photo, getLang()) }))) return;
        try {
          await api('DELETE', `/api/admin/photos/${encodeURIComponent(photo.id)}`);
          renderLibrary();
        } catch (err) {
          if (err.message !== 'unauthorized') toast(t('admin.err.server'));
        }
      },
    });
    return el('div', { class: 'library-item' },
      el('img', { src: photo.url, alt: '', loading: 'lazy' }),
      el('div', { class: 'library-meta' }, el('strong', { text: photoTitle(photo, getLang()) }), del));
  }));
}

async function openPanel() {
  show('panel');
  renderQueueActions();
  renderLibrary();
}

/* ---------- boot ---------- */

function syncLangButtons() {
  document.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('active', b.dataset.lang === getLang()));
}
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
onLangChange(() => {
  syncLangButtons();
  renderQueueActions();
  if (!$('panel').hidden) renderLibrary();
});

applyI18n(document);
syncLangButtons();

(async () => {
  const { enabled } = await fetch('/api/admin-enabled').then((r) => r.json()).catch(() => ({ enabled: false }));
  if (!enabled) return show('disabled');
  password = session();
  if (!password) return show('login');
  try {
    await api('GET', '/api/admin/check');
    openPanel();
  } catch {
    show('login');
  }
})();
