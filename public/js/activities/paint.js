import { el, choiceField } from '../lib/ui.js';
import { TEMPLATES } from './paintTemplates.js';

const W = 800;
const H = 600;
const RS = 1.5; // canvas pixels per template unit
const STEP = 4; // region grid resolution in template units
const GW = W / STEP;
const GH = H / STEP;
const ERASER = '#ffffff';
const DONE_RATIO = 0.85;

const cache = new Map();

/** Region index for every grid cell plus a label spot per region (the point farthest from its border). */
function analyse(id) {
  if (cache.has(id)) return cache.get(id);
  const tpl = TEMPLATES[id];
  const paths = tpl.regions.map((r) => new Path2D(r.d));
  const probe = document.createElement('canvas').getContext('2d');
  const grid = new Int16Array(GW * GH).fill(-1);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const x = gx * STEP + STEP / 2;
      const y = gy * STEP + STEP / 2;
      for (let i = paths.length - 1; i >= 0; i--) {
        if (probe.isPointInPath(paths[i], x, y)) {
          grid[gy * GW + gx] = i;
          break;
        }
      }
    }
  }

  // Chamfer distance transform to the nearest cell of another region.
  const dist = new Float32Array(GW * GH);
  const at = (x, y) => (x < 0 || y < 0 || x >= GW || y >= GH ? -2 : grid[y * GW + x]);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const r = grid[y * GW + x];
      const edge = at(x - 1, y) !== r || at(x + 1, y) !== r || at(x, y - 1) !== r || at(x, y + 1) !== r;
      dist[y * GW + x] = edge ? 1 : 1e9;
    }
  }
  const relax = (x, y, nx, ny, w) => {
    if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) return;
    const i = y * GW + x;
    const v = dist[ny * GW + nx] + w;
    if (v < dist[i]) dist[i] = v;
  };
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      relax(x, y, x - 1, y, 1); relax(x, y, x, y - 1, 1); relax(x, y, x - 1, y - 1, 1.41); relax(x, y, x + 1, y - 1, 1.41);
    }
  }
  for (let y = GH - 1; y >= 0; y--) {
    for (let x = GW - 1; x >= 0; x--) {
      relax(x, y, x + 1, y, 1); relax(x, y, x, y + 1, 1); relax(x, y, x + 1, y + 1, 1.41); relax(x, y, x - 1, y + 1, 1.41);
    }
  }
  const labels = paths.map(() => ({ x: 0, y: 0, d: -1 }));
  for (let i = 0; i < grid.length; i++) {
    const r = grid[i];
    if (r >= 0 && dist[i] > labels[r].d) {
      labels[r] = { x: (i % GW) * STEP + STEP / 2, y: Math.floor(i / GW) * STEP + STEP / 2, d: dist[i] };
    }
  }
  const result = { tpl, paths, grid, labels };
  cache.set(id, result);
  return result;
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
  c.width = W * RS;
  c.height = H * RS;
  return c;
}

export default {
  id: 'paint',
  icon: '🎨',
  accent: '#6c63ff',

  renderOptions(container, { t }) {
    const icons = { sunset: '🌅', house: '🏡', balloons: '🎈' };
    const template = choiceField(t('opt.template'), Object.entries(icons).map(([id, icon]) => ({
      value: id, label: t(`art.${id}`), preview: el('span', { class: 'thumb emoji-thumb', text: icon }),
    })), 'sunset');
    container.append(template.node);
    return () => ({ template: template.get() });
  },

  mount(root, api) {
    let state = null;
    let info = null;
    let color = null;
    let tool = 'brush';
    let size = 16;
    let correct = [];
    let checkTimer = null;
    let drawing = null;
    let queued = []; // ops that arrive while the template is still being prepared

    const paintCanvas = makeCanvas();
    const lineCanvas = makeCanvas();
    const outline = makeCanvas();
    const mask = makeCanvas();
    paintCanvas.className = 'paint-layer';
    lineCanvas.className = 'paint-layer paint-lines';
    const pctx = paintCanvas.getContext('2d', { willReadFrequently: true });
    const lctx = lineCanvas.getContext('2d');

    const cursorEl = el('div', { class: 'remote-cursor', hidden: true });
    const stage = el('div', { class: 'paint-stage' }, paintCanvas, lineCanvas, cursorEl);
    const stageWrap = el('div', { class: 'paint-stage-wrap' }, stage);
    const palette = el('div', { class: 'palette' });
    const sizeInput = el('input', { type: 'range', min: 3, max: 60, value: size, 'aria-label': api.t('paint.size') });
    const toolBtns = {
      brush: el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: `🖌️ ${api.t('paint.brush')}` }),
      bucket: el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: `🪣 ${api.t('paint.bucket')}` }),
    };
    const loading = el('div', { class: 'paint-loading', text: api.t('paint.loading') });
    const side = el('div', { class: 'paint-side' },
      palette,
      el('div', { class: 'paint-tools' },
        toolBtns.brush, toolBtns.bucket,
        el('label', { class: 'size-field' }, el('span', { text: api.t('paint.size') }), sizeInput)));
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
    }
    toolBtns.brush.onclick = () => setTool('brush');
    toolBtns.bucket.onclick = () => setTool('bucket');
    sizeInput.oninput = () => { size = Number(sizeInput.value); };
    setTool('brush');

    // Keep the 4:3 stage as large as the available space allows.
    const fit = new ResizeObserver(() => {
      const r = stageWrap.getBoundingClientRect();
      const w = Math.min(r.width, r.height * (W / H));
      stage.style.width = `${w}px`;
      stage.style.height = `${w * (H / W)}px`;
    });
    fit.observe(stageWrap);

    function buildPalette() {
      palette.replaceChildren();
      const swatches = info.tpl.palette.map((hex, i) => {
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

    function drawOutline() {
      const g = outline.getContext('2d');
      g.setTransform(RS, 0, 0, RS, 0, 0);
      g.clearRect(0, 0, W, H);
      g.lineJoin = 'round';
      g.strokeStyle = '#3b3350';
      g.lineWidth = 4;
      for (const path of info.paths) {
        // Erase lines of regions underneath, then keep only the outer half of this region's stroke
        // so shapes built from overlapping circles (clouds, trees) show a single outline.
        g.globalCompositeOperation = 'destination-out';
        g.fill(path);
        g.globalCompositeOperation = 'source-over';
        g.stroke(path);
        g.globalCompositeOperation = 'destination-out';
        g.fill(path);
      }
      g.globalCompositeOperation = 'source-over';
      g.lineWidth = 2.5;
      for (const d of info.tpl.lines) g.stroke(new Path2D(d));
      g.strokeRect(1, 1, W - 2, H - 2);
    }

    function drawLines() {
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, lineCanvas.width, lineCanvas.height);
      lctx.drawImage(outline, 0, 0);
      lctx.setTransform(RS, 0, 0, RS, 0, 0);
      lctx.textAlign = 'center';
      lctx.textBaseline = 'middle';
      info.labels.forEach((lab, i) => {
        if (lab.d < 0 || correct[i]) return;
        const fontSize = Math.max(9, Math.min(26, lab.d * STEP * 0.9));
        lctx.font = `800 ${fontSize}px Nunito, sans-serif`;
        lctx.lineWidth = 3;
        lctx.strokeStyle = 'rgba(255,255,255,0.85)';
        const num = String(info.tpl.regions[i].c + 1);
        lctx.strokeText(num, lab.x, lab.y);
        lctx.fillStyle = '#3b3350';
        lctx.fillText(num, lab.x, lab.y);
      });
    }

    function applyOp(op) {
      pctx.setTransform(RS, 0, 0, RS, 0, 0);
      if (op.t === 's') {
        const p = op.p;
        pctx.strokeStyle = op.c;
        pctx.fillStyle = op.c;
        pctx.lineWidth = op.w;
        pctx.lineCap = 'round';
        pctx.lineJoin = 'round';
        if (p.length === 2) {
          pctx.beginPath();
          pctx.arc(p[0], p[1], op.w / 2, 0, Math.PI * 2);
          pctx.fill();
        } else {
          pctx.beginPath();
          pctx.moveTo(p[0], p[1]);
          for (let i = 2; i < p.length; i += 2) pctx.lineTo(p[i], p[i + 1]);
          pctx.stroke();
        }
      } else if (op.t === 'f') {
        const path = info.paths[op.r];
        if (!path) return;
        const m = mask.getContext('2d');
        m.setTransform(1, 0, 0, 1, 0, 0);
        m.globalCompositeOperation = 'source-over';
        m.clearRect(0, 0, mask.width, mask.height);
        m.setTransform(RS, 0, 0, RS, 0, 0);
        m.fillStyle = '#000';
        m.strokeStyle = '#000';
        m.lineWidth = 3;
        m.fill(path);
        m.stroke(path);
        m.globalCompositeOperation = 'destination-out';
        for (let j = op.r + 1; j < info.paths.length; j++) m.fill(info.paths[j]);
        m.globalCompositeOperation = 'source-in';
        m.fillStyle = op.c;
        m.fillRect(-10, -10, W + 20, H + 20);
        pctx.setTransform(1, 0, 0, 1, 0, 0);
        pctx.drawImage(mask, 0, 0);
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
      checkTimer = setTimeout(check, 600);
    }

    function check() {
      if (!info) return;
      const data = pctx.getImageData(0, 0, paintCanvas.width, paintCanvas.height).data;
      const n = info.paths.length;
      const total = new Uint32Array(n);
      const good = new Uint32Array(n);
      const targets = info.tpl.regions.map((r) => hexToRgb(info.tpl.palette[r.c]));
      for (let gy = 0; gy < GH; gy++) {
        for (let gx = 0; gx < GW; gx++) {
          const r = info.grid[gy * GW + gx];
          if (r < 0) continue;
          const px = Math.floor((gx * STEP + STEP / 2) * RS);
          const py = Math.floor((gy * STEP + STEP / 2) * RS);
          const k = (py * paintCanvas.width + px) * 4;
          const opaque = data[k + 3] >= 128;
          const [tr, tg, tb] = targets[r];
          total[r]++;
          if (opaque && Math.abs(data[k] - tr) < 40 && Math.abs(data[k + 1] - tg) < 40 && Math.abs(data[k + 2] - tb) < 40) good[r]++;
        }
      }
      let countable = 0;
      let ok = 0;
      correct = [];
      for (let i = 0; i < n; i++) {
        if (!total[i]) continue;
        countable++;
        correct[i] = good[i] / total[i] >= DONE_RATIO;
        if (correct[i]) ok++;
      }
      const pct = countable ? Math.round((ok / countable) * 100) : 0;
      progress.textContent = api.t('paint.progress', { p: pct });
      drawLines();
      if (pct === 100 && !state.completed) api.send('complete', {});
    }

    function toTemplate(e) {
      const r = lineCanvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
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
      const [x, y] = toTemplate(e);
      if (tool === 'bucket') {
        const gx = Math.min(GW - 1, Math.max(0, Math.floor(x / STEP)));
        const gy = Math.min(GH - 1, Math.max(0, Math.floor(y / STEP)));
        const region = info.grid[gy * GW + gx];
        if (region < 0) return;
        paintOp({ t: 'f', c: color, r: region });
        api.send('fill', { region, color });
        return;
      }
      lineCanvas.setPointerCapture(e.pointerId);
      drawing = { pointerId: e.pointerId, color, size, pts: [x, y], sent: 0, timer: setInterval(flush, 60) };
      paintOp({ t: 's', c: color, w: size, p: [x, y] });
    });

    lineCanvas.addEventListener('pointermove', (e) => {
      const [x, y] = toTemplate(e);
      api.cursor(x, y);
      if (!drawing || e.pointerId !== drawing.pointerId) return;
      const p = drawing.pts;
      const lx = p[p.length - 2];
      const ly = p[p.length - 1];
      if (Math.hypot(x - lx, y - ly) < 1.5) return;
      p.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
      paintOp({ t: 's', c: drawing.color, w: drawing.size, p: [lx, ly, x, y] });
      if (p.length >= 400) flush();
    });

    const endStroke = (e) => {
      if (!drawing || e.pointerId !== drawing.pointerId) return;
      flush();
      clearInterval(drawing.timer);
      drawing = null;
    };
    lineCanvas.addEventListener('pointerup', endStroke);
    lineCanvas.addEventListener('pointercancel', endStroke);

    let cursorHide = null;

    return {
      onState(s) {
        state = s;
        // Analysing a template blocks for a moment, so let the "preparing" message paint first.
        requestAnimationFrame(() => setTimeout(() => {
          info = analyse(s.template);
          buildPalette();
          drawOutline();
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
        cursorEl.style.left = `${(x / W) * 100}%`;
        cursorEl.style.top = `${(y / H) * 100}%`;
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
