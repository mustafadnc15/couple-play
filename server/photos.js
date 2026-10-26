'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BUNDLED_DIR = path.join(__dirname, '..', 'public', 'img', 'photos');
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PHOTOS = 500;
const TYPES = {
  jpg: { mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  png: { mime: 'image/png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  webp: { mime: 'image/webp', magic: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
};

function cleanTitle(title) {
  const pickText = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 40) : '');
  const tr = pickText(title && title.tr);
  const en = pickText(title && title.en);
  return { tr: tr || en, en: en || tr };
}

/**
 * The shared picture library used by the jigsaw and paint-by-number activities:
 * bundled photos (public/img/photos, in git) plus photos uploaded through the admin page
 * (stored in <dataDir>/photos with an index.json).
 */
class PhotoLibrary {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'photos');
    this.indexFile = path.join(this.dir, 'index.json');
    fs.mkdirSync(this.dir, { recursive: true });
    this.uploaded = this.readJson(this.indexFile);
  }

  readJson(file) {
    try {
      const list = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  bundled() {
    return this.readJson(path.join(BUNDLED_DIR, 'index.json'))
      .filter((p) => p && typeof p.file === 'string' && /^[\w.-]+$/.test(p.file))
      .map((p) => ({ id: p.file, url: `/img/photos/${p.file}`, title: cleanTitle(p.title), bundled: true }));
  }

  /** Newest uploads first, then the bundled pictures. */
  list() {
    const uploads = [...this.uploaded].reverse().map((p) => ({ id: p.id, url: `/uploads/photos/${p.file}`, title: p.title, bundled: false }));
    return [...uploads, ...this.bundled()];
  }

  get(id) {
    return this.list().find((p) => p.id === id) || null;
  }

  /** Add a photo from a data URL. Throws an Error with a `code` on invalid input. */
  add(dataUrl, title) {
    const fail = (code) => Object.assign(new Error(code), { code });
    if (this.uploaded.length >= MAX_PHOTOS) throw fail('full');
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
    if (!m) throw fail('badImage');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length < 16 || buf.length > MAX_BYTES) throw fail('tooBig');
    if (!TYPES[ext].magic(buf)) throw fail('badImage');

    const id = `u-${crypto.randomBytes(8).toString('hex')}`;
    const file = `${id}.${ext}`;
    fs.writeFileSync(path.join(this.dir, file), buf);
    const entry = { id, file, title: cleanTitle(title), addedAt: new Date().toISOString() };
    this.uploaded.push(entry);
    this.save();
    return { id, url: `/uploads/photos/${file}`, title: entry.title, bundled: false };
  }

  remove(id) {
    const i = this.uploaded.findIndex((p) => p.id === id);
    if (i === -1) return false;
    const [entry] = this.uploaded.splice(i, 1);
    this.save();
    fs.rmSync(path.join(this.dir, entry.file), { force: true });
    return true;
  }

  save() {
    const tmp = `${this.indexFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.uploaded, null, 2));
    fs.renameSync(tmp, this.indexFile);
  }
}

module.exports = { PhotoLibrary, TYPES };
