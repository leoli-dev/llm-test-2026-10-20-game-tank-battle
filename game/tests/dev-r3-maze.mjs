// 开发工具（不参与测试验收）：固定种子生成 R3 迷宫草案并落盘到 draft 文件。
// 结构：7×7 节点递归回溯（1 格巷道/1 格墙）+ 全开外圈回廊（风筝环路）
//      + 随机打通 K 条内墙（回路/岔路）+ 2 个中央 2×2 交战口袋 + 4 格钢墙（验证不破坏可解后）
import { writeFileSync } from 'node:fs';

const GRID = 13;
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = Number(process.argv[2] || 20261020);
const R = mulberry32(SEED);

const map = Array.from({ length: GRID }, () => Array(GRID).fill('W'));
const NODES = [0, 2, 4, 6, 8, 10, 12];
const idx = (x, z) => [x / 2, z / 2];

// --- 递归回溯（7×7 节点），从中央 (6,6) 开始 ---
const visited = Array.from({ length: 7 }, () => Array(7).fill(false));
const stack = [[3, 3]];
visited[3][3] = true;
map[6][6] = '.';
while (stack.length) {
  const [nx, nz] = stack[stack.length - 1];
  const nxw = NODES[nx], nzw = NODES[nz];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => {
    const ax = nx + dx, az = nz + dz;
    return ax >= 0 && az >= 0 && ax < 7 && az < 7 && !visited[ax][az];
  });
  if (!dirs.length) { stack.pop(); continue; }
  const [dx, dz] = dirs[Math.floor(R() * dirs.length)];
  const ax = nx + dx, az = nz + dz;
  map[nzw + dz][nxw + dx] = '.'; // 打通两节点之间的墙
  map[NODES[az]][NODES[ax]] = '.'; // 目标节点本身也是通路
  visited[ax][az] = true;
  stack.push([ax, az]);
}

// --- 外圈回廊：边界整圈开放（风筝环路）；边界节点(偶坐标)已在回溯中置空 ---
for (let i = 0; i < GRID; i++) { map[0][i] = '.'; map[12][i] = '.'; map[i][0] = '.'; map[i][12] = '.'; }

// --- 打通内墙制造回路/岔路：随机挑 (奇,偶)/(偶,奇) 墙 ---
const innerWalls = [];
for (let z = 1; z < 12; z++) for (let x = 1; x < 12; x++) {
  if (map[z][x] === 'W' && ((x % 2 === 1 && z % 2 === 0) || (x % 2 === 0 && z % 2 === 1))) innerWalls.push([x, z]);
}
for (let i = innerWalls.length - 1; i > 0; i--) {
  const j = Math.floor(R() * (i + 1));
  [innerWalls[i], innerWalls[j]] = [innerWalls[j], innerWalls[i]];
}
for (let i = 0; i < 14; i++) { const [x, z] = innerWalls[i]; map[z][x] = '.'; }

// --- 中央 2×2 交战口袋 ×2（打穿柱+邻墙，180° 对称）---
for (const [px, pz, dx, dy] of [[5, 5, 1, 1], [7, 7, -1, -1]]) {
  map[pz][px] = '.';        // 柱
  map[pz][px + dx] = '.';   // 邻墙
  map[pz + dy][px] = '.';   // 邻墙
}

// --- 打断完全贯通的内行/内列（变成砖：仍可破，但迫使绕行/多转角）---
function noBrickReach(sx, sz) {
  const pass = (x, z) => x >= 0 && z >= 0 && x < GRID && z < GRID && map[z][x] === '.';
  const seen = new Set([sz * GRID + sx]);
  const q = [[sx, sz]];
  while (q.length) {
    const [cx, cz] = q.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (!pass(nx, nz) || seen.has(nz * GRID + nx)) continue;
      seen.add(nz * GRID + nx); q.push([nx, nz]);
    }
  }
  return seen;
}
const SPAWNS = [[0, 1], [12, 1], [0, 11], [12, 11]];
function laneBreakable(x, z) {
  const was = map[z][x];
  map[z][x] = 'B';
  const reach = noBrickReach(6, 6);
  const okAll = SPAWNS.every(([sx, sz]) => reach.has(sz * GRID + sx));
  if (!okAll) map[z][x] = was;
  return okAll;
}
for (const axis of ['row', 'col']) {
  for (let i = 1; i < 12; i++) {
    const open = axis === 'row'
      ? Array.from({ length: GRID }, (_, x) => map[i][x]).every((c) => c === '.')
      : Array.from({ length: GRID }, (_, z) => map[z][i]).every((c) => c === '.');
    if (!open) continue;
    for (const j of [4, 9]) { // 两处打断，避开中心列/行 6 与出生列 1/11
      if (j === 6) continue;
      if (axis === 'row') laneBreakable(j, i);
      else laneBreakable(i, j);
    }
  }
}

// --- 定向修补：若左上敌初始路线 <12 格，在 (3,2) 补一块砖（仍砖可穿）---
{
  const reach = noBrickReach(0, 1);
  let len = -1;
  if (reach.has(6 * GRID + 6)) {
    // 简单 BFS 求长度
    const prev = new Map(); const q = [[0, 1]]; const seen2 = new Set([GRID + 0]);
    while (q.length) {
      const [cx, cz] = q.shift();
      if (cx === 6 && cz === 6) break;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        if (nz < 0 || nx < 0 || nx >= GRID || nz >= GRID || map[nz][nx] !== '.' || seen2.has(nz * GRID + nx)) continue;
        seen2.add(nz * GRID + nx); prev.set(nz * GRID + nx, [cx, cz]); q.push([nx, nz]);
      }
    }
    if (seen2.has(6 * GRID + 6)) {
      let cur = [6, 6]; len = 0;
      while (cur[0] !== 0 || cur[1] !== 1) { cur = prev.get(cur[1] * GRID + cur[0]); len++; }
    }
  }
  if (len < 12 && map[2][3] === '.') {
    map[2][3] = 'B';
    const r2 = noBrickReach(0, 1);
    if (!r2.has(6 * GRID + 6)) map[2][3] = '.';
    console.log(`patch: TL route len=${len} -> brick(3,2), stillReachable=${r2.has(6 * GRID + 6)}`);
  }
}

// --- 4 格钢墙：只在“砖可穿仍全连通”的前提下替换 ---
function breakConnected() {
  const pass = (x, z) => x >= 0 && z >= 0 && x < GRID && z < GRID && map[z][x] !== 'S';
  const seen = new Set([6 * GRID + 6]);
  const q = [[6, 6]];
  let all = 0;
  for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) if (map[z][x] !== 'S') all++;
  while (q.length) {
    const [cx, cz] = q.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (!pass(nx, nz) || seen.has(nz * GRID + nx)) continue;
      seen.add(nz * GRID + nx); q.push([nx, nz]);
    }
  }
  return seen.size === all;
}
const candidates = innerWalls.concat(innerWalls.slice(0, 14))
  .filter(([x, z]) => map[z][x] === 'W' && Math.hypot(x - 6, z - 6) > 2.5 && Math.hypot(x - 6, z - 6) < 6.5);
let placed = 0;
for (const [x, z] of candidates) {
  if (placed >= 4) break;
  if (map[z][x] !== 'W') continue;
  const was = map[z][x];
  map[z][x] = 'S';
  if (breakConnected()) placed++;
  else map[z][x] = was;
}

const out = map.map((r) => r.map((c) => (c === 'W' ? 'B' : c)).join(''));
console.log('seed=' + SEED + ' steel=' + placed);
console.log(out.join('\n'));
writeFileSync(process.argv[3] || '/tmp/r3-draft.txt', out.join('\n') + '\n');
