// R2 墙体机制完整验证（真实键盘/鼠标；读状态仅用于判定停手时机与断言）：
//  目标砖 (5,10)，中心世界坐标 (22, 42)，南边 z=44。玩家出生 (26, 50)。
//  1) 真实驾驶 A+W 到砖南侧，W 撞墙 → 坦克必须被阻挡（z 停在 42.85 附近，不越过 42.7）
//  2) 2 发真实射击摧毁该砖（tileAt → null，bricksBroken 恰好 1）
//  3) 继续 W 前进 → 越过原砖中心（z < 41.5）
// 退出码：0=PASS，1=FAIL。finally 关闭自己的浏览器。
import { chromium } from 'playwright';

const URL = (process.env.BASE_URL || 'http://127.0.0.1:5179/');
const EXE = process.env.CHROMIUM_PATH || undefined;
const firstError = { msg: '', count: 0 };
const failures = [];
const log = (...a) => console.log('[wall]', ...a);

const getPos = () => {
  const g = window.__game;
  return { x: g.player.pos.x, z: g.player.pos.z };
};

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
  await page.waitForTimeout(1600); // 出生无敌/闪烁

  // 前置：确认 (5,10) 是砖
  const t0 = await page.evaluate(() => window.__game.tileAt(22, 42));
  log('(5,10) 瓦片', JSON.stringify(t0));
  if (t0?.type !== 'B') throw new Error('测试前提不成立：(5,10) 不是砖');

  // ---- 阶段1：驾驶到砖南侧并撞墙 ----
  // 1a. A 修正到 x≈22（真实按 A，轮询位置）
  {
    const t0m = Date.now();
    while (Date.now() - t0m < 8000) {
      const p = await page.evaluate(getPos);
      if (Math.abs(p.x - 22) < 0.25) break;
      await page.keyboard.down('KeyA');
      await page.waitForTimeout(60);
      await page.keyboard.up('KeyA');
      await page.waitForTimeout(30);
    }
  }
  // 1b. W 前进撞墙（轮询直到 z 停止下降或到位）
  {
    const t0m = Date.now();
    let lastZ = (await page.evaluate(getPos)).z;
    await page.keyboard.down('KeyW');
    while (Date.now() - t0m < 10000) {
      await page.waitForTimeout(100);
      const p = await page.evaluate(getPos);
      if (p.z > lastZ - 0.02) break; // 不再前进 = 被阻挡
      lastZ = p.z;
      if (p.z < 42.7) break;
    }
    await page.keyboard.up('KeyW');
  }
  const p1 = await page.evaluate(getPos);
  log('撞墙后位置', JSON.stringify({ x: +p1.x.toFixed(2), z: +p1.z.toFixed(2) }));
  if (p1.z < 42.6) failures.push(`砖墙未阻挡坦克：z=${p1.z.toFixed(2)} 已越过 42.6（墙南边 44 - 半径 1.15 ≈ 42.85）`);

  // ---- 阶段2：2 发真实射击摧毁 ----
  const s = await page.evaluate(() => window.__game.projectToScreen(22, 0, 42));
  await page.mouse.move(s.x, s.y);
  for (let i = 0; i < 2; i++) {
    await page.keyboard.down('Space');
    await page.waitForTimeout(350);
    await page.keyboard.up('Space');
    await page.waitForTimeout(500);
  }
  const after = await page.evaluate(() => ({
    tile: window.__game.tileAt(22, 42),
    bricksBroken: window.__game.bricksBroken,
    shots: window.__game.shotsFired,
  }));
  log('射击后', JSON.stringify(after));
  if (after.tile !== null) failures.push(`2 发未摧毁砖: ${JSON.stringify(after.tile)}`);
  if (after.bricksBroken !== 1) failures.push(`破墙计数错误: ${after.bricksBroken}（期望 1）`);

  // ---- 阶段3：穿过原砖位置（轮询直到越过或超时）----
  {
    const t0m = Date.now();
    await page.keyboard.down('KeyW');
    while (Date.now() - t0m < 4000) {
      await page.waitForTimeout(100);
      const p = await page.evaluate(getPos);
      if (p.z < 41.5) break;
    }
    await page.keyboard.up('KeyW');
  }
  const p2 = await page.evaluate(() => {
    const g = window.__game;
    return { x: g.player.pos.x, z: g.player.pos.z, info: g.testInfo };
  });
  log('穿墙后位置', JSON.stringify({ x: +p2.x.toFixed(2), z: +p2.z.toFixed(2), state: p2.info?.state, phase: p2.info?.phase, hp: p2.info?.playerHp, dead: p2.info?.playerDead, lives: p2.info?.lives }));
  if (p2.z >= 41.5) failures.push(`穿墙后未越过原砖中心: z=${p2.z.toFixed(2)} (期望 < 41.5)`);
} catch (e) {
  failures.push(`脚本异常: ${e.message}`);
} finally {
  if (firstError.count > 0) failures.push(`浏览器异常 ${firstError.count} 次: ${firstError.msg}`);
  if (failures.length) {
    log('FAIL:');
    for (const f of failures) console.log('  -', f);
    process.exitCode = 1;
  } else log('PASS：阻挡→2发摧毁→穿过 全部符合');
  if (browser) await browser.close().catch(() => {});
}
