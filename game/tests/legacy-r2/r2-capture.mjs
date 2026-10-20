// R2 画面捕获：真实游玩并按时机截图，供人工/视觉检查场地可读性。
// 输出：tests/evidence/r2-shot-{A,B,C}.png + 状态摘要。退出码恒 0（纯证据脚本）。
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
  const info = () => page.evaluate(() => {
    const g = window.__game;
    const t = g.testInfo;
    return { level: t.level, phase: t.phase, enemies: t.enemies, hp: t.playerHp, score: t.score, kills: t.kills };
  });

  // A：开场 6s（首个敌人出现）
  await page.waitForTimeout(6000);
  console.log('[A]', JSON.stringify(await info()));
  await page.screenshot({ path: 'tests/evidence/r2-shot-A.png' });

  // B：向前推进交战 12s（真实 W + 空格 + 鼠标跟敌）
  await page.keyboard.down('KeyW');
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    const st = await page.evaluate(() => {
      const g = window.__game;
      if (!g.enemies.length) return null;
      const e = g.enemies[0].tank.pos;
      return g.projectToScreen(e.x, 0, e.z);
    });
    if (st) await page.mouse.move(st.x, st.y);
    if (Date.now() % 2000 < 500) await page.keyboard.down('Space');
    await page.waitForTimeout(120);
    if (Date.now() % 2000 >= 500) await page.keyboard.up('Space');
  }
  await page.keyboard.up('KeyW');
  console.log('[B]', JSON.stringify(await info()));
  await page.screenshot({ path: 'tests/evidence/r2-shot-B.png' });

  // C：再推进 10s
  await page.keyboard.down('KeyW');
  const t1 = Date.now();
  while (Date.now() - t1 < 10000) {
    const st = await page.evaluate(() => {
      const g = window.__game;
      if (!g.enemies.length) return null;
      const e = g.enemies[0].tank.pos;
      return g.projectToScreen(e.x, 0, e.z);
    });
    if (st) await page.mouse.move(st.x, st.y);
    await page.keyboard.down('Space');
    await page.waitForTimeout(150);
    await page.keyboard.up('Space');
    await page.waitForTimeout(150);
  }
  await page.keyboard.up('KeyW');
  console.log('[C]', JSON.stringify(await info()));
  await page.screenshot({ path: 'tests/evidence/r2-shot-C.png' });

  console.log('errors:', firstError.count, firstError.msg || '');
} finally {
  if (browser) await browser.close().catch(() => {});
}
