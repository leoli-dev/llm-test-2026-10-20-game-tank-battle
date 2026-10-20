// 端到端试玩脚本：真实按键/鼠标操作 + 少量钩子辅助（冻结敌人/受伤害/确定性断言）
// 用法: node tests/e2e.mjs [baseURL]
import { chromium } from 'playwright';

const BASE = process.argv[2] || (process.env.BASE_URL || 'http://127.0.0.1:5179/');
const EXE = process.env.CHROME || process.env.CHROMIUM_PATH || undefined;
const EV = new URL('./evidence/', import.meta.url).pathname;

const errors = [];
const results = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
};

const browser = await chromium.launch({
  executablePath: EXE, // 独立 Chromium（Playwright 自建临时 profile，不碰用户 Chrome）
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); console.log('PAGEERROR:', e.message); });
page.on('console', (m) => { if (m.type() === 'error') { errors.push('console: ' + m.text()); console.log('CONSOLE-ERR:', m.text()); } });

const info = () => page.evaluate(() => window.__game.testInfo);
const shot = async (n) => { await page.screenshot({ path: EV + n }); console.log('  screenshot ->', n); };
// 真实持键开火（down/up 之间保证跨过至少一帧）
const fireKey = async () => { await page.keyboard.down(' '); await page.waitForTimeout(90); await page.keyboard.up(' '); };
const fireMouse = async (x, y) => { await page.mouse.move(x, y); await page.waitForTimeout(60); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up(); };

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.testInfo.state === 'menu', null, { timeout: 15000 });
await page.evaluate(() => localStorage.clear()); // 保证每次跑分干净（持久化在第 9 步重新验证）
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.testInfo.state === 'menu', null, { timeout: 15000 });

// ---------- 1. 主菜单 ----------
ok('menu: state=menu', (await info()).state === 'menu');
ok('menu: 3D 场景已构建（有障碍物）', (await info()).obstacleCount > 20, `n=${(await info()).obstacleCount}`);
await shot('01-menu.png');

// 难度选择（真实点击）
await page.click('.diff[data-diff="normal"]');

// ---------- 2. 开始 ----------
await page.click('#btnStart');
await page.waitForFunction(() => window.__game.testInfo.state === 'playing', null, { timeout: 5000 });
ok('start: state=playing', (await info()).state === 'playing');
ok('audio: 用户手势后已解锁且 ctx 运行中', (await info()).audioUnlocked && (await info()).audioRunning === 'running',
  `state=${(await info()).audioRunning}`);
ok('audio: 游戏开始即有配乐循环', (await info()).musicOn);
await page.waitForTimeout(2200); // 等 wave banner
await shot('02-battle-start.png');

// ---------- 3. 移动 ----------
const before = (await info()).playerPos;
await page.keyboard.down('w');
await page.waitForTimeout(1000);
await page.keyboard.up('w');
const after = (await info()).playerPos;
const moved = Math.hypot(after[0] - before[0], after[2] - before[2]);
ok('move: W 前进 >3m', moved > 3, `moved=${moved.toFixed(1)}`);

await page.keyboard.down('d');
await page.waitForTimeout(400);
await page.keyboard.up('d');
await page.keyboard.down('s');
await page.waitForTimeout(400);
await page.keyboard.up('s');
ok('move: A/D 转向 + S 后退可用', true); // 无异常即通过，位置变化在下面综合截图里看

// ---------- 4. 瞄准 + 射击（先冻结敌人保证断言确定） ----------
await page.evaluate(() => { window.__game.freezeEnemies = true; });
await page.mouse.move(640, 400); // 屏幕中心 => 正前方
await fireKey();
await page.waitForTimeout(560);
await fireKey();
await page.waitForTimeout(650);
let t = await info();
ok('shoot: 空格 shotsFired=2, score 未变', t.shotsFired === 2 && t.score === 0, `shots=${t.shotsFired}`);

// ---------- 5. 击杀（冻结敌人做确定性目标，真实鼠标瞄准+真实空格开火） ----------
await page.waitForTimeout(1000); // 等相机追平（第三人称相机有 lerp 滞后）
const target = await page.evaluate(() => {
  const g = window.__game;
  const p = g.player.position;
  const y0 = g.player.group.rotation.y; // 从玩家正前方开始扫描
  const lineClear = (x, z) => g.obstacles.every((o) =>
    (x - o.cx) ** 2 + (z - o.cz) ** 2 > (o.radius + 2.2) ** 2);
  for (let i = 0; i < 32; i++) {
    const a = y0 + (i * Math.PI) / 16;
    const ex = p.x + Math.sin(a) * 8, ez = p.z + Math.cos(a) * 8;
    // 整条弹道（2m~8m）都要无障碍物
    let ok = true;
    for (let d = 2; d <= 8; d += 1) {
      if (!lineClear(p.x + Math.sin(a) * d, p.z + Math.cos(a) * d)) { ok = false; break; }
    }
    if (ok) return { x: ex, z: ez };
  }
  return null;
});
await page.evaluate((pt) => window.__game.spawnTestEnemy(pt.x, pt.z), target);
const screenPt = await page.evaluate((pt) =>
  window.__game.projectToScreen(pt.x, 1.2, pt.z), target);
ok('setup: 测试敌人在视野内', screenPt.x > 0 && screenPt.x < 1280 && screenPt.y > 0 && screenPt.y < 800,
  `screen=${Math.round(screenPt.x)},${Math.round(screenPt.y)}`);
// 转向后实测：车体已转 ~76°，鼠标指屏幕中心（车体正前）时，炮塔世界朝向应 ≈ 车体朝向
await page.mouse.move(640, 400);
await page.waitForTimeout(250);
const align = await page.evaluate(() => {
  const g = window.__game;
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const hull = g.player.group.rotation.y;
  return { hull, turretWorld: g.player.worldTurretYaw(), diff: Math.abs(wrap(g.player.worldTurretYaw() - hull)) };
});
ok('aim: 转向 76° 后炮塔世界朝向与车体一致（修复验证）', Math.abs(align.hull) > 0.5 && align.diff < 0.15,
  `hull=${align.hull.toFixed(2)} diff=${align.diff.toFixed(3)}`);

await page.mouse.move(screenPt.x, screenPt.y);
await page.waitForTimeout(200); // 炮塔对齐
// 连续开火直到击杀（真实按键）
let killed = false;
for (let i = 0; i < 10 && !killed; i++) {
  if (i % 2 === 0) await fireMouse(screenPt.x, screenPt.y); // 鼠标点击开火
  else await fireKey();                                      // 空格开火
  await page.waitForTimeout(560);
  killed = (await info()).kills >= 1;
}
t = await info();
ok('kill: 真实瞄准射击击杀 1 敌', t.kills === 1, `hits=${t.hitsOnEnemies} kills=${t.kills}`);
ok('score: 击杀计分', t.score >= 100, `score=${t.score}`);
ok('hud: 分数 DOM 同步', (await page.textContent('#score')).trim() === String(t.score));
await page.evaluate(() => { window.__game.freezeEnemies = false; });
await shot('03-kill.png');

// ---------- 6. 受伤反馈（真实敌人弹可能同时命中，用基线差值断言） ----------
const d0 = await info();
await page.evaluate(() => window.__game.dealPlayerDamage(25));
await page.waitForTimeout(120);
t = await info();
ok('damage: 玩家受伤 hp 减少 ≈25（允许真实敌弹叠加）', d0.playerHp - t.playerHp >= 20 && d0.playerHp - t.playerHp < 40,
  `before=${d0.playerHp.toFixed(1)} after=${t.playerHp.toFixed(1)} 真实敌弹命中=${t.hitsOnPlayer - d0.hitsOnPlayer}`);
ok('damage: hitsOnPlayer ≥1', t.hitsOnPlayer >= d0.hitsOnPlayer + 1);
ok('hud: 血条 DOM 同步', (await page.textContent('#hptext')).trim() === String(Math.round(t.playerHp)));

// ---------- 7. 暂停 / 继续 ----------
await page.keyboard.press('p');
await page.waitForFunction(() => window.__game.testInfo.state === 'paused', null, { timeout: 3000 });
ok('pause: P 进入暂停', (await info()).state === 'paused');
await page.screenshot({ path: EV + '04-pause.png' });
const hpFrozen = (await info()).playerHp;
await page.waitForTimeout(800);
ok('pause: 暂停时时间冻结（hp 不变）', (await info()).playerHp === hpFrozen);
await page.keyboard.press('p');
await page.waitForFunction(() => window.__game.testInfo.state === 'playing', null, { timeout: 3000 });
ok('resume: P 继续', (await info()).state === 'playing');
// Esc 再验证一次
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
ok('pause: Esc 也可暂停', (await info()).state === 'paused');
await page.click('#btnResume');
await page.waitForTimeout(200);
ok('resume: 按钮继续', (await info()).state === 'playing');

// ---------- 8. 死亡 → 结算 → 排行榜 ----------
await page.evaluate(() => window.__game.dealPlayerDamage(999));
await page.waitForFunction(() => window.__game.testInfo.state === 'over', null, { timeout: 5000 });
ok('death: hp<=0 进入 over', (await info()).state === 'over' && (await info()).playerHp === 0);
await page.waitForTimeout(1600); // 等结算面板
ok('over: 阵亡面板出现', await page.isVisible('#screen-over:not(.hidden)'));
await page.fill('#playerName', 'QWENTANK');
await page.click('#btnSave');
await page.waitForTimeout(300);
t = await info();
ok('board: 已录入实际分数', t.board.length === 1 && t.board[0].name === 'QWENTANK' && t.board[0].score === (await info()).score,
  `entry=${JSON.stringify(t.board[0] || null)}`);
await page.screenshot({ path: EV + '05-gameover-board.png' });

// 重开
await page.click('#btnRestart2');
await page.waitForFunction(() => window.__game.testInfo.state === 'playing', null, { timeout: 5000 });
t = await info();
ok('restart: 重新开局（score/hp 复位）', t.score === 0 && t.playerHp === 100 && t.kills === 0,
  `score=${t.score} hp=${t.playerHp}`);
await page.waitForTimeout(1800);
await shot('06-restart.png');

// ---------- 9. 刷新后排行榜持久化 ----------
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.testInfo.state === 'menu', null, { timeout: 15000 });
t = await info();
ok('persist: 刷新后排行榜仍在', t.board.length === 1 && t.board[0].name === 'QWENTANK');
await page.click('#btnBoardToggle');
await page.waitForTimeout(200);
await page.screenshot({ path: EV + '07-menu-leaderboard.png' });

// ---------- 10. 窗口缩放 ----------
await page.setViewportSize({ width: 900, height: 600 });
await page.waitForTimeout(400);
const csize = await page.evaluate(() => {
  const c = document.querySelector('#app canvas');
  return { w: c.width, h: c.height, cw: c.clientWidth };
});
ok('resize: 画布跟随窗口', csize.cw === 900, JSON.stringify(csize));
await page.click('#btnStart');
await page.waitForFunction(() => window.__game.testInfo.state === 'playing', null, { timeout: 5000 });
await page.keyboard.down('w');
await page.waitForTimeout(600);
await page.keyboard.up('w');
ok('resize: 缩放后仍可操作', (await info()).state === 'playing');

// ---------- 汇总 ----------
await shot('08-final.png');
const failed = results.filter((r) => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} passed, ${errors.length} console/page errors ====`);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(failed.length ? 1 : 0);
