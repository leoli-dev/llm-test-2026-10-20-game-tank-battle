// 自然试玩（真实键鼠输入；读取状态仅用于鼠标瞄准与记录，不冻结/不改数值/不摆位/不清队列）
// 用法: node tests/r2-play.mjs <sessionTag>
import { chromium } from 'playwright';
const EXE = process.env.CHROME || process.env.CHROMIUM_PATH || undefined;
const TAG = process.argv[2] || 's1';
const MAX_SECS = 240;
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const getData = () => page.evaluate(() => {
  const g = window.__game;
  const t = g.testInfo;
  return {
    ...t,
    enemies: g.enemies.map((e) => ({
      x: e.tank.pos.x, z: e.tank.pos.z, hp: e.hp, type: e.type,
      s: g.projectToScreen(e.tank.pos.x, 1.5, e.tank.pos.z),
    })),
    basePos: g.baseCell ? [(g.baseCell[0] + 0.5) * 4, (g.baseCell[1] + 0.5) * 4] : null,
  };
});

await page.goto((process.env.BASE_URL || 'http://127.0.0.1:5179/'), { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game);
await page.click('#btnStart');
await page.waitForFunction(() => window.__game.testInfo.state === 'playing');

const t0 = Date.now();
const log = [];
let lastShot = 0;
let jitterT = 0, jx = 0, jz = 0;
const pressed = new Set();
async function setKeys(want) {
  const wantSet = new Set(want);
  for (const k of [...pressed]) if (!wantSet.has(k)) { await page.keyboard.up(k); pressed.delete(k); }
  for (const k of want) if (!pressed.has(k)) { await page.keyboard.down(k); pressed.add(k); }
}

let final = null;
while (Date.now() - t0 < MAX_SECS * 1000) {
  const d = await getData();
  if (d.state === 'over') { final = d; break; }
  if (d.state !== 'playing') await page.waitForTimeout(200);
  // 每 2.5s 换一个小侧偏，避免卡墙
  jitterT -= 0.4;
  if (jitterT <= 0) { jitterT = 6; const a = Math.random() * 6.28; jx = Math.cos(a) * 3; jz = Math.sin(a) * 3; }

  // 决策
  const [px, pz] = d.playerPos;
  const enemies = d.enemies;
  if (!enemies.length) { await setKeys([]); await page.waitForTimeout(400); continue; }
  const toBase = d.basePos ? Math.hypot(d.basePos[0] - px, d.basePos[1] - pz) : 1e9;
  // 威胁敌人 = 离基地最近的（开火与移动都以它为准——人类会先打威胁基地的那个）
  let threat = enemies[0], thd = 1e9;
  for (const e of enemies) { const dist = Math.hypot(e.x - d.basePos[0], e.z - d.basePos[1]); if (dist < thd) { thd = dist; threat = e; } }
  const target = threat;
  const td = Math.hypot(target.x - px, target.z - pz);

  let goal;
  if (d.playerHp < 30 && d.lives > 1) goal = [26 + jx, 50 + jz * 0.3];                      // 残血回出生点
  else if (thd < 24) goal = [d.basePos[0] + jx * 0.4, d.basePos[1] + 5 + jz * 0.3];          // 威胁近：守基地南侧
  else if (td > 13) goal = [target.x + jx * 0.5, target.z + jz * 0.5];                       // 推进
  else goal = [px - (target.z - pz) * 0.6, pz + (target.x - px) * 0.6];                      // 近距横走

  const dx = goal[0] - px, dz = goal[1] - pz;
  const dl = Math.hypot(dx, dz);
  const keys = [];
  if (dl > 1.2) {
    if (dz < -1) keys.push('KeyW'); if (dz > 1) keys.push('KeyS');
    if (dx < -1) keys.push('KeyA'); if (dx > 1) keys.push('KeyD');
  }
  await setKeys(keys);

  // 瞄准 + 射击
  if (target) {
    await page.mouse.move(target.s.x, target.s.y);
    const now = Date.now();
    if (now - lastShot > 1400) { // 每 1.4s 开一次 0.8s 点射
      await page.keyboard.down('Space');
      await page.waitForTimeout(800);
      await page.keyboard.up('Space');
      lastShot = Date.now();
    }
  }
  await page.waitForTimeout(350);
  if ((Date.now() - t0) % 10000 < 400) {
    log.push({ t: ((Date.now() - t0) / 1000).toFixed(0), lv: d.level, hp: Math.round(d.playerHp), lives: d.lives, kills: d.kills, bricks: d.bricksBroken, enemies: d.enemies, toSpawn: d.toSpawn, base: d.baseHp });
  }
}
if (!final) final = await getData();
for (const k of [...pressed]) await page.keyboard.up(k);
console.log(JSON.stringify({
  tag: TAG, dur: ((Date.now() - t0) / 1000).toFixed(1),
  state: final.state, win: final.state === 'over' ? await page.evaluate(() => window.__game.win) : null,
  reason: await page.evaluate(() => window.__game.overReason || ''),
  level: final.level, kills: final.kills, bricks: final.bricksBroken,
  score: final.score, lives: final.lives, playerHp: final.playerHp, baseHp: final.baseHp,
  shots: final.shotsFired, hitsE: final.hitsOnEnemies, hitsP: final.hitsOnPlayer,
  errors, log,
}, null, 1));
await page.screenshot({ path: `tests/evidence/r2-play-${TAG}.png` });
await browser.close();
// 退出码：有 console/pageerror 则失败（玩法胜负不作为脚本失败）
process.exit(errors.length ? 1 : 0);
