// 程序化 canvas 贴图（全部本地生成，无外部素材）
import * as THREE from 'three';

function canvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function tex(c, { repeat = [1, 1], srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
// 亮度图（用作 bumpMap）
function bumpFrom(c) {
  const [b, bx] = canvas(c.width);
  bx.drawImage(c, 0, 0);
  const img = bx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const l = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    img.data[i] = img.data[i + 1] = img.data[i + 2] = l;
  }
  bx.putImageData(img, 0, 0);
  return tex(b, { srgb: false });
}

function noise(ctx, s, n, a) {
  const r = rng(s);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},0,${a * r()})`;
    ctx.fillRect(r() * s, r() * s, 2, 2);
  }
}

// ---- 地面：泥土 + 网格缝 ----
export function groundTexture() {
  const [c, x] = canvas(256);
  x.fillStyle = '#5d6146'; x.fillRect(0, 0, 256, 256);
  const r = rng(7);
  for (let i = 0; i < 90; i++) {
    x.fillStyle = `rgba(${40 + r() * 60 | 0},${50 + r() * 50 | 0},${30 + r() * 30 | 0},${0.12 + r() * 0.15})`;
    x.beginPath();
    x.ellipse(r() * 256, r() * 256, 8 + r() * 26, 6 + r() * 18, r() * 3, 0, 7);
    x.fill();
  }
  noise(x, 256, 1500, 0.05);
  // 瓦片缝（每格 4m）
  x.strokeStyle = 'rgba(30,32,22,0.55)'; x.lineWidth = 3;
  x.strokeRect(1, 1, 254, 254);
  x.strokeStyle = 'rgba(255,255,240,0.06)'; x.lineWidth = 1;
  x.strokeRect(3, 3, 250, 250);
  return { map: tex(c, { repeat: [13, 13] }), bump: bumpFrom(c) };
}

// ---- 砖墙（完整 / 裂纹两态） ----
function brickDraw(x, cracked, seed) {
  x.fillStyle = '#8a3b2a'; x.fillRect(0, 0, 256, 256);
  const r = rng(seed);
  const bw = 64, bh = 42;
  for (let row = 0; row < 6; row++) {
    const off = row % 2 ? -bw / 2 : 0;
    for (let col = -1; col < 5; col++) {
      const px = col * bw + off, py = row * bh + 4;
      const shade = 0.75 + r() * 0.5;
      x.fillStyle = `rgb(${139 * shade | 0},${58 * shade | 0},${42 * shade | 0})`;
      x.fillRect(px + 3, py + 3, bw - 6, bh - 6);
      x.fillStyle = 'rgba(255,210,180,0.14)';
      x.fillRect(px + 3, py + 3, bw - 6, 4);
      x.fillStyle = 'rgba(40,10,5,0.25)';
      x.fillRect(px + 3, py + bh - 9, bw - 6, 4);
    }
  }
  noise(x, 256, 900, 0.08);
  x.strokeStyle = 'rgba(25,25,20,0.8)'; x.lineWidth = 4;
  x.strokeRect(1, 1, 254, 254);
  if (cracked) {
    x.strokeStyle = 'rgba(20,12,8,0.9)'; x.lineWidth = 5;
    const cr = rng(seed + 99);
    for (let k = 0; k < 3; k++) {
      x.beginPath();
      let px = cr() * 256, py = 0;
      x.moveTo(px, py);
      while (py < 256) { py += 20 + cr() * 30; px += (cr() - 0.5) * 60; x.lineTo(px, py); }
      x.stroke();
    }
    // 缺角
    x.fillStyle = 'rgba(35,20,14,0.95)';
    for (let k = 0; k < 5; k++) {
      x.beginPath();
      x.ellipse(cr() * 256, cr() < 0.5 ? 8 : 248, 14 + cr() * 16, 10 + cr() * 10, 0, 0, 7);
      x.fill();
    }
  }
}
export function brickTextures() {
  const [c, x] = canvas(256); brickDraw(x, false, 3);
  const [c2, x2] = canvas(256); brickDraw(x2, true, 41);
  return {
    ok: { map: tex(c), bump: bumpFrom(c) },
    cracked: { map: tex(c2), bump: bumpFrom(c2) },
  };
}

// ---- 钢墙：金属板 + 铆钉 + 斜纹 ----
export function steelTexture() {
  const [c, x] = canvas(256);
  const g = x.createLinearGradient(0, 0, 256, 256);
  g.addColorStop(0, '#93a1b0'); g.addColorStop(0.5, '#6d7987'); g.addColorStop(1, '#8b98a6');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = 'rgba(35,42,50,0.9)'; x.lineWidth = 6;
  x.strokeRect(4, 4, 248, 248);
  x.beginPath(); x.moveTo(4, 128); x.lineTo(252, 128); x.moveTo(128, 4); x.lineTo(128, 252); x.stroke();
  x.strokeStyle = 'rgba(40,48,58,0.55)'; x.lineWidth = 3;
  for (let i = -256; i < 256; i += 34) { x.beginPath(); x.moveTo(i, 256); x.lineTo(i + 256, 0); x.stroke(); }
  const r = rng(11);
  for (const [rx, ry] of [[26, 26], [230, 26], [26, 230], [230, 230], [128, 26], [26, 128], [230, 128], [128, 230]]) {
    x.fillStyle = '#4c5866'; x.beginPath(); x.arc(rx, ry, 8, 0, 7); x.fill();
    x.fillStyle = 'rgba(220,230,240,0.5)'; x.beginPath(); x.arc(rx - 2, ry - 2, 3, 0, 7); x.fill();
  }
  noise(x, 256, 700, 0.06);
  return { map: tex(c), bump: bumpFrom(c) };
}

// ---- 基地：石座 + 星旗 ----
export function baseTexture() {
  const [c, x] = canvas(256);
  x.fillStyle = '#7a7f6a'; x.fillRect(0, 0, 256, 256);
  // 石砖
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    const px = col * 64 + (row % 2 ? 32 : 0) - 32;
    x.strokeStyle = 'rgba(50,55,45,0.8)'; x.lineWidth = 3;
    x.strokeRect(px, row * 64, 64, 64);
  }
  noise(x, 256, 1200, 0.09);
  // 警示条纹角
  x.save();
  x.beginPath(); x.rect(0, 0, 70, 20); x.clip();
  for (let i = -20; i < 90; i += 20) {
    x.fillStyle = i % 40 ? '#d8b432' : '#2c2c2c';
    x.beginPath(); x.moveTo(i, 20); x.lineTo(i + 10, 0); x.lineTo(i + 30, 0); x.lineTo(i + 20, 20); x.fill();
  }
  x.restore();
  // 旗杆 + 星旗
  x.fillStyle = '#3d4348'; x.fillRect(150, 30, 8, 200);
  x.fillStyle = '#2e7d43'; x.beginPath(); x.moveTo(158, 34); x.lineTo(236, 58); x.lineTo(158, 82); x.fill();
  x.fillStyle = '#e8f2e0';
  x.beginPath();
  const sx = 182, sy = 58, sr = 11;
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? sr * 0.45 : sr;
    x.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
  }
  x.fill();
  x.strokeStyle = 'rgba(20,20,15,0.9)'; x.lineWidth = 5; x.strokeRect(2, 2, 252, 252);
  return { map: tex(c), bump: bumpFrom(c) };
}

// ---- 坦克迷彩车体 ----
export function camoTexture(base, dark, light, seed) {
  const [c, x] = canvas(256);
  x.fillStyle = base; x.fillRect(0, 0, 256, 256);
  const r = rng(seed);
  for (let i = 0; i < 26; i++) {
    x.fillStyle = i % 2 ? dark : light;
    x.beginPath();
    x.ellipse(r() * 256, r() * 256, 16 + r() * 34, 10 + r() * 22, r() * 3.2, 0, 7);
    x.fill();
  }
  noise(x, 256, 1100, 0.07);
  // 划痕
  x.strokeStyle = 'rgba(0,0,0,0.28)'; x.lineWidth = 2;
  for (let i = 0; i < 9; i++) {
    x.beginPath();
    x.moveTo(r() * 256, r() * 256);
    x.lineTo(r() * 256, r() * 256);
    x.stroke();
  }
  // 面板线
  x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 4;
  x.strokeRect(6, 6, 244, 244);
  x.beginPath(); x.moveTo(6, 128); x.lineTo(250, 128); x.stroke();
  return { map: tex(c), bump: bumpFrom(c) };
}

// ---- 履带：重复齿纹 ----
export function treadTexture() {
  const [c, x] = canvas(128);
  x.fillStyle = '#2b2e30'; x.fillRect(0, 0, 128, 128);
  const r = rng(5);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 2; col++) {
      const px = col * 64, py = row * 16;
      x.fillStyle = `rgb(${52 + r() * 26 | 0},${55 + r() * 26 | 0},${58 + r() * 26 | 0})`;
      x.fillRect(px + 5, py + 2, 54, 11);
      x.fillStyle = 'rgba(255,255,255,0.10)';
      x.fillRect(px + 5, py + 2, 54, 3);
    }
  }
  noise(x, 128, 500, 0.1);
  const t = tex(c);
  t.repeat.set(3, 1);
  return { map: t, bump: bumpFrom(c) };
}

// ---- 炮管：金属环带 ----
export function barrelTexture() {
  const [c, x] = canvas(128);
  const g = x.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, '#5a636b'); g.addColorStop(0.5, '#8b959d'); g.addColorStop(1, '#5a636b');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 6; i++) {
    x.fillStyle = 'rgba(30,34,38,0.7)';
    x.fillRect(14 + i * 20, 0, 5, 128);
  }
  noise(x, 128, 400, 0.08);
  return { map: tex(c), bump: bumpFrom(c) };
}
