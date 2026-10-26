/**
 * Turns any picture into a paint-by-number template: colour quantisation (k-means in Lab space),
 * noise smoothing, and merging of tiny areas so every region is big enough to paint.
 * Only the partner who starts the game runs this; the result is shared through the server so
 * both partners get exactly the same regions.
 */
import { rand32 } from './ui.js';

export const GW = 600;
export const GH = 450;

export const DETAIL = {
  easy: { colors: 8, minArea: 900 },
  medium: { colors: 12, minArea: 380 },
  hard: { colors: 16, minArea: 160 },
};

function toLab(r, g, b) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Draw the source center-cropped to 4:3 at grid size and lightly blur it. */
function sample(source) {
  const sw0 = source.naturalWidth || source.width;
  const sh0 = source.naturalHeight || source.height;
  let sw = sw0;
  let sh = sh0;
  if (sw / sh > GW / GH) sw = sh * (GW / GH);
  else sh = sw / (GW / GH);
  const canvas = document.createElement('canvas');
  canvas.width = GW;
  canvas.height = GH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, (sw0 - sw) / 2, (sh0 - sh) / 2, sw, sh, 0, 0, GW, GH);
  const src = ctx.getImageData(0, 0, GW, GH).data;
  // 3×3 box blur so photo grain doesn't turn into confetti regions.
  const out = new Float32Array(GW * GH * 3);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= GH) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= GW) continue;
          const k = (yy * GW + xx) * 4;
          r += src[k];
          g += src[k + 1];
          b += src[k + 2];
          n++;
        }
      }
      const o = (y * GW + x) * 3;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
    }
  }
  return out;
}

function kmeans(lab, k, rand) {
  const n = lab.length / 3;
  const sampleCount = Math.min(n, 16000);
  const idx = Array.from({ length: sampleCount }, () => Math.floor(rand() * n));
  const dist2 = (i, c, centers) => {
    const a = lab[i * 3] - centers[c * 3];
    const b = lab[i * 3 + 1] - centers[c * 3 + 1];
    const d = lab[i * 3 + 2] - centers[c * 3 + 2];
    return a * a + b * b + d * d;
  };

  // k-means++ seeding
  const centers = new Float32Array(k * 3);
  const first = idx[0];
  centers.set(lab.subarray(first * 3, first * 3 + 3), 0);
  const best = new Float32Array(sampleCount).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let sum = 0;
    for (let s = 0; s < sampleCount; s++) {
      best[s] = Math.min(best[s], dist2(idx[s], c - 1, centers));
      sum += best[s];
    }
    let pickAt = rand() * sum;
    let chosen = idx[sampleCount - 1];
    for (let s = 0; s < sampleCount; s++) {
      pickAt -= best[s];
      if (pickAt <= 0) {
        chosen = idx[s];
        break;
      }
    }
    centers.set(lab.subarray(chosen * 3, chosen * 3 + 3), c * 3);
  }

  for (let iter = 0; iter < 14; iter++) {
    const acc = new Float64Array(k * 4);
    for (const i of idx) {
      let bc = 0;
      let bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist2(i, c, centers);
        if (d < bd) {
          bd = d;
          bc = c;
        }
      }
      acc[bc * 4] += lab[i * 3];
      acc[bc * 4 + 1] += lab[i * 3 + 1];
      acc[bc * 4 + 2] += lab[i * 3 + 2];
      acc[bc * 4 + 3]++;
    }
    for (let c = 0; c < k; c++) {
      const m = acc[c * 4 + 3];
      if (m) for (let j = 0; j < 3; j++) centers[c * 3 + j] = acc[c * 4 + j] / m;
    }
  }

  const assign = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let bc = 0;
    let bd = Infinity;
    for (let c = 0; c < k; c++) {
      const d = dist2(i, c, centers);
      if (d < bd) {
        bd = d;
        bc = c;
      }
    }
    assign[i] = bc;
  }
  return assign;
}

/** 3×3 majority filter: removes speckles and jagged edges. */
function modeFilter(a, k) {
  const out = new Uint8Array(a.length);
  const counts = new Uint16Array(k);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      counts.fill(0);
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(GH - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(GW - 1, Math.max(0, x + dx));
          counts[a[yy * GW + xx]]++;
        }
      }
      let bc = a[y * GW + x];
      for (let c = 0; c < k; c++) if (counts[c] > counts[bc]) bc = c;
      out[y * GW + x] = bc;
    }
  }
  return out;
}

/** 4-connected components of equal colour. Returns { comp, sizes, count }. */
export function components(colors) {
  const n = colors.length;
  const comp = new Int32Array(n).fill(-1);
  const sizes = [];
  const stack = new Int32Array(n);
  let count = 0;
  for (let s = 0; s < n; s++) {
    if (comp[s] !== -1) continue;
    const color = colors[s];
    let top = 0;
    let size = 0;
    stack[top++] = s;
    comp[s] = count;
    while (top) {
      const p = stack[--top];
      size++;
      const x = p % GW;
      const neighbours = [x > 0 ? p - 1 : -1, x < GW - 1 ? p + 1 : -1, p - GW, p + GW];
      for (const q of neighbours) {
        if (q < 0 || q >= n || comp[q] !== -1 || colors[q] !== color) continue;
        comp[q] = count;
        stack[top++] = q;
      }
    }
    sizes.push(size);
    count++;
  }
  return { comp, sizes, count };
}

/** Repaint regions smaller than minArea with the colour they share the longest border with. */
function mergeSmall(colors, minArea) {
  for (let pass = 0; pass < 12; pass++) {
    const { comp, sizes } = components(colors);
    const votes = new Map();
    let any = false;
    for (let p = 0; p < colors.length; p++) {
      const c = comp[p];
      if (sizes[c] >= minArea) continue;
      any = true;
      const x = p % GW;
      const neighbours = [x > 0 ? p - 1 : -1, x < GW - 1 ? p + 1 : -1, p - GW, p + GW];
      for (const q of neighbours) {
        if (q < 0 || q >= colors.length || comp[q] === c) continue;
        let v = votes.get(c);
        if (!v) votes.set(c, (v = new Map()));
        // Votes from big neighbours count far more, so two tiny neighbours don't just swap colours.
        const weight = sizes[comp[q]] >= minArea ? 1000 : 1;
        v.set(colors[q], (v.get(colors[q]) || 0) + weight);
      }
    }
    if (!any) return;
    const target = new Map();
    for (const [c, v] of votes) {
      let bestColor = -1;
      let bestVotes = -1;
      for (const [color, n] of v) {
        if (n > bestVotes) {
          bestVotes = n;
          bestColor = color;
        }
      }
      target.set(c, bestColor);
    }
    for (let p = 0; p < colors.length; p++) {
      const t = target.get(comp[p]);
      if (t !== undefined) colors[p] = t;
    }
  }
}

function hex(r, g, b) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

export function encodeRle(a) {
  const out = [];
  let i = 0;
  while (i < a.length) {
    let j = i;
    while (j < a.length && a[j] === a[i]) j++;
    out.push(a[i], j - i);
    i = j;
  }
  return out;
}

export function decodeRle(rle, n) {
  const a = new Uint8Array(n);
  let p = 0;
  for (let i = 0; i < rle.length; i += 2) {
    a.fill(rle[i], p, p + rle[i + 1]);
    p += rle[i + 1];
  }
  return a;
}

/** Build a template from an image/canvas. Returns { w, h, palette: ['#rrggbb'], rle }. */
export function buildTemplate(source, detail = 'medium') {
  const { colors: k, minArea } = DETAIL[detail] || DETAIL.medium;
  const rgb = sample(source);
  const n = GW * GH;
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) lab.set(toLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]), i * 3);

  let colors = kmeans(lab, k, rand32(1234));
  colors = modeFilter(modeFilter(modeFilter(colors, k), k), k);
  mergeSmall(colors, minArea);

  // Palette = average original colour of each cluster; drop clusters that vanished, darkest first.
  const acc = new Float64Array(k * 4);
  for (let i = 0; i < n; i++) {
    const c = colors[i];
    acc[c * 4] += rgb[i * 3];
    acc[c * 4 + 1] += rgb[i * 3 + 1];
    acc[c * 4 + 2] += rgb[i * 3 + 2];
    acc[c * 4 + 3]++;
  }
  const used = [];
  for (let c = 0; c < k; c++) {
    const m = acc[c * 4 + 3];
    if (m) used.push({ c, rgb: [acc[c * 4] / m, acc[c * 4 + 1] / m, acc[c * 4 + 2] / m] });
  }
  used.sort((a, b) => toLab(...a.rgb)[0] - toLab(...b.rgb)[0]);
  const remap = new Uint8Array(k);
  used.forEach((u, i) => { remap[u.c] = i; });
  for (let i = 0; i < n; i++) colors[i] = remap[colors[i]];

  return { w: GW, h: GH, palette: used.map((u) => hex(...u.rgb)), rle: encodeRle(colors) };
}
