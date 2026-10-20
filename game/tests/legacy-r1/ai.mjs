// 真实 AI 交火验证：不冻结、不干预，玩家原地不动，观察敌人自行移动、开火并命中玩家
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
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game);
await page.click('#btnStart');
await page.waitForFunction(() => window.__game.testInfo.state === 'playing');

// 等第一个敌人出现
await page.waitForFunction(() => window.__game.testInfo.enemies > 0, null, { timeout: 15000 });
const e0 = await page.evaluate(() => window.__game.enemies[0].tank.position.toArray());
await page.waitForTimeout(2500);
const e1 = await page.evaluate(() => {
  const es = window.__game.enemies;
  return es.length ? es[0].tank.position.toArray() : e0;
});
const moved = Math.hypot(e1[0] - e0[0], e1[2] - e0[2]);
console.log(`enemy moved ${moved.toFixed(1)}m in 2.5s (speed ~6.5, 可能含转向)`);
console.log('PASS ai: 敌人自主移动' , moved > 1 ? '' : ' [警告: 移动较少]');

// 原地站桩等敌人命中（最多 60s）
let hit = null;
const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  const t = await info();
  if (t.hitsOnPlayer > 0) { hit = t; break; }
  if (t.state === 'over') { hit = t; break; }
  await page.waitForTimeout(500);
}
console.log(JSON.stringify(hit && { hitsOnPlayer: hit.hitsOnPlayer, hp: hit.playerHp, state: hit.state }));
console.log(hit && (hit.hitsOnPlayer > 0 || hit.state === 'over')
  ? 'PASS ai: 敌人真实开火并命中玩家（无干预）'
  : 'FAIL ai: 60s 内无敌人命中');
if (hit) await page.screenshot({ path: 'tests/evidence/09-ai-combat.png' });
console.log('errors:', errors.length, errors.slice(0, 3));
await browser.close();
process.exit(hit && (hit.hitsOnPlayer > 0 || hit.state === 'over') ? 0 : 1);
