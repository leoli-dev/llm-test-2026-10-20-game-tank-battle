// R3 冒烟：开局 4 敌固定 → 真实单轴 W（北，出生格 (6,6) 正北 (6,5) 为空）→
// 等待玩家实际跨格后检查敌人 goal 跟随 + 0 页错误。等待一律用 Playwright 工具（waitForFunction/waitForTimeout）。
import { chromium } from 'playwright';
let fail = 0;
const ok = (c, msg) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + msg); if (!c) fail = 1; };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('' + e));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto((process.env.BASE_URL || 'http://127.0.0.1:5179/'));
await page.waitForFunction(() => window.__game, { timeout: 15000 });
await page.bringToFront().catch(() => {});
await page.screenshot().catch(() => {});
await page.click('#btnStart');
await page.waitForFunction(() => {
  const g = window.__game;
  return g.state === 'playing' && g.phase === 'fight' && g.enemies.length === 4;
}, { timeout: 15000 });
ok(true, '开局 4 敌、fight 阶段');
// 间歇帧停顿 → 超时后截帧/置顶唤醒重试（不改游戏时间步）
const t0 = await page.evaluate(() => window.__game.time);
{
  for (let a = 0; a < 4; a++) {
    try {
      await page.waitForFunction((x) => window.__game.time - x > 0.2, t0, { timeout: 5000 });
      break;
    } catch {
      await page.bringToFront().catch(() => {});
      await page.screenshot().catch(() => {});
      if (a === 3) throw new Error('时间推进检查超时（已唤醒重试 4 次）');
    }
  }
}
const toSpawn = await page.evaluate(() => window.__game.testInfo.toSpawn);
ok(toSpawn === 0, 'toSpawn 恒 0（无补充）');

// 敌人 AI 活动：等待任一敌人位移 >0.5m（rAF 轮询，不假定固定时长）；
// 无头环境偶发帧停顿 → 超时后截帧/置顶唤醒重试（不改游戏时间步）
const e0 = await page.evaluate(() => window.__game.enemies.map((e) => [e.tank.group.position.x, e.tank.group.position.z]));
{
  let moved = false;
  for (let attempt = 0; attempt < 4 && !moved; attempt++) {
    try {
      await page.waitForFunction((a) => {
        const g = window.__game;
        return g.enemies.some((e, i) => Math.hypot(e.tank.group.position.x - a[i][0], e.tank.group.position.z - a[i][1]) > 0.5);
      }, e0, { timeout: 8000 });
      moved = true;
    } catch {
      await page.bringToFront().catch(() => {});
      await page.screenshot().catch(() => {});
      await page.waitForTimeout(500);
    }
  }
  ok(moved, '敌人自行移动（追击 AI 活动）');
}

// 真实 W：出生格正北 (6,5) 为空（西侧 (5,6) 是砖，故不用斜向）
const p0 = await page.evaluate(() => window.__game.testInfo.playerPos);
const goals0 = await page.evaluate(() => window.__game.enemies.map((e) => e.goalKey).join('|'));
await page.keyboard.down('KeyW');
// 等待玩家实际跨格（越过 2 格瓦片边界），而不是固定 sleep 后猜；含唤醒重试
{
  for (let a = 0; a < 4; a++) {
    try {
      await page.waitForFunction((x) => {
        const p = window.__game.player.group.position;
        return Math.hypot(p.x - x[0], p.z - x[1]) > 2 * 4; // >2 格
      }, p0, { timeout: 5000 });
      break;
    } catch {
      await page.bringToFront().catch(() => {});
      await page.screenshot().catch(() => {});
      if (a === 3) throw new Error('玩家跨格检查超时（已唤醒重试 4 次）');
    }
  }
}
await page.keyboard.up('KeyW');
await page.waitForTimeout(500);
const s = await page.evaluate(() => ({
  pos: window.__game.testInfo.playerPos,
  goals: window.__game.enemies.map((e) => e.goalKey).join('|'),
}));
ok(Math.hypot(s.pos[0] - p0[0], s.pos[1] - p0[1]) > 8, `玩家真实移动跨格 (${p0.map((n) => +n.toFixed(1))} → ${s.pos.map((n) => +n.toFixed(1))})`);
ok(s.goals !== goals0, `敌人 goal 随玩家换格 (${goals0 || 'none'} → ${s.goals || 'none'})`);
ok(errors.length === 0, `0 页错误 (${errors.length}) ${errors[0] || ''}`);
await browser.close();
process.exit(fail);
