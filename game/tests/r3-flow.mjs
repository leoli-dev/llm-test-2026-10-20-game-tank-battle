// R3 流程回归：暂停冻结/恢复推进/再暂停/over 后 R 重开 → 4 敌重置 + 0 页错误。
import { chromium } from 'playwright';
const EXE = process.env.CHROMIUM_PATH || undefined;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const ok = (c, msg) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + msg); if (!c) fail = 1; };

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('' + e));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto((process.env.BASE_URL || 'http://127.0.0.1:5179/'));
await page.waitForFunction(() => window.__game, { timeout: 15000 });
await page.bringToFront().catch(() => {});
await page.screenshot({ path: 'tests/evidence/r3-flow-menu.png' }).catch(() => {});
await page.click('#btnStart');
await page.waitForFunction(() => {
  const g = window.__game;
  return g.state === 'playing' && g.phase === 'fight' && g.enemies.length === 4;
}, { timeout: 15000 });
const t0 = await page.evaluate(() => window.__game.time);
await page.waitForFunction((a) => window.__game.time - a > 0.3, t0, { timeout: 10000 });
ok(true, '进入 fight 且世界推进');

// 暂停（真实 P 键）→ 冻结
await page.keyboard.press('KeyP');
await page.waitForFunction(() => window.__game.state === 'paused', { timeout: 5000 });
const p1 = await page.evaluate(() => window.__game.time);
await sleep(1200);
const p2 = await page.evaluate(() => window.__game.time);
ok(p2 - p1 < 0.001, `暂停冻结 (Δ=${(p2 - p1).toFixed(4)}s)`);
await page.screenshot({ path: 'tests/evidence/r3-flow-pause.png' });

// 恢复 → 推进
await page.keyboard.press('KeyP');
await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 5000 });
const r1 = await page.evaluate(() => window.__game.time);
await page.waitForFunction((a) => window.__game.time - a > 0.3, r1, { timeout: 10000 });
ok(true, '恢复后继续推进');

// 直接结算（辅助断言用钩子清空敌军 → 触发胜利流程；主交互仍为真实键鼠）
await page.evaluate(() => { for (const e of [...window.__game.enemies]) window.__game._killEnemy(e); });
await page.waitForFunction(() => window.__game.state === 'over', { timeout: 15000 });
await sleep(2500);
const over1 = await page.evaluate(() => ({ state: window.__game.state, enemies: window.__game.enemies.length }));
ok(over1.state === 'over' && over1.enemies === 0, '全灭→over 且无残留敌军');
await page.screenshot({ path: 'tests/evidence/r3-flow-over.png' });

// over 后真实 R 重开 → 4 敌重置、分数归零
await page.keyboard.press('KeyR');
await page.waitForFunction(() => {
  const g = window.__game;
  return g.state === 'playing' && g.enemies.length === 4 && g.score === 0;
}, { timeout: 15000 });
ok(true, 'R 重开 → 4 敌重置 + 分数归零');

// 第二局暂停一次再恢复，确认重开后流程仍正常
await page.keyboard.press('KeyP');
await page.waitForFunction(() => window.__game.state === 'paused', { timeout: 5000 });
await page.keyboard.press('KeyP');
await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 5000 });
ok(true, '重开后暂停/恢复仍正常');

ok(errors.length === 0, `0 页错误 (${errors.length}) ${errors[0] || ''}`);
await browser.close();
process.exit(fail);
