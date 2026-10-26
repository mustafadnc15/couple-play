/** Procedurally drawn built-in puzzle pictures (4:3). Deterministic so both partners see the same image. */
import { rand32 } from './ui.js';

function heart(ctx, x, y, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 100, size / 100);
  ctx.beginPath();
  ctx.moveTo(0, 30);
  ctx.bezierCurveTo(0, 0, -50, 0, -50, 30);
  ctx.bezierCurveTo(-50, 60, 0, 80, 0, 100);
  ctx.bezierCurveTo(0, 80, 50, 60, 50, 30);
  ctx.bezierCurveTo(50, 0, 0, 0, 0, 30);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function sunset(ctx, w, h) {
  const rnd = rand32(7);
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
  sky.addColorStop(0, '#3b1c6e');
  sky.addColorStop(0.35, '#b23a8a');
  sky.addColorStop(0.7, '#ff7a59');
  sky.addColorStop(1, '#ffd36e');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // sun
  const sun = ctx.createRadialGradient(w * 0.5, h * 0.55, 10, w * 0.5, h * 0.55, h * 0.22);
  sun.addColorStop(0, '#fff6c2');
  sun.addColorStop(1, '#ffb347');
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.56, h * 0.18, 0, Math.PI * 2);
  ctx.fill();

  // mountains
  const layers = [['#6b2d6f', 0.42], ['#4a1f5c', 0.5], ['#2e1446', 0.58]];
  layers.forEach(([color, base], i) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.62);
    let x = 0;
    while (x <= w) {
      ctx.lineTo(x, h * (base + rnd() * 0.08) + i * 6);
      x += w / (5 + i * 2);
    }
    ctx.lineTo(w, h * 0.62);
    ctx.closePath();
    ctx.fill();
  });

  // sea
  const sea = ctx.createLinearGradient(0, h * 0.62, 0, h);
  sea.addColorStop(0, '#ff8a65');
  sea.addColorStop(0.3, '#8e3b8f');
  sea.addColorStop(1, '#1d1240');
  ctx.fillStyle = sea;
  ctx.fillRect(0, h * 0.62, w, h * 0.38);
  for (let i = 0; i < 26; i++) {
    const y = h * 0.64 + i * h * 0.013;
    const len = (w * 0.22) * (1 - i / 30) * (0.6 + rnd() * 0.6);
    ctx.fillStyle = `rgba(255, 220, 150, ${0.55 - i * 0.018})`;
    ctx.fillRect(w * 0.5 - len / 2 + (rnd() - 0.5) * 30, y, len, 3);
  }

  // little boat with two hearts
  ctx.fillStyle = '#1b0f2e';
  ctx.beginPath();
  ctx.moveTo(w * 0.7, h * 0.78);
  ctx.lineTo(w * 0.82, h * 0.78);
  ctx.lineTo(w * 0.8, h * 0.81);
  ctx.lineTo(w * 0.72, h * 0.81);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(w * 0.757, h * 0.66, 4, h * 0.12);
  ctx.beginPath();
  ctx.moveTo(w * 0.763, h * 0.67);
  ctx.lineTo(w * 0.81, h * 0.76);
  ctx.lineTo(w * 0.763, h * 0.76);
  ctx.closePath();
  ctx.fill();

  // birds
  ctx.strokeStyle = '#2e1446';
  ctx.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    const bx = w * (0.15 + rnd() * 0.3);
    const by = h * (0.12 + rnd() * 0.2);
    const s = 10 + rnd() * 10;
    ctx.beginPath();
    ctx.moveTo(bx - s, by);
    ctx.quadraticCurveTo(bx - s / 2, by - s / 2, bx, by);
    ctx.quadraticCurveTo(bx + s / 2, by - s / 2, bx + s, by);
    ctx.stroke();
  }
  heart(ctx, w * 0.78, h * 0.1, 70, 'rgba(255, 120, 170, 0.85)');
  heart(ctx, w * 0.86, h * 0.2, 44, 'rgba(255, 200, 220, 0.8)');
}

function night(ctx, w, h) {
  const rnd = rand32(42);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#0b1033');
  sky.addColorStop(0.6, '#24215e');
  sky.addColorStop(1, '#5b3a8c');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // milky way glow
  const glow = ctx.createLinearGradient(0, h, w, 0);
  glow.addColorStop(0.3, 'rgba(255,255,255,0)');
  glow.addColorStop(0.5, 'rgba(180,160,255,0.18)');
  glow.addColorStop(0.7, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 260; i++) {
    const r = rnd() * 1.8 + 0.3;
    ctx.fillStyle = `rgba(255,255,${200 + rnd() * 55},${0.4 + rnd() * 0.6})`;
    ctx.beginPath();
    ctx.arc(rnd() * w, rnd() * h * 0.7, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // heart constellation
  const pts = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const x = 16 * Math.sin(a) ** 3;
    const y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
    pts.push([w * 0.27 + x * 7, h * 0.3 + y * 7]);
  }
  ctx.strokeStyle = 'rgba(255, 180, 220, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.stroke();
  pts.forEach(([x, y]) => {
    ctx.fillStyle = '#ffe3f1';
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // moon
  ctx.fillStyle = '#fff4c9';
  ctx.beginPath();
  ctx.arc(w * 0.78, h * 0.2, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#141846';
  ctx.beginPath();
  ctx.arc(w * 0.76 + 28, h * 0.2 - 14, 54, 0, Math.PI * 2);
  ctx.fill();

  // skyline
  let x = 0;
  while (x < w) {
    const bw = 40 + rnd() * 70;
    const bh = h * (0.12 + rnd() * 0.25);
    ctx.fillStyle = rnd() < 0.5 ? '#151233' : '#1e1945';
    ctx.fillRect(x, h - bh, bw, bh);
    for (let wy = h - bh + 10; wy < h - 10; wy += 16) {
      for (let wx = x + 8; wx < x + bw - 10; wx += 14) {
        if (rnd() < 0.35) {
          ctx.fillStyle = rnd() < 0.7 ? '#ffd27a' : '#ff9ec7';
          ctx.fillRect(wx, wy, 6, 8);
        }
      }
    }
    x += bw + 2;
  }
}

function garden(ctx, w, h) {
  const rnd = rand32(99);
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6);
  sky.addColorStop(0, '#7ec8ff');
  sky.addColorStop(1, '#d9f1ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#fff3a8';
  ctx.beginPath();
  ctx.arc(w * 0.12, h * 0.14, 50, 0, Math.PI * 2);
  ctx.fill();

  const cloud = (cx, cy, s) => {
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    [[0, 0, 1], [-0.9, 0.2, 0.7], [0.9, 0.25, 0.7], [0.4, -0.4, 0.75]].forEach(([dx, dy, r]) => {
      ctx.beginPath();
      ctx.arc(cx + dx * s, cy + dy * s, r * s, 0, Math.PI * 2);
      ctx.fill();
    });
  };
  cloud(w * 0.42, h * 0.14, 40);
  cloud(w * 0.75, h * 0.24, 30);

  // hills
  const hills = [['#9be36d', 0.55, 0.3], ['#6cc551', 0.66, 0.65], ['#4caf50', 0.78, 0.15]];
  hills.forEach(([color, top, cx]) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(w * cx, h * (top + 0.35), w * 0.7, h * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // tree
  ctx.fillStyle = '#8b5a2b';
  ctx.fillRect(w * 0.8, h * 0.38, 26, h * 0.25);
  ['#2e8b57', '#3cb371', '#2e8b57'].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(w * 0.81 + (i - 1) * 40, h * 0.35 - (i === 1 ? 30 : 0), 62, 0, Math.PI * 2);
    ctx.fill();
  });
  for (let i = 0; i < 12; i++) heart(ctx, w * 0.74 + rnd() * 140, h * 0.2 + rnd() * 130, 16, '#ff6f91');

  // heart balloon
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w * 0.58, h * 0.36);
  ctx.quadraticCurveTo(w * 0.55, h * 0.5, w * 0.57, h * 0.62);
  ctx.stroke();
  heart(ctx, w * 0.58, h * 0.16, 110, '#ff3d6e');

  // flowers
  const petals = ['#ff6f91', '#ffc75f', '#f9f871', '#c34a36', '#d65db1', '#ffffff', '#845ec2'];
  for (let i = 0; i < 70; i++) {
    const fx = rnd() * w;
    const fy = h * (0.68 + rnd() * 0.3);
    const s = 6 + rnd() * 9 * (fy / h);
    ctx.strokeStyle = '#2f7d32';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx, fy + s * 2.5);
    ctx.stroke();
    ctx.fillStyle = petals[i % petals.length];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(fx + Math.cos(a) * s * 0.8, fy + Math.sin(a) * s * 0.8, s * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(fx, fy, s * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
}

const ARTS = { sunset, night, garden };
export const ART_IDS = Object.keys(ARTS);

export function renderArt(id, w = 960, h = 720) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(w / 960, h / 720);
  (ARTS[id] || sunset)(ctx, 960, 720);
  ctx.restore();
  return canvas;
}
