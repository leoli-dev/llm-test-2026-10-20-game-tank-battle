// R3 迷宫结构自检（用法: node tests/r3-maze-check.mjs [draft.txt]）
//  draft.txt = 13 行 × 13 字符 ('.' 空 'B' 砖 'S' 钢)；缺省读 src/level.js 的 R3_MAP。
// 验收指标：
//  1) 砖可穿 → 全图连通（破砖后可解）
//  2) 不穿砖 → 玩家↔每敌出生 初始可绕行（不破坏任何墙就有路线）
//  3) 每敌初始路线：转角 ≥4、长度 ≥12（真巷道，不是一条直道）
//  4) 路线上岔路节点（3+ 邻空）数量 ≥2（可选绕行）
//  5) 内部开放子图含回路（环数 = E - V + 1 ≥ 2）——玩家可循环风筝
//  6) 连续墙段(≥3格) ≥5 条，总墙数 40-80（连续交错墙，不是散砖也不是封死）
//  7) 1 格巷道 4m > 坦克直径 2.3m；出生格/玩家格为空
import { GRID, TILE, PLAYER_SPAWN, ENEMY_SPAWNS } from '../src/level.js';
import { readFileSync } from 'node:fs';

let R3_MAP;
const draft = process.argv[2];
if (draft) {
  R3_MAP = readFileSync(draft, 'utf8').trim().split('\n').map((r) => r.trim());
} else {
  const mod = await import('../src/level.js');
  R3_MAP = mod.R3_MAP;
}

let fail = 0;
const ok = (c, msg) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + msg); if (!c) fail = 1; };

console.log(R3_MAP.join('\n'));
console.log('      0123456789ABC\n');

const passMode = (mode) => (x, z) => {
  if (x < 0 || z < 0 || x >= GRID || z >= GRID) return false;
  const c = R3_MAP[z][x];
  if (c === 'S') return false;
  if (c === 'B') return mode === 'break';
  return true;
};

function bfsPath(mode, sx, sz, gx, gz) {
  const prev = new Map();
  const q = [[sx, sz]];
  const seen = new Set([sz * GRID + sx]);
  while (q.length) {
    const [cx, cz] = q.shift();
    if (cx === gx && cz === gz) break;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (!passMode(mode)(nx, nz) || seen.has(nz * GRID + nx)) continue;
      seen.add(nz * GRID + nx);
      prev.set(nz * GRID + nx, [cx, cz]);
      q.push([nx, nz]);
    }
  }
  if (!seen.has(gz * GRID + gx)) return null;
  const pts = [];
  let cur = [gx, gz];
  while (!(cur[0] === sx && cur[1] === sz)) { pts.push(cur); cur = prev.get(cur[1] * GRID + cur[0]); }
  pts.push([sx, sz]);
  pts.reverse();
  // 转角：比较一致的前进方向（入→当前 与 当前→出），方向不同才算转角
  let turns = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const ax = pts[i][0] - pts[i - 1][0], az = pts[i][1] - pts[i - 1][1];
    const bx = pts[i + 1][0] - pts[i][0], bz = pts[i + 1][1] - pts[i][1];
    if (ax !== bx || az !== bz) turns++;
  }
  return { len: pts.length - 1, turns, pts };
}

// ---- 结构 ----
const badLen = R3_MAP.map((r) => r.length).filter((n) => n !== GRID);
ok(badLen.length === 0, `每行 ${GRID} 格`);
ok(!R3_MAP[PLAYER_SPAWN[1]][PLAYER_SPAWN[0]].match(/[BS]/), '玩家出生格为空');
for (const [x, z] of ENEMY_SPAWNS) ok(!R3_MAP[z][x].match(/[BS]/), `敌出生 (${x},${z}) 为空`);

// ---- 1) 砖可穿全图连通 ----
{
  const seen = new Set([PLAYER_SPAWN[1] * GRID + PLAYER_SPAWN[0]]);
  const q = [[...PLAYER_SPAWN]];
  while (q.length) {
    const [cx, cz] = q.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (!passMode('break')(nx, nz) || seen.has(nz * GRID + nx)) continue;
      seen.add(nz * GRID + nx); q.push([nx, nz]);
    }
  }
  const miss = [];
  for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++)
    if (R3_MAP[z][x] !== 'S' && !seen.has(z * GRID + x)) miss.push(`(${x},${z})`);
  ok(miss.length === 0, `砖可穿全图连通 ${miss.length ? '缺失:' + miss.join(',') : ''}`);
}

// ---- 2-4) 初始可绕行 + 转角/长度/岔路 ----
const open4 = (x, z) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => passMode('none')(x + dx, z + dz)).length;
for (const [x, z] of ENEMY_SPAWNS) {
  const p = bfsPath('none', x, z, ...PLAYER_SPAWN);
  if (!p) { ok(false, `初始(不穿砖)路线 敌(${x},${z})→玩家 不存在`); continue; }
  const junctions = p.pts.filter(([px, pz]) => open4(px, pz) >= 3).length;
  ok(p.turns >= 4, `敌(${x},${z}) 初始路线 转角=${p.turns} (期望≥4)`);
  ok(p.len >= 12, `敌(${x},${z}) 初始路线 长度=${p.len} (期望≥12)`);
  ok(junctions >= 2, `敌(${x},${z}) 路线岔路节点=${junctions} (期望≥2)`);
}

// ---- 5) 回路 ----
{
  const V = new Set();
  let E = 0;
  for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
    if (!passMode('none')(x, z)) continue;
    V.add(z * GRID + x);
    if (x + 1 < GRID && passMode('none')(x + 1, z)) E++;
    if (z + 1 < GRID && passMode('none')(x, z + 1)) E++;
  }
  const cycles = E - V.size + 1;
  ok(cycles >= 2, `开放子图回路数=${cycles} (期望≥2，玩家可循环风筝)`);
}

// ---- 6) 墙段 ----
const hSegs = [], vSegs = [];
for (let z = 0; z < GRID; z++) {
  let run = 0;
  for (let x = 0; x < GRID; x++) {
    if (R3_MAP[z][x] !== '.') run++; else { if (run) hSegs.push(run); run = 0; }
  }
  if (run) hSegs.push(run);
}
for (let x = 0; x < GRID; x++) {
  let run = 0;
  for (let z = 0; z < GRID; z++) {
    if (R3_MAP[z][x] !== '.') run++; else { if (run) vSegs.push(run); run = 0; }
  }
  if (run) vSegs.push(run);
}
const all = [...hSegs, ...vSegs];
const walls = R3_MAP.join('').split('').filter((c) => c !== '.').length;
ok(all.filter((n) => n >= 3).length >= 5, `连续墙段(≥3格)=${all.filter((n) => n >= 3).length} 条 (期望≥5): ${all.sort((a, b) => b - a).join(',')}`);
ok(walls >= 40 && walls <= 80, `总墙数=${walls} (期望40-80)`);

ok(TILE > 2.3, `1格巷道 ${TILE}m > 坦克直径 2.3m`);
process.exit(fail);
