/** Helpers for photos: one-off uploads and the shared picture library (/api/photos). */
import { el } from './ui.js';

const MIN_ASPECT = 0.5;
const MAX_ASPECT = 2;

export async function loadImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

export function aspectOf(source) {
  const w = source.naturalWidth || source.width;
  const h = source.naturalHeight || source.height;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, w / h));
}

/**
 * Shrink an uploaded photo so it travels well over the socket. Keeps its proportions, only
 * center-cropping extreme panoramas/portraits to between 1:2 and 2:1.
 */
export async function photoToDataUrl(file, maxSide = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const target = aspectOf(img);
    let sw = img.naturalWidth;
    let sh = img.naturalHeight;
    if (sw / sh > target) sw = sh * target;
    else sh = sw / target;
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    canvas.getContext('2d').drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The picture library: [{ id, url, title: { tr, en }, bundled }], uploads first. */
export async function loadLibrary() {
  try {
    const res = await fetch('/api/photos', { cache: 'no-cache' });
    if (!res.ok) return [];
    const list = await res.json();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function photoTitle(photo, lang) {
  return (photo.title && (photo.title[lang] || photo.title.en || photo.title.tr)) || '';
}

export function thumb(source, w = 120, h = 90) {
  const canvas = el('canvas', { class: 'thumb' });
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  const s = Math.max(w / sw, h / sh);
  g.drawImage(source, (w - sw * s) / 2, (h - sh * s) / 2, sw * s, sh * s);
  return canvas;
}

/**
 * Add the library photos to a choiceField right after `anchor` (the upload button).
 * `onPhoto(value, photo, imgPromise)` is called for each photo; images load in parallel.
 * Selects the first photo unless the player already picked something.
 */
export function addPhotoChoices(field, anchor, lang, onPhoto) {
  let touched = false;
  field.group.addEventListener('click', () => { touched = true; });
  loadLibrary().then((photos) => {
    let after = anchor;
    photos.forEach((photo, i) => {
      const value = `photo:${photo.id}`;
      const placeholder = el('span', { class: 'thumb upload-thumb', text: '⏳' });
      const b = el('button', { type: 'button', class: 'choice choice-preview', role: 'radio', onclick: () => field.set(value) },
        placeholder, el('span', { text: photoTitle(photo, lang) }));
      b.dataset.value = value;
      after.after(b);
      after = b;
      const imgPromise = loadImage(photo.url);
      onPhoto(value, photo, imgPromise);
      imgPromise.then((img) => placeholder.replaceWith(thumb(img)), () => b.remove());
      if (i === 0 && !touched) field.set(value);
    });
  });
}
