// R2 诊断：最小闭环 —— 从出生点用真实鼠标+空格射击正前方砖墙。
// 验证：能开火、弹道与炮管同向、砖墙 2 发摧毁且计数不膨胀、无浏览器异常。
// 退出码：0=PASS，1=FAIL。finally 中关闭自己启动的浏览器。
import { chromium } from 'playwright';

const PORT = 5179;
const URL = `http://127.0.0.1:${PORT}/`;
const EXE = process.env.CHROMIUM_PATH || undefined;
const SHOT_BEFORE = 'tests/evidence/r2-diag-wall-before.png';
const SHOT_AFTER = 'tests/evidence/r2-diag-wall-after.png';

const firstError = { msg: '', count: 0 };
const failures = [];
const log = (...a) => console.log('[diag]', ...a);

let browser = null;
try {
  browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => {
    firstError.count++;
    if (!firstError.msg) firstError.msg = (e.stack || e.message || String(e)).split('\n').slice(0, 4).join(' | ');
  });

  log('打开', URL);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForFunction(() => window.__game, { timeout: 10000 });

  // 选目标砖：玩家正前方（z 更小）最近的 B
  await page.click('#btnStart');
  await page.waitForTimeout(1200);
  const target = await page.evaluate(() => {
    const g = window.__game;
    const lvl = g.getLevel();
    const [psx, psz] = lvl.playerSpawn;
    let best = null;
    for (let tz = 0; tz < lvl.grid.length; tz++)
      for (let tx = 0; tx < lvl.grid[0].length; tx++) {
        if (lvl.grid[tz][tx] !== 'B') continue;
        if (tz >= psz) continue;
        const d = Math.hypot(tx - psx, tz - psz);
        if (!best || d < best.d) best = { tx, tz, d };
      }
    // 该砖中心世界坐标（tileWorld: (x+0.5)*4）
    return best ? { tx: best.tx, tz: best.tz, wx: (best.tx + 0.5) * 4, wz: (best.tz + 0.5) * 4 } : null;
  });
  if (!target) throw new Error('地图上未找到玩家前方的砖墙');
  log('目标砖', JSON.stringify(target));

  const before = await page.evaluate(() => {
    const g = window.__game;
    return { tile: g.tileAt(0, 0), info: g.testInfo };
  });
  const targetBefore = await page.evaluate((t) => window.__game.tileAt(t.wx, t.wz), target);
  log('射击前目标砖', JSON.stringify(targetBefore));
  await page.screenshot({ path: SHOT_BEFORE });

  // 真实鼠标瞄准 + 真实空格射击（2.2s 约 6 发）
  const s = await page.evaluate((t) => window.__game.projectToScreen(t.wx, 0, t.wz), target);
  await page.mouse.move(s.x, s.y);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.down('Space');
    await page.waitForTimeout(300);
    await page.keyboard.up('Space');
    if (i < 5) await page.waitForTimeout(60);
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: SHOT_AFTER });

  const r = await page.evaluate((t) => {
    const g = window.__game;
    // 炮口世界坐标 → 可见炮管方向；与 turretForward 点积
    const tank = g.player;
    tank.muzzle.updateWorldMatrix(true, false);
    const m = tank.muzzle.matrixWorld;
    let vx = m.elements[12] - tank.pos.x, vz = m.elements[14] - tank.pos.z;
    const L = Math.hypot(vx, vz) || 1;
    vx /= L; vz /= L;
    const fwd = tank.turretForward();
    // 全局检查：有无负 HP 砖、tileMeshes 与 cells 是否对齐
    let negHp = 0, desync = 0;
    for (let z = 0; z < g.level.cells.length; z++)
      for (let x = 0; x < g.level.cells[z].length; x++) {
        const c = g.level.cells[z][x];
        if (c?.type === 'B' && c.hp < 0) negHp++;
        if (!!c !== !!g.tileMeshes[z * 13 + x]) desync++;
      }
    return {
      dot: +(vx * fwd.x + vz * fwd.z).toFixed(4),
      targetTile: g.tileAt(t.wx, t.wz),
      bricksBroken: g.bricksBroken,
      shots: g.shotsFired,
      negHp,
      desync,
      bullets: g.bullets.length,
      state: g.testInfo.state,
      aim: [g.aimPoint.x.toFixed(2), g.aimPoint.z.toFixed(2)],
    };
  }, target);
  log('结果', JSON.stringify(r));
  log('浏览器异常', firstError.count ? `${firstError.count} 次，首个: ${firstError.msg}` : '无');

  if (firstError.count > 0) failures.push(`浏览器异常 ${firstError.count} 次: ${firstError.msg}`);
  if (r.shots < 5) failures.push(`开火失败: shots=${r.shots} (期望>=5)`);
  if (r.dot < 0.99) failures.push(`炮管与弹道方向不一致: dot=${r.dot}`);
  if (r.targetTile !== null) failures.push(`目标砖未被摧毁: ${JSON.stringify(r.targetTile)}`);
  if (r.bricksBroken > 4) failures.push(`破墙计数膨胀: bricksBroken=${r.bricksBroken} (6发最多破2-4块)`);
  if (r.negHp > 0) failures.push(`存在负HP砖: ${r.negHp}`);
  if (r.desync > 0) failures.push(`tileMeshes 与 cells 错位: ${r.desync}`);
} catch (e) {
  failures.push(`脚本异常: ${e.message}\n${(e.stack || '').split('\n').slice(0, 5).join('\n')}`);
  if (firstError.count > 0) failures.push(`浏览器异常 ${firstError.count} 次: ${firstError.msg}`);
} finally {
  if (browser) await browser.close().catch(() => {});
}

if (failures.length) {
  log('FAIL:');
  for (const f of failures) console.log('  -', f);
  process.exit(1);
}
log('PASS：出生点真射击墙闭环正常');
process.exit(0);
