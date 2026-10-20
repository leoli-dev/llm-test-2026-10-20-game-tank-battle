// 完整胜利循环验证：5 波全部歼灭 → 胜利结算 → 排行榜
// 每波把敌人摆到清晰弹道（stageWaveForTest 仅改位置），击杀全部用真实瞄准射击
import { chromium } from 'playwright';
const EXE = process.env.CHROME || process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const info = () => page.evaluate(() => window.__game.testInfo);
const fireKey = async () => { await page.keyboard.down(' '); await page.waitForTimeout(90); await page.keyboard.up(' '); };

await page.goto((process.env.BASE_URL || 'http://127.0.0.1:5179/'), { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game);
await page.evaluate(() => { window.__game.freezeEnemies = true; }); // 冻结避免掉血干扰胜利流程
await page.click('#btnStart');
await page.waitForFunction(() => window.__game.testInfo.state === 'playing');

let victory = false;
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  const t = await info();
  if (t.state === 'over') { victory = t.victory; break; }
  if (t.state !== 'playing') break;
  // 本波全部刷完之前保持站位刷新；刷完后逐个击沉
  if (t.enemies === 0) { await page.waitForTimeout(700); continue; }
  await page.waitForTimeout(500); // 相机稳定
  await page.evaluate(() => window.__game.stageWaveForTest(false)); // 保留 toSpawn，清完整波
  await page.waitForTimeout(250);
  for (let guard = 0; guard < 80; guard++) {
    const cur = await info();
    if (cur.state !== 'playing') break;
    if (cur.enemies === 0 && cur.toSpawn === 0) break; // 本波清空，外层等推进
    if (cur.overheated) { await page.waitForTimeout(2600); continue; }
    const sp = await page.evaluate(() => {
      const g = window.__game;
      const e = g.enemies[0].tank.position;
      return g.projectToScreen(e.x, 1.2, e.z);
    });
    if (sp.x < 60 || sp.x > 1220 || sp.y < 60 || sp.y > 740) {
      await page.waitForTimeout(600);
      await page.evaluate(() => window.__game.stageWaveForTest(false));
      continue;
    }
    await page.mouse.move(sp.x, sp.y);
    await page.waitForTimeout(150);
    for (let s = 0; s < 4; s++) { await fireKey(); await page.waitForTimeout(530); }
    const after = await info();
    if (after.hitsOnEnemies === cur.hitsOnEnemies) {
      await page.evaluate(() => window.__game.stageWaveForTest(false));
    }
  }
}
const t = await info();
console.log(JSON.stringify({ state: t.state, victory: t.victory, kills: t.kills, score: t.score, board: t.board.length }));
console.log(t.kills >= 36 ? 'PASS kills: 完整波次（≥36 敌）全部歼灭' : `WARN kills=${t.kills}（预期 ~40）`);
console.log(victory ? 'PASS victory: 5 波全清 → 胜利结算' : `FAIL victory: ${t.state}/${t.victory}`);
await page.waitForTimeout(1000);
const overTitle = (await page.textContent('#screen-over #over-title'))?.trim();
console.log(overTitle === '任务完成' ? 'PASS 胜利面板标题=任务完成' : `FAIL 胜利面板标题="${overTitle}"`);
await page.screenshot({ path: 'tests/evidence/10-victory.png' });
// 胜利分录入排行榜
await page.fill('#playerName', 'VICTOR');
await page.click('#btnSave');
await page.waitForTimeout(300);
const b = (await info()).board;
console.log(b.length && b[0].name === 'VICTOR' ? `PASS board: 胜利分已录入 [${JSON.stringify(b[0])}]` : 'FAIL board');
console.log('errors:', errors.length, errors.slice(0, 3));
await browser.close();
process.exit(victory ? 0 : 1);
