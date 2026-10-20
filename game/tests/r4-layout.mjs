// R4 布局/视口回归：HUD 栏与画布不重叠、战场四角/出生点完整入画、窄窗口可读、
// 游戏中实际 resize 后仍完整入画、暂停/继续按钮可用。全部等待用 waitForFunction（可观察状态）。
// 这是几何/布局检查（单列），不代替自然试玩（见 r4-play.mjs）。
import { chromium } from 'playwright';
const EXE = process.env.CHROMIUM_PATH || undefined;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [
  { w: 1440, h: 900 },
  { w: 1280, h: 800 },
  { w: 900, h: 1000 },
  { w: 768, h: 1024 },
];
let fail = 0;
const ok = (c, msg) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + msg); if (!c) fail = 1; };

// 页内几何检查：返回断言结果（一次 evaluate，避免多次往返）
async function geom(page) {
  return page.evaluate(() => {
    const g = window.__game;
    const rc = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const canvas = rc('canvas'), top = rc('#topbar'), bot = rc('#botbar');
    const inside = (p, m = 1) => p.x >= canvas.l - m && p.x <= canvas.r + m && p.y >= canvas.t - m && p.y <= canvas.b + m;
    const spawn = g.level.enemySpawns; // [[x,z]...] 瓦片坐标
    const tw = (t) => (t + 0.5) * 4; // tileWorld 中心
    const pts = {
      corners: [[0, 0], [52, 0], [0, 52], [52, 52]].map(([x, z]) => g.projectToScreen(x, 0, z)),
      spawns: spawn.map(([sx, sz]) => g.projectToScreen(tw(sx), 0, tw(sz))),
      player: [g.projectToScreen(26, 0, 26)],
    };
    // HUD 子元素两两不重叠（顶部栏内 + 底部栏内）
    const overlap = (a, b) => !(a.r <= b.l + 0.5 || b.r <= a.l + 0.5 || a.b <= b.t + 0.5 || b.b <= a.t + 0.5);
    const hudPairs = [];
    const groups = ['#topbar > .tb-left, #topbar > .tb-right, #banner'].flatMap((s) => [...document.querySelectorAll(s)]);
    const topKids = ['#score', '#info', '#btnMap', '#btnSound', '#btnPause', '#banner'].map(rc).filter((r) => r.w > 0);
    const botKids = [...document.querySelectorAll('#botbar .stat, #minimap-wrap')].map((el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }).filter((r) => r.w > 0);
    for (let i = 0; i < topKids.length; i++) for (let j = i + 1; j < topKids.length; j++)
      if (overlap(topKids[i], topKids[j])) hudPairs.push('top:' + i + 'x' + j);
    for (let i = 0; i < botKids.length; i++) for (let j = i + 1; j < botKids.length; j++)
      if (overlap(botKids[i], botKids[j])) hudPairs.push('bot:' + i + 'x' + j);
    return {
      canvas, top, bot,
      canvasInWindow: canvas.l >= -0.5 && canvas.t >= -0.5 && canvas.r <= innerWidth + 0.5 && canvas.b <= innerHeight + 0.5,
      barsOutsideCanvas: top.b <= canvas.t + 0.5 && canvas.b <= bot.t + 0.5,
      cornersIn: pts.corners.every(inside),
      corners: pts.corners,
      spawnsIn: pts.spawns.every(inside),
      playerIn: pts.player.every(inside),
      hudOverlap: hudPairs,
      noHScroll: document.documentElement.scrollWidth <= innerWidth + 1,
      scrollW: document.documentElement.scrollWidth,
      scoreVisible: topKids[0] && topKids[0].w > 0,
      btnH: rc('#btnPause').h,
      infoNumText: document.querySelector('#info-num')?.textContent.trim() || '',
      enemyNumText: document.querySelector('#enemy-num')?.textContent.trim() || '',
    };
  });
}

async function waitCombat(page) {
  let lastErr = '';
  for (let a = 0; a < 6; a++) {
    await page.bringToFront().catch(() => {});
    await page.screenshot().catch(() => {});
    try {
      await page.waitForFunction(() => {
        const g = window.__game;
        return g.state === 'playing' && g.phase === 'fight' && g.enemies.length === 4;
      }, { timeout: 12000 });
      const t0 = await page.evaluate(() => window.__game.time);
      await page.waitForFunction((t) => window.__game.time - t > 0.2, t0, { timeout: 8000 });
      return;
    } catch (e) { lastErr = e.message; await sleep(600); }
  }
  throw new Error('前置超时: ' + lastErr.slice(0, 80));
}

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const errors = [];
for (const sz of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: sz.w, height: sz.h } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('' + e));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('requestfailed', (r) => errs.push('reqfail ' + r.url()));
  const tag = `${sz.w}x${sz.h}`;
  await page.goto((process.env.BASE_URL || 'http://127.0.0.1:5179/'));
  await page.waitForFunction(() => window.__game, { timeout: 15000 });
  await page.bringToFront().catch(() => {});
  await page.screenshot({ path: `tests/evidence/r4-${tag}-menu.png` }).catch(() => {});
  // 窄屏菜单/结算卡片必须在窗口内可读（可滚动则 card 自身有 overflow）
  const menuCard = await page.evaluate(() => {
    const r = document.querySelector('#screen-menu .card').getBoundingClientRect();
    return { inWin: r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, h: r.height };
  });
  ok(menuCard.inWin, `[${tag}] 菜单卡片在窗口内`);
  await page.click('#btnStart');
  // 开局横幅（intro 期 2s）：必须与顶部栏左右两组都不相交（静态中间区/窄屏换行）
  try {
    await page.waitForFunction(() => !document.querySelector('#banner').classList.contains('hidden'), { timeout: 8000 });
    const bo = await page.evaluate(() => {
      const f = (o) => ({ l: o.left, r: o.right, t: o.top, b: o.bottom, w: o.width });
      const inter = (a, c) => !(a.r <= c.l + 0.5 || c.r <= a.l + 0.5 || a.b <= c.t + 0.5 || c.b <= a.t + 0.5);
      const ba = f(document.querySelector('#banner').getBoundingClientRect());
      const ra = f(document.querySelector('#topbar .tb-right').getBoundingClientRect());
      const la = f(document.querySelector('#topbar .tb-left').getBoundingClientRect());
      return { r: inter(ba, ra), l: inter(ba, la), w: ba.w };
    });
    ok(!bo.r && !bo.l, `[${tag}] 开局横幅与左右 HUD 组不相交 (w=${bo.w.toFixed(0)}px)`);
  } catch { ok(false, `[${tag}] 开局横幅未出现`); }
  await waitCombat(page);
  const g1 = await geom(page);
  ok(g1.canvasInWindow, `[${tag}] 画布完整在窗口内`);
  ok(g1.barsOutsideCanvas, `[${tag}] 顶部/底部栏与画布零重叠`);
  ok(g1.cornersIn, `[${tag}] 战场四角全部入画`);
  ok(g1.spawnsIn, `[${tag}] 4 敌出生点+玩家出生点入画`);
  ok(g1.hudOverlap.length === 0, `[${tag}] HUD 各组互不重叠${g1.hudOverlap.length ? ' ' + g1.hudOverlap.join(',') : ''}`);
  ok(g1.noHScroll, `[${tag}] 无水平溢出 (scrollW=${g1.scrollW} <= ${sz.w})`);
  ok(g1.btnH >= 28, `[${tag}] 按钮正常尺寸 (h=${g1.btnH.toFixed(0)}px)`);
  const norm = (s) => s.replace(/[\u00a0\u2007\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
  ok(/^\|?\s*敌军\s*\d\/4\s*\|\s*击毁\s*\d/.test(norm(g1.infoNumText)) && /^\d\/4$/.test(g1.enemyNumText),
    `[${tag}] 关键数字可见：顶栏「${g1.infoNumText.replace(/\s+/g, ' ')}」+ 底栏「${g1.enemyNumText}」`);
  // 游戏中实际 resize（仅 1280x800 场景执行一次，代表真实窗口变化）
  if (sz.w === 1280 && sz.h === 800) {
    const t0 = await page.evaluate(() => window.__game.time);
    await page.setViewportSize({ width: 900, height: 1000 });
    await page.waitForFunction((t) => window.__game.time - t > 0.2, t0, { timeout: 8000 });
    await page.waitForTimeout(300);
    const g2 = await geom(page);
    ok(g2.canvasInWindow && g2.cornersIn && g2.spawnsIn && g2.barsOutsideCanvas,
      `[1280→900x1000 游戏中] resize 后画布/四角/出生点仍完整、栏不压画布`);
    // 暂停按钮（真实点击）→ 冻结 → 继续
    await page.click('#btnPause');
    await page.waitForFunction(() => window.__game.state === 'paused', { timeout: 5000 });
    const fp = await page.evaluate(() => window.__game.time);
    await page.waitForFunction((t) => Math.abs(window.__game.time - t) < 0.001, fp, { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
    const fp2 = await page.evaluate(() => window.__game.time);
    ok(Math.abs(fp2 - fp) < 0.001, `[游戏中] 暂停按钮冻结世界 (Δ=${(fp2 - fp).toFixed(4)}s)`);
    await page.click('#btnResume');
    await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 5000 });
    const t1 = await page.evaluate(() => window.__game.time);
    await page.waitForFunction((t) => window.__game.time - t > 0.15, t1, { timeout: 5000 });
    ok(true, `[游戏中] 继续按钮恢复推进`);
    // 小地图展开 → 底部栏加高、画布重排，战场仍完整入画且 HUD 不互盖；收起恢复
    await page.click('#btnMap');
    await page.waitForFunction(() => document.querySelector('#minimap-wrap').classList.contains('on'), { timeout: 5000 });
    await page.waitForTimeout(400); // ResizeObserver 重排
    const g3 = await geom(page);
    ok(g3.canvasInWindow && g3.cornersIn && g3.barsOutsideCanvas && g3.hudOverlap.length === 0,
      `[游戏中] 小地图展开后：四角入画、栏不压画布、HUD 不互盖`);
    await page.screenshot({ path: 'tests/evidence/r4-minimap-on.png' }).catch(() => {});
    await page.click('#btnMap');
    await page.waitForFunction(() => !document.querySelector('#minimap-wrap').classList.contains('on'), { timeout: 5000 });
    await page.waitForTimeout(300);
    const g4 = await geom(page);
    ok(g4.cornersIn && g4.barsOutsideCanvas, `[游戏中] 小地图收起后画布复原、四角入画`);
  }
  errors.push(...errs.map((e) => tag + ': ' + e));
  await page.screenshot({ path: `tests/evidence/r4-${tag}-battle.png` }).catch(() => {});
  await ctx.close();
}
ok(errors.length === 0, `0 页错误/资源失败 (${errors.length}) ${errors[0] || ''}`);
await browser.close();
console.log(fail ? '\n→ FAIL' : '\n→ PASS');
process.exit(fail);
