import { chromium } from 'playwright';
const EXE = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto((process.env.BASE_URL || 'http://127.0.0.1:5179/'), { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game);
await page.click('#btnStart');
await page.waitForFunction(() => window.__game.testInfo.state === 'playing');
await page.waitForTimeout(2500);

// 正前方 8m 放敌人（玩家出生时 yaw=0 朝 +Z）
const tp = await page.evaluate(() => {
  const g = window.__game;
  g.freezeEnemies = true;
  const p = g.player.position;
  g.spawnTestEnemy(p.x, p.z + 8);
  return { p: [p.x, p.z], e: [p.x, p.z + 8] };
});
console.log('state:', JSON.stringify(tp));

// 鼠标移到测试敌人屏幕位置
const sp = await page.evaluate((pt) => window.__game.projectToScreen(pt.x, 1.2, pt.z), { x: tp.e[0], z: tp.e[1] });
console.log('screenPt:', sp);
await page.mouse.move(sp.x, sp.y);
await page.waitForTimeout(300);
const a3 = await page.evaluate(() => {
  const g = window.__game;
  const v = { turret: g.player.turret.rotation.y, aim: g.aimPoint.toArray() };
  const d = g.camera.getWorldDirection(new (g.camera.position.constructor)(0, 0, 1));
  v.camDir = d.toArray();
  v.camPos = g.camera.position.toArray();
  return v;
});
console.log('a3:', JSON.stringify(a3));

// 开火 4 发，记录子弹
for (let i = 0; i < 4; i++) {
  await page.keyboard.down(' '); await page.waitForTimeout(90); await page.keyboard.up(' ');
  await page.waitForTimeout(300);
  const bs = await page.evaluate(() => window.__game.bullets.map(b => ({ p: b.pos.toArray(), v: b.vel.toArray() })));
  console.log('shot', i, JSON.stringify(bs));
  await page.waitForTimeout(300);
}
console.log('final:', JSON.stringify(await page.evaluate(() => window.__game.testInfo)));
await browser.close();
