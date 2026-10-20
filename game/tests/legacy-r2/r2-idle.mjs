// R2 静置观察：开局后玩家不动不打，观察敌人是否真实移动、目标是否为玩家/基地、
// 是否产生实际伤害（玩家 HP 或基地 HP 下降）。纯观察，不干预。
// 输出：每 2s 一帧摘要。退出码：0=有实际威胁（有人掉血），1=无（敌人空转）或脚本报错。
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

  let threatened = false, playerDmg = false, baseDmg = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    await page.waitForTimeout(2000);
    const d = await page.evaluate(() => {
      const g = window.__game;
      return {
        t: ((Date.now() - 0) / 1000).toFixed(0),
        hp: Math.round(g.player.hp), baseHp: g.baseHp, state: g.testInfo.state,
        enemies: g.enemies.map((e) => ({
          x: +e.tank.pos.x.toFixed(1), z: +e.tank.pos.z.toFixed(1),
          goal: e.goalKey, pathLen: e.path?.length ?? 0,
        })),
      };
    });
    console.log(`[+${((Date.now() - t0) / 1000).toFixed(0)}s] hp=${d.hp} base=${d.baseHp} state=${d.state}`,
      JSON.stringify(d.enemies));
    if (d.hp < 100) { threatened = true; playerDmg = true; }
    if (d.baseHp < 6) { threatened = true; baseDmg = true; }
    if (d.state === 'over') break;
  }
  await page.screenshot({ path: 'tests/evidence/r2-idle-25s.png' });
  console.log(JSON.stringify({ threatened, playerDmg, baseDmg, errors: firstError.count, firstErr: firstError.msg }));
  if (firstError.count > 0) process.exitCode = 1;
  else if (!threatened) process.exitCode = 1; // 25s 静置仍无任何伤害 = 敌人空转
} finally {
  if (browser) await browser.close().catch(() => {});
}
