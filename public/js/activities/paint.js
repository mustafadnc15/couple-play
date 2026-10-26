import { el, choiceField } from '../lib/ui.js';
import { renderArt, ART_IDS } from '../lib/art.js';
import { buildTemplate, decodeRle, components, GW, GH } from '../lib/pbn.js';
import { photoToDataUrl, loadImage } from '../lib/photo.js';

const RS = 2; // paint canvas pixels per grid cell
const ERASER = '#ffffff';
const DONE_RATIO = 0.85;
const ZOOMS = [1, 1.5, 2, 3, 4];
const PHOTO_MANIFEST = '/img/paint/index.json';

/** Optional extra pictures: any { file, title } listed in public/img/paint/index.json. */
async function loadManifest() {
  try {
    const res = await fetch(PHOTO_MANIFEST);
    if (!res.ok) return [];
    const list = await res.json();
    return Array.isArray(list) ? list.filter((p) => p && typeof p.file === 'string') : [];
  } catch {
    return [];
  }
}

/** Regions, label spots and per-region pixel lists for a template. */
function analyse(template) {
  const colors = decodeRle(template.rle, GW * GH);
  const { comp, sizes, count } = components(colors);
  const regionColor = new Uint8Array(count);
  for (let p = 0; p < comp.length; p++) regionColor[comp[p]] = colors[p];

  // Pixels grouped by region (counting sort) for fast fills and progress checks.
  const start = new Int32Array(count + 1);
  for (let r = 0; r < count; r++) start[r + 1] = start[r] + sizes[r];
  const fillPos = start.slice(0, count);
  const pixels = new Int32Array(comp.length);
  for (let p = 0; p < comp.length; p++) pixels[fillPos[comp[p]]++] = p;

  // Chamfer distance to the region border; the farthest point gets the number.
  const n = comp.length;
  const dist = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const x = p % GW;
    const y = (p - x) / GW;
    const r = comp[p];
    const edge = x === 0 || y === 0 || x === GW - 1 || y === GH - 1
      || comp[p - 1] !== r || comp[p + 1] !== r || comp[p - GW] !== r || comp[p + GW] !== r;
    dist[p] = edge ? 1 : 1e9;
  }
  const relax = (p, q, w) => {
    const v = dist[q] + w;
    if (v < dist[p]) dist[p] = v;
  };
  for (let y = 1; y < GH - 1; y++) {
    for (let x = 1; x < GW - 1; x++) {
      const p = y * GW + x;
      relax(p, p - 1, 1); relax(p, p - GW, 1); relax(p, p - GW - 1, 1.41); relax(p, p - GW + 1, 1.41);
    }
  }
  for (let y = GH - 2; y > 0; y--) {
    for (let x = GW - 2; x > 0; x--) {
      const p = y * GW + x;
      relax(p, p + 1, 1); relax(p, p + GW, 1); relax(p, p + GW + 1, 1.41); relax(p, p + GW - 1, 1.41);
    }
  }
  const labels = Array.from({ length: count }, () => ({ x: 0, y: 0, d: -1 }));
  for (let p = 0; p < n; p++) {
    const r = comp[p];
    if (dist[p] > labels[r].d) labels[r] = { x: (p % GW) + 0.5, y: Math.floor(p / GW) + 0.5, d: dist[p] };
  }

  // Outline image at grid resolution (scaled up smoothly when drawn).
  const outline = document.createElement('canvas');
  outline.width = GW;
  outline.height = GH;
  const og = outline.getContext('2d');
  const img = og.createImageData(GW, GH);
  for (let p = 0; p < n; p++) {
    const x = p % GW;
    const r = comp[p];
    if ((x < GW - 1 && comp[p + 1] !== r) || (p + GW < n && comp[p + GW] !== r)) {
      img.data[p * 4] = 70;
      img.data[p * 4 + 1] = 60;
      img.data[p * 4 + 2] = 90;
      img.data[p * 4 + 3] = 210;
    }
  }
  og.putImageData(img, 0, 0);

  // Small "what it should look like" reference.
  const reference = document.createElement('canvas');
  reference.width = GW;
  reference.height = GH;
  const rg = reference.getContext('2d');
  const ref = rg.createImageData(GW, GH);
  const rgb = template.palette.map(hexToRgb);
  for (let p = 0; p < n; p++) {
    const [r, g, b] = rgb[colors[p]];
    ref.data[p * 4] = r;
    ref.data[p * 4 + 1] = g;
    ref.data[p * 4 + 2] = b;
    ref.data[p * 4 + 3] = 255;
  }
  rg.putImageData(ref, 0, 0);

  return { colors, comp, count, regionColor, start, pixels, labels, outline, reference };
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

function textColor(hex) {
  const [r, g, b] = hexToRgb(hex);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#2b2140' : '#fff';
}

function makeCanvas() {
  const c = document.createElement('canvas');
  c.width = GW * RS;
  c.height = GH * RS;
  return c;
}

function thumb(source) {
  const canvas = el('canvas', { class: 'thumb' });
  canvas.width = 120;
  canvas.height = 90;
  const g = canvas.getContext('2d');
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  const s = Math.max(120 / sw, 90 / sh);
  g.drawImage(source, (120 - sw * s) / 2, (90 - sh * s) / 2, sw * s, sh * s);
  return canvas;
}

export default {
  id: 'paint',
  icon: '🎨',
  accent: '#6c63ff',

  renderOptions(container, { t, lang }) {
    const sources = new Map(ART_IDS.map((id) => [id, () => renderArt(id)]));
    let custom = null;
    const uploadThumb = el('span', { class: 'thumb upload-thumb', text: '📷' });
    const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
    const image = choiceField(t('opt.image'), [
      { value: 'custom', label: t('opt.upload'), preview: uploadThumb },
      ...ART_IDS.map((id) => ({ value: id, label: t(`art.${id}`), preview: thumb(renderArt(id, 240, 180)) })),
    ], ART_IDS[0]);
    const uploadBtn = image.group.querySelector('[data-value="custom"]');
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      custom = await loadImage(await photoToDataUrl(file));
      uploadThumb.replaceChildren();
      const th = thumb(custom);
      uploadBtn.replaceChild(th, uploadBtn.firstChild);
      image.set('custom');
    });

    // Photos listed in public/img/paint/index.json come right after the upload button.
    let touched = false;
    image.group.addEventListener('click', () => { touched = true; });
    loadManifest().then(async (photos) => {
      let anchor = uploadBtn;
      for (const photo of photos) {
        const value = `photo:${photo.file}`;
        let img;
        try {
          img = await loadImage(`/img/paint/${encodeURIComponent(photo.file)}`);
        } catch {
          continue;
        }
        sources.set(value, () => img);
        const title = typeof photo.title === 'object' ? photo.title[lang] || photo.title.en : photo.title;
        const b = el('button', { type: 'button', class: 'choice choice-preview', role: 'radio', onclick: () => image.set(value) },
          thumb(img), el('span', { text: title || photo.file }));
        b.dataset.value = value;
        anchor.after(b);
        anchor = b;
        if (!touched && anchor.previousSibling === uploadBtn) image.set(value);
      }
    });

    const detail = choiceField(t('opt.difficulty'), [
      { value: 'easy', label: t('opt.easy') },
      { value: 'medium', label: t('opt.medium') },
      { value: 'hard', label: t('opt.hard') },
    ], 'medium');
    container.append(image.node, detail.node, fileInput);

    return async () => {
      let choice = image.get();
      if (choice === 'custom' && !custom) choice = ART_IDS[0];
      const source = choice === 'custom' ? custom : sources.get(choice)();
      // Let the "preparing" state paint before the (blocking) conversion runs.
      await new Promise((r) => setTimeout(r, 30));
      return { template: buildTemplate(source, detail.get()), detail: detail.get() };
    };
  },

  mount(root, api) {
    let state = null;
    let info = null;
    let color = null;
    let tool = 'brush';
    let size = 10;
    let zoom = 1;
    let correct = new Uint8Array(0);
    let checkTimer = null;
    let drawing = null;
    let panning = null;
    let queued = []; // ops that arrive while the template is still being prepared

    const paintCanvas = makeCanvas();
    const lineCanvas = makeCanvas();
    const mask = document.createElement('canvas');
    paintCanvas.className = 'paint-layer';
    lineCanvas.className = 'paint-layer paint-lines';
    const pctx = paintCanvas.getContext('2d', { willReadFrequently: true });
    const lctx = lineCanvas.getContext('2d');

    const cursorEl = el('div', { class: 'remote-cursor', hidden: true });
    const stage = el('div', { class: 'paint-stage' }, paintCanvas, lineCanvas, cursorEl);
    const stageWrap = el('div', { class: 'paint-stage-wrap' }, stage);
    const palette = el('div', { class: 'palette' });
    const sizeInput = el('input', { type: 'range', min: 2, max: 40, value: size, 'aria-label': api.t('paint.size') });
    const toolBtns = {
      bucket: el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: `🪣 ${api.t('paint.bucket')}` }),
      brush: el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: `🖌️ ${api.t('paint.brush')}` }),
      hand: el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: `✋ ${api.t('paint.hand')}` }),
    };
    const zoomLabel = el('span', { class: 'zoom-label', text: '100%' });
    const zoomBox = el('div', { class: 'zoom-box' },
      el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: '−', 'aria-label': 'zoom out', onclick: () => stepZoom(-1) }),
      zoomLabel,
      el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: '+', 'aria-label': 'zoom in', onclick: () => stepZoom(1) }));
    const refBox = el('div', { class: 'paint-ref' });
    const loading = el('div', { class: 'paint-loading', text: api.t('paint.loading') });
    const side = el('div', { class: 'paint-side' },
      palette,
      el('div', { class: 'paint-tools' },
        toolBtns.bucket, toolBtns.brush, toolBtns.hand,
        el('label', { class: 'size-field' }, el('span', { text: api.t('paint.size') }), sizeInput),
        zoomBox),
      refBox);
    root.append(el('div', { class: 'paint-layout' }, stageWrap, side), loading);

    const progress = el('span', { class: 'chip' });
    const clearBtn = el('button', {
      type: 'button',
      class: 'btn btn-sm btn-ghost',
      text: `🧽 ${api.t('paint.clear')}`,
      onclick: () => {
        if (confirm(api.t('paint.clearConfirm'))) api.send('clear', {});
      },
    });
    const newBtn = el('button', { type: 'button', class: 'btn btn-sm btn-secondary', text: api.t('drag.new'), onclick: api.newGame });
    api.tools.append(progress, clearBtn, newBtn);

    function setTool(next) {
      tool = next;
      Object.entries(toolBtns).forEach(([k, b]) => b.classList.toggle('active', k === tool));
      lineCanvas.style.cursor = tool === 'hand' ? 'grab' : 'crosshair';
    }
    Object.entries(toolBtns).forEach(([k, b]) => { b.onclick = () => setTool(k); });
    sizeInput.oninput = () => { size = Number(sizeInput.value); };
    setTool('bucket');

    // Keep the 4:3 stage as large as the available space allows, times the zoom level.
    function layout() {
      const r = stageWrap.getBoundingClientRect();
      const w = Math.min(r.width, r.height * (GW / GH)) * zoom;
      stage.style.width = `${w}px`;
      stage.style.height = `${w * (GH / GW)}px`;
      zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    }
    function stepZoom(dir) {
      const i = Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + dir));
      if (ZOOMS[i] === zoom) return;
      // Keep the centre of the view in place while zooming.
      const cx = (stageWrap.scrollLeft + stageWrap.clientWidth / 2) / stage.offsetWidth;
      const cy = (stageWrap.scrollTop + stageWrap.clientHeight / 2) / stage.offsetHeight;
      zoom = ZOOMS[i];
      layout();
      stageWrap.scrollLeft = cx * stage.offsetWidth - stageWrap.clientWidth / 2;
      stageWrap.scrollTop = cy * stage.offsetHeight - stageWrap.clientHeight / 2;
    }
    stageWrap.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return; // trackpad pinch and ctrl+wheel zoom the canvas
      e.preventDefault();
      stepZoom(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    const fit = new ResizeObserver(layout);
    fit.observe(stageWrap);

    function buildPalette() {
      palette.replaceChildren();
      const swatches = state.template.palette.map((hex, i) => {
        const b = el('button', {
          type: 'button',
          class: 'swatch',
          style: { background: hex, color: textColor(hex) },
          text: String(i + 1),
          title: hex,
        });
        b.dataset.color = hex;
        return b;
      });
      const eraser = el('button', { type: 'button', class: 'swatch eraser', text: '⌫', title: api.t('paint.eraser') });
      eraser.dataset.color = ERASER;
      [...swatches, eraser].forEach((b) => {
        b.onclick = () => {
          color = b.dataset.color;
          palette.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s === b));
        };
        palette.append(b);
      });
      swatches[0].click();
    }

    function drawLines() {
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, lineCanvas.width, lineCanvas.height);
      lctx.imageSmoothingEnabled = true;
      lctx.drawImage(info.outline, 0, 0, lineCanvas.width, lineCanvas.height);
      lctx.setTransform(RS, 0, 0, RS, 0, 0);
      lctx.textAlign = 'center';
      lctx.textBaseline = 'middle';
      lctx.fillStyle = '#4a4060';
      info.labels.forEach((lab, r) => {
        if (lab.d < 0 || correct[r]) return;
        const fontSize = Math.max(3.5, Math.min(11, lab.d * 0.95));
        lctx.font = `800 ${fontSize}px Nunito, sans-serif`;
        lctx.fillText(String(info.regionColor[r] + 1), lab.x, lab.y);
      });
    }

    function applyOp(op) {
      if (op.t === 's') {
        const p = op.p;
        pctx.setTransform(RS, 0, 0, RS, 0, 0);
        pctx.strokeStyle = op.c;
        pctx.fillStyle = op.c;
        pctx.lineWidth = op.w;
        pctx.lineCap = 'round';
        pctx.lineJoin = 'round';
        pctx.beginPath();
        if (p.length === 2) {
          pctx.arc(p[0], p[1], op.w / 2, 0, Math.PI * 2);
          pctx.fill();
        } else {
          pctx.moveTo(p[0], p[1]);
          for (let i = 2; i < p.length; i += 2) pctx.lineTo(p[i], p[i + 1]);
          pctx.stroke();
        }
      } else if (op.t === 'f') {
        if (op.r < 0 || op.r >= info.count) return;
        // Regions tile the grid exactly, so filling the region's own cells leaves no seams.
        let x0 = GW;
        let y0 = GH;
        let x1 = 0;
        let y1 = 0;
        for (let i = info.start[op.r]; i < info.start[op.r + 1]; i++) {
          const p = info.pixels[i];
          const x = p % GW;
          const y = (p - x) / GW;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
        const bw = x1 - x0 + 1;
        const bh = y1 - y0 + 1;
        mask.width = bw;
        mask.height = bh;
        const m = mask.getContext('2d');
        const img = m.createImageData(bw, bh);
        const [r, g, b] = hexToRgb(op.c);
        for (let i = info.start[op.r]; i < info.start[op.r + 1]; i++) {
          const p = info.pixels[i];
          const x = p % GW;
          const k = (((p - x) / GW - y0) * bw + (x - x0)) * 4;
          img.data[k] = r;
          img.data[k + 1] = g;
          img.data[k + 2] = b;
          img.data[k + 3] = 255;
        }
        m.putImageData(img, 0, 0);
        pctx.setTransform(1, 0, 0, 1, 0, 0);
        pctx.imageSmoothingEnabled = false;
        pctx.drawImage(mask, x0 * RS, y0 * RS, bw * RS, bh * RS);
      }
      scheduleCheck();
    }

    /** Draw an op and remember it in the shared state snapshot. */
    function paintOp(op) {
      state.ops.push(op);
      applyOp(op);
    }

    function scheduleCheck() {
      clearTimeout(checkTimer);
      checkTimer = setTimeout(check, 500);
    }

    function check() {
      if (!info) return;
      const data = pctx.getImageData(0, 0, paintCanvas.width, paintCanvas.height).data;
      const targets = state.template.palette.map(hexToRgb);
      const cw = paintCanvas.width;
      let ok = 0;
      correct = new Uint8Array(info.count);
      for (let r = 0; r < info.count; r++) {
        const [tr, tg, tb] = targets[info.regionColor[r]];
        let good = 0;
        const total = info.start[r + 1] - info.start[r];
        for (let i = info.start[r]; i < info.start[r + 1]; i++) {
          const p = info.pixels[i];
          const x = p % GW;
          const y = (p - x) / GW;
          const k = ((y * RS + 1) * cw + x * RS + 1) * 4;
          if (data[k + 3] >= 128 && Math.abs(data[k] - tr) < 40 && Math.abs(data[k + 1] - tg) < 40 && Math.abs(data[k + 2] - tb) < 40) good++;
        }
        if (good / total >= DONE_RATIO) {
          correct[r] = 1;
          ok++;
        }
      }
      const pct = info.count ? Math.floor((ok / info.count) * 100) : 0;
      progress.textContent = api.t('paint.progress', { p: pct });
      drawLines();
      if (ok === info.count && !state.completed) api.send('complete', {});
    }

    function toGrid(e) {
      const r = lineCanvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * GW, ((e.clientY - r.top) / r.height) * GH];
    }

    function flush() {
      if (!drawing || drawing.pts.length <= drawing.sent) return;
      // Re-send the last already-sent point so chunks join up seamlessly.
      const from = Math.max(0, drawing.sent - 2);
      api.send('stroke', { color: drawing.color, size: drawing.size, pts: drawing.pts.slice(from) });
      drawing.sent = drawing.pts.length;
    }

    lineCanvas.addEventListener('pointerdown', (e) => {
      if (!info || !e.isPrimary) return;
      e.preventDefault();
      if (tool === 'hand') {
        lineCanvas.setPointerCapture(e.pointerId);
        panning = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, left: stageWrap.scrollLeft, top: stageWrap.scrollTop };
        lineCanvas.style.cursor = 'grabbing';
        return;
      }
      const [x, y] = toGrid(e);
      if (tool === 'bucket') {
        const gx = Math.min(GW - 1, Math.max(0, Math.floor(x)));
        const gy = Math.min(GH - 1, Math.max(0, Math.floor(y)));
        const region = info.comp[gy * GW + gx];
        paintOp({ t: 'f', c: color, r: region });
        api.send('fill', { region, color });
        return;
      }
      lineCanvas.setPointerCapture(e.pointerId);
      const sz = size / zoom; // brush keeps its on-screen size when zoomed in
      drawing = { pointerId: e.pointerId, color, size: sz, pts: [x, y], sent: 0, timer: setInterval(flush, 60) };
      paintOp({ t: 's', c: color, w: sz, p: [x, y] });
    });

    lineCanvas.addEventListener('pointermove', (e) => {
      if (panning && e.pointerId === panning.pointerId) {
        stageWrap.scrollLeft = panning.left - (e.clientX - panning.x);
        stageWrap.scrollTop = panning.top - (e.clientY - panning.y);
        return;
      }
      const [x, y] = toGrid(e);
      api.cursor(x, y);
      if (!drawing || e.pointerId !== drawing.pointerId) return;
      const p = drawing.pts;
      const lx = p[p.length - 2];
      const ly = p[p.length - 1];
      if (Math.hypot(x - lx, y - ly) < 1) return;
      p.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
      paintOp({ t: 's', c: drawing.color, w: drawing.size, p: [lx, ly, x, y] });
      if (p.length >= 400) flush();
    });

    const endPointer = (e) => {
      if (panning && e.pointerId === panning.pointerId) {
        panning = null;
        lineCanvas.style.cursor = 'grab';
      }
      if (!drawing || e.pointerId !== drawing.pointerId) return;
      flush();
      clearInterval(drawing.timer);
      drawing = null;
    };
    lineCanvas.addEventListener('pointerup', endPointer);
    lineCanvas.addEventListener('pointercancel', endPointer);

    let cursorHide = null;

    return {
      onState(s) {
        state = s;
        // Analysing a template blocks for a moment, so let the "preparing" message paint first.
        requestAnimationFrame(() => setTimeout(() => {
          if (state !== s) return;
          info = analyse(s.template);
          buildPalette();
          refBox.replaceChildren(info.reference);
          pctx.setTransform(1, 0, 0, 1, 0, 0);
          pctx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
          for (const op of s.ops) applyOp(op);
          queued.forEach(paintOp);
          queued = [];
          check();
          loading.remove();
        }, 0));
      },
      onEvent(type, data) {
        if (type === 'op') {
          if (info) paintOp(data);
          else queued.push(data);
        } else if (type === 'clear') {
          state.ops = [];
          queued = [];
          state.completed = false;
          pctx.setTransform(1, 0, 0, 1, 0, 0);
          pctx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
          scheduleCheck();
        } else if (type === 'complete') {
          state.completed = true;
          api.celebrate(api.t('paint.done'));
        }
      },
      onCursor(pid, x, y) {
        const who = api.player(pid);
        if (!who) return;
        cursorEl.hidden = false;
        cursorEl.textContent = who.name;
        cursorEl.style.setProperty('--c', who.color);
        cursorEl.style.left = `${(x / GW) * 100}%`;
        cursorEl.style.top = `${(y / GH) * 100}%`;
        clearTimeout(cursorHide);
        cursorHide = setTimeout(() => { cursorEl.hidden = true; }, 3000);
      },
      destroy() {
        fit.disconnect();
        clearTimeout(checkTimer);
        clearTimeout(cursorHide);
        if (drawing) clearInterval(drawing.timer);
      },
    };
  },
};
