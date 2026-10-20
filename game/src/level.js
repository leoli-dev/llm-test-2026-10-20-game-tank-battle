// R3 战场：13×13 瓦片网格。'.'空 'B'砖(可破坏,2HP) 'S'钢(不可破坏)
// 固定歼灭战：无基地、无关卡、无刷兵队列——敌人固定 4 辆开局全部入场。
export const GRID = 13;
export const TILE = 4; // 米
export const WORLD = GRID * TILE; // 52m

// 真巷道路网（R3-v3，监督反馈：v1/v2 均为孤立墙段+大片开阔地，非迷宫）：
// 由 tests/dev-r3-maze.mjs 固定种子(31337) 生成并经验收（tests/r3-maze-check.mjs）：
//  · 7×7 节点递归回溯 → 连续 1 格砖墙巷道网（转角每 2 格一次）；
//  · 随机打通 14 条内墙 + 全开外圈回廊 → 20 个回路（玩家可循环风筝）；
//  · 中央 (4-5,4-5)/(7-8,7-8) 两个 2×2 交战口袋；4 格钢墙（不可破，验证不破坏可解）；
//  · 每敌初始（不穿砖）路线：转角 4+、长度 13-15、岔路节点 5+；全图砖可穿连通；
//  · 1 格巷道 4m > 坦克直径 2.3m；破砖=捷径（任意砖 2 发可开新路线）。
export const R3_MAP = [
  '.............',
  '.B.B.BBB.B.B.',
  '...B.B...B.S.',
  '.BSB.B.B.B.B.',
  '.B.....B...B.',
  '.B.B...B.B.B.',
  '....B....B...',
  '.B.B.B..BB.B.',
  '.B...B...S...',
  '.B.B.BBB.BSB.',
  '.......B.B...',
  '.B.B.B.B.B.B.',
  '.............',
];
export const PLAYER_SPAWN = [6, 6];
export const ENEMY_SPAWNS = [[0, 1], [12, 1], [0, 11], [12, 11]];
export const ENEMY_TYPES = ['basic', 'basic', 'basic', 'basic']; // 一局固定 4 辆

export function tileWorld(tx, tz) { return [(tx + 0.5) * TILE, (tz + 0.5) * TILE]; }
export function worldTile(x, z) {
  const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
  if (tx < 0 || tz < 0 || tx >= GRID || tz >= GRID) return -1; // 边界=实
  return 0;
}

// 战场对象（buildBattle 结果）：固定歼灭战，无队列
export function buildBattle() {
  const cells = []; // 每格: null | {type:'B'|'S', hp}
  for (let z = 0; z < GRID; z++) {
    const row = [];
    for (let x = 0; x < GRID; x++) {
      const c = R3_MAP[z][x];
      if (c === 'B') row.push({ type: 'B', hp: 2 });
      else if (c === 'S') row.push({ type: 'S', hp: Infinity });
      else row.push(null);
    }
    cells.push(row);
  }
  return {
    idx: 0, name: '歼灭战', cells,
    playerSpawn: PLAYER_SPAWN, enemySpawns: ENEMY_SPAWNS,
    totalEnemies: ENEMY_SPAWNS.length,
  };
}

export function isSolid(level, cell) { return !!cell; } // B/S/H 都挡坦克与子弹

// 网格 A*：砖=代价 4（会主动开砖），钢/基地=不可穿
export function findPath(level, fromTile, toTile) {
  const key = (x, z) => z * GRID + x;
  // 目标格不可穿（基地 H / 钢 S）时，改用最近的可达邻格作为路径终点，
  // 否则 A* 永远无法到达目标格，返回 null，敌人会原地不动
  let gx = toTile[0], gz = toTile[1];
  const gcell = level.cells[gz]?.[gx];
  if (gcell && gcell.type !== 'B') {
    let best = null, bd = Infinity;
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = gx + dx, nz = gz + dz;
      if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
      const c = level.cells[nz][nx];
      if (c && c.type === 'S') continue;
      const d = Math.abs(dx) + Math.abs(dz);
      if (d < bd) { bd = d; best = [nx, nz]; }
    }
    if (!best) return null;
    [gx, gz] = best;
  }
  const start = key(fromTile[0], fromTile[1]);
  const goal = key(gx, gz);
  if (start === goal) return [];
  const open = [start], g = new Map([[start, 0]]), f = new Map([[start, h(fromTile, toTile)]]), came = new Map();
  function h(t) { return Math.abs(t[0] - gx) + Math.abs(t[1] - gz); }
  let guard = 0;
  while (open.length && guard++ < 600) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f.get(open[i]) < f.get(open[bi])) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur === goal) {
      const path = [];
      let n = cur;
      while (n !== start) { path.push([n % GRID, Math.floor(n / GRID)]); n = came.get(n); }
      return path.reverse();
    }
    const cx = cur % GRID, cz = Math.floor(cur / GRID);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
      const cell = level.cells[nz][nx];
      if (cell && cell.type !== 'B') continue; // 钢/基地不可穿
      const ng = g.get(cur) + (cell ? 4 : 1);
      const nk = key(nx, nz);
      if (ng < (g.get(nk) ?? Infinity)) {
        came.set(nk, cur); g.set(nk, ng); f.set(nk, ng + h([nx, nz]));
        if (!open.includes(nk)) open.push(nk);
      }
    }
  }
  return null; // 无路径
}

// 瓦片间 LOS：从 a 到 b 的世界线段，中间任何实瓦片（含砖）遮挡。
// 起点与终点的“自身所在格”不算遮挡（基地目标就在 H 格内，若不跳过终点格，
// 贴近基地的敌人永远 los=false，无法开火——此前实测 bug）。
export function hasLOS(level, ax, az, bx, bz) {
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5);
  const stx = Math.floor(ax / TILE), stz = Math.floor(az / TILE);
  const etx = Math.floor(bx / TILE), etz = Math.floor(bz / TILE);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
    if (tx < 0 || tz < 0 || tx >= GRID || tz >= GRID) return false;
    if ((tx === stx && tz === stz) || (tx === etx && tz === etz)) continue;
    if (level.cells[tz][tx]) return false;
  }
  return true;
}

// 战场可解性校验（测试/加载时）：敌入口可达 + 全图连通（砖算可穿，钢不可穿）
export function validateLevel(level) {
  const issues = [];
  const [px, pz] = level.playerSpawn;
  if (level.cells[pz][px]) issues.push('玩家起点被占');
  for (const [sx, sz] of ENEMY_SPAWNS) {
    if (level.cells[sz][sx]) issues.push(`敌出生点 (${sx},${sz}) 被占`);
    else if (!findPath(level, level.playerSpawn, [sx, sz])) issues.push(`玩家→敌出生(${sx},${sz}) 无路径`);
  }
  // 全图连通性：BFS（砖可穿），每个空/砖格都必须从玩家可达，防永久封死
  const seen = new Set([pz * GRID + px]);
  const q = [[px, pz]];
  while (q.length) {
    const [cx, cz] = q.shift();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
      const i = nz * GRID + nx;
      if (seen.has(i)) continue;
      const c = level.cells[nz][nx];
      if (c && c.type === 'S') continue;
      seen.add(i); q.push([nx, nz]);
    }
  }
  for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
    const c = level.cells[z][x];
    if ((!c || c.type === 'B') && !seen.has(z * GRID + x)) issues.push(`格 (${x},${z}) 与玩家不连通`);
  }
  return issues;
}
