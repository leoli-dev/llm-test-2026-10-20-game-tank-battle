// R2 暂停/继续最小回归：真实 P 键暂停 → 状态冻结（敌方位置/分数不变）→ 继续恢复。
// 退出码 0=通过，1=失败/异常。
import { chromium } from 'playwright';
const URL = (process.env.BASE_URL || 'http://127.0.0.1:5179/');
const EXE = process.env.CHROMIUM_PATH || undefined;
const firstError = { msg: '', count: 0 };
let browser = null;
let fail = false;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
  if (!cond) fail = true;
};
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
  await page.waitForFunction(() => window.__game.testInfo.state === 'playing', { timeout: 5000 });
  // headless rAF 速率有波动（dt 钳 0.05s），等至少 1 个敌人生成并移动过
  await page.waitForFunction(() => window.__game.enemies.length >= 1, { timeout: 40000 });
  await page.waitForTimeout(2000);

  const snap = () => page.evaluate(() => {
    const g = window.__game;
    return {
      score: g.testInfo.score, baseHp: g.baseHp,
      ex: g.enemies.map((e) => +e.tank.pos.x.toFixed(3)).join(','),
      ez: g.enemies.map((e) => +e.tank.pos.z.toFixed(3)).join(','),
    };
  });

  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__game.testInfo.state === 'paused', { timeout: 3000 });
  ok('P 暂停进入 paused', (await page.evaluate(() => window.__game.testInfo.state)) === 'paused');
  const a = await snap();
  await page.waitForTimeout(1500);
  const b = await snap();
  ok('暂停期间世界冻结（敌位置/分数/基地不变）',
    a.score === b.score && a.baseHp === b.baseHp && a.ex === b.ex && a.ez === b.ez,
    JSON.stringify({ a, b }));
  ok('暂停面板可见', await page.isVisible('#screen-pause:not(.hidden)'));
  await page.screenshot({ path: 'tests/evidence/r2-pause.png' });

  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__game.testInfo.state === 'playing', { timeout: 3000 });
  const c = await snap();
  await page.waitForTimeout(1200);
  const d = await snap();
  ok('继续后世界恢复（敌位置或分数变化）', c.ex !== d.ex || c.ez !== d.ez || c.score !== d.score || c.baseHp !== d.baseHp,
    JSON.stringify({ c, d }));
  ok('浏览器 0 异常', firstError.count === 0, firstError.msg);
} finally {
  if (browser) await browser.close().catch(() => {});
}
process.exit(fail || firstError.count > 0 ? 1 : 0);
