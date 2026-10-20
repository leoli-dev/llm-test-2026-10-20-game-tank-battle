// 重构前试玩取证：真实键鼠（读取状态辅助瞄准），记录首段战斗观感
import { chromium } from 'playwright';
const EXE = process.env.CHROME || process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const info = () => page.evaluate(() => window.__game.testInfo);

await page.goto((process.env.BASE_URL || 'http://127.0.0.1:5179/'), { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game);
await page.click('#btnStart');
await page.waitForFunction(() => window.__game.testInfo.state === 'playing');

const t0 = Date.now();
const log = [];
// 自然试玩策略：朝最近敌人前进+瞄准射击，受击严重时后撤
for (let i = 0; i < 60; i++) {
  const t = await info();
  if (t.state !== 'playing') break;
  const sp = await page.evaluate(() => {
    const g = window.__game;
    if (!g.enemies.length) return null;
    let best = g.enemies[0], bd = 1e9;
    for (const e of g.enemies) {
      const d = (e.tank.position.x - g.player.position.x) ** 2 + (e.tank.position.z - g.player.position.z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    const p = best.tank.position;
    return { enemy: g.projectToScreen(p.x, 1.2, p.z), hp: g.playerHp };
  });
  if (sp) {
    await page.mouse.move(sp.enemy.x, sp.enemy.y);
    if (sp.hp > 40) {
      await page.keyboard.down('w');
    } else {
      await page.keyboard.down('s');
    }
    await page.keyboard.down(' ');
    await page.waitForTimeout(520);
    await page.keyboard.up(' ');
    await page.keyboard.up('w');
    await page.keyboard.up('s');
    if (i % 12 === 0) {
      const t2 = await info();
      log.push({ t: ((Date.now() - t0) / 1000).toFixed(1), hp: t2.playerHp, kills: t2.kills, enemies: t2.enemies, shots: t2.shotsFired });
    }
  } else await page.waitForTimeout(500);
}
const t = await info();
console.log(JSON.stringify({ dur: ((Date.now() - t0) / 1000).toFixed(1), state: t.state, hp: t.playerHp, kills: t.kills, shots: t.shotsFired, enemies: t.enemies, log, errors }, null, 1));
await page.screenshot({ path: 'tests/evidence/r2-before-play.png' });
await browser.close();
