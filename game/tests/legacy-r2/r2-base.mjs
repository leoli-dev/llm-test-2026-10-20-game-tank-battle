// R2 基地威胁验证（复现观察者场景）：真实 A 键把玩家移到左后角 (≈1.15, 50)，
// 之后完全静置 35s。敌人应寻路到基地旁并对基地开火 → baseHp 必须下降。
// 退出码：0=基地实际掉血，1=未掉血/异常。finally 关闭自己的浏览器。
import { chromium } from 'playwright';
const URL = (process.env.BASE_URL || 'http://127.0.0.1:5179/');
const EXE = process.env.CHROMIUM_PATH || undefined;
const firstError = { msg: '', count: 0 };
let browser = null;
try {
  browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => {
    firstError.count++;
    if (!firstError.msg) firstError.msg = (e.stack || e.message || String(e)).split('\n').slice(0, 4).join(' | ');
  });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForFunction(() => window.__game, { timeout: 10000 });
  await page.click('#btnStart');
  await page.waitForTimeout(1600);

  // 真实持续按住 A 移到左后角（25m / 7m/s ≈ 3.6s），轮询确认后松开
  {
    await page.waitForFunction(() => window.__game.testInfo.state === 'playing');
    await page.keyboard.down('KeyA');
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      const x = await page.evaluate(() => window.__game.player.pos.x);
      if (x < 2.0) break;
      await page.waitForTimeout(250);
    }
    await page.keyboard.up('KeyA');
  }
  const pos = await page.evaluate(() => ({ x: +window.__game.player.pos.x.toFixed(2), z: +window.__game.player.pos.z.toFixed(2) }));
  console.log('玩家已移至', JSON.stringify(pos));

  // 静置观察 35s
  const t0 = Date.now();
  let minBase = 6;
  while (Date.now() - t0 < 35000) {
    await page.waitForTimeout(2500);
    const d = await page.evaluate(() => {
      const g = window.__game;
      return {
        baseHp: g.baseHp, hp: Math.round(g.player.hp), state: g.testInfo.state,
        enemies: g.enemies.map((e) => ({ x: +e.tank.pos.x.toFixed(1), z: +e.tank.pos.z.toFixed(1), goal: e.goalKey, pathLen: e.path?.length ?? 0 })),
      };
    });
    minBase = Math.min(minBase, d.baseHp);
    console.log(`[+${((Date.now() - t0) / 1000).toFixed(0)}s] base=${d.baseHp} playerHp=${d.hp} state=${d.state}`, JSON.stringify(d.enemies));
    if (d.state === 'over') break;
  }
  await page.screenshot({ path: 'tests/evidence/r2-base-threat.png' });
  const over = await page.evaluate(() => ({ state: window.__game.testInfo.state, reason: window.__game.overReason || '' }));
  console.log(JSON.stringify({ minBase, over, errors: firstError.count, firstErr: firstError.msg }));
  if (firstError.count > 0) process.exitCode = 1;
  else if (minBase >= 6) process.exitCode = 1; // 35s 内基地无实际伤害 = 威胁不成立
} finally {
  if (browser) await browser.close().catch(() => {});
}
