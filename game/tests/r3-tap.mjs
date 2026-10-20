import { chromium } from 'playwright';
const EXE = process.env.CHROMIUM_PATH || undefined;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, headless: true });
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
const t0 = await page.evaluate(() => window.__game.time);
await page.waitForFunction((a) => window.__game.time - a > 0.2, t0, { timeout: 10000 });
// 真实短按 Space 70ms ×3，间隔 1s
const cds = [];
for (let i = 0; i < 3; i++) {
  await page.keyboard.down('Space');
  await sleep(70);
  await page.keyboard.up('Space');
  await sleep(250);
  cds.push(await page.evaluate(() => ({
    shots: window.__game.shotsFired,
    cd: +window.__game.player.fireCd.toFixed(3),
  })));
  if (i < 2) await sleep(750);
}
console.log(JSON.stringify(cds));
const ok = cds[2].shots === 3 && cds[0].shots === 1 && cds[1].shots === 2;
console.log('tap-fire OK:', ok, 'errors:', errors.length, errors[0] || '');
await browser.close();
process.exit(ok && !errors.length ? 0 : 1);
