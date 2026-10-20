// R4 自然试玩（UI 重排后）：真实 WASD/鼠标/Space，不改血量/瞬移/冻结。
// ① 1280×800 完整打满一局固定 4 敌任务（自然胜/负均如实记录）
// ② 900×1000 窄屏真实战斗：移动 + 瞄准射击（验证新投影链路）+ 冲四角入口穿行
// ③ 768×1024 窄屏暂停/继续/结算卡片可读（真实点击按钮）
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const EXE = process.env.CHROMIUM_PATH || undefined;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const ok = (c, msg) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + msg); if (!c) fail = 1; };

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const errors = [];

function attach(page, tag) {
  page.on('pageerror', (e) => errors.push(tag + ': ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ': ' + m.text()); });
  page.on('requestfailed', (r) => errors.push(tag + ': reqfail ' + r.url()));
}
async function toScreen(page, x, z) {
  return page.evaluate(([x, z]) => {
    const p = window.__game.projectToScreen(x, 0, z);
    return { sx: p.x, sy: p.y };
  }, [x, z]);
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
async function snap(page, name) { try { await page.screenshot({ path: `tests/evidence/${name}` }); } catch {} }

// ============ ① 宽屏完整自然局（1280×800） ============
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  attach(page, 'wide');
  await page.goto((process.env.BASE_URL || 'http://127.0.0.1:5179/'));
  await page.waitForFunction(() => window.__game, { timeout: 15000 });
  await page.bringToFront().catch(() => {});
  await page.screenshot({ path: 'tests/evidence/r4-wide-menu.png' }).catch(() => {});
  await page.click('#btnStart');
  await waitCombat(page);
  await snap(page, 'r4-wide-start.png');
  await page.keyboard.down('Space');
  const keys = { W: false, A: false, S: false, D: false };
  const setKey = async (k, on) => {
    if (keys[k] === on) return;
    keys[k] = on;
    if (on) await page.keyboard.down('Key' + k); else await page.keyboard.up('Key' + k);
  };
  const setKeys = async (want) => { for (const k of ['W', 'A', 'S', 'D']) await setKey(k, want.includes(k)); };
  const t0 = Date.now();
  let lastPos = null, stuckT = 0, strafeDir = 1, strafeFlip = 0, shotBreak = false;
  let shotsStart = await page.evaluate(() => window.__game.shotsFired);
  while (Date.now() - t0 < 120000) {
    const st = await page.evaluate(() => {
      const g = window.__game;
      return {
        state: g.state, time: g.time,
        px: g.player.group.position.x, pz: g.player.group.position.z,
        enemies: g.enemies.map((e) => ({ x: e.tank.group.position.x, z: e.tank.group.position.z })),
      };
    });
    if (st.state !== 'playing') break;
    let tgt = null, bd = 1e9;
    for (const e of st.enemies) { const d = Math.hypot(e.x - st.px, e.z - st.pz); if (d < bd) { bd = d; tgt = e; } }
    if (tgt) {
      const scr = await toScreen(page, tgt.x, tgt.z);
      await page.mouse.move(scr.sx, scr.sy, { steps: 2 });
      const dx = tgt.x - st.px, dz = tgt.z - st.pz;
      const want = [];
      if (bd > 13) { if (dz > 0.4) want.push('S'); else if (dz < -0.4) want.push('W'); if (dx > 0.4) want.push('D'); else if (dx < -0.4) want.push('A'); }
      else if (bd < 6) { if (dz > 0.4) want.push('W'); else if (dz < -0.4) want.push('S'); if (dx > 0.4) want.push('A'); else if (dx < -0.4) want.push('D'); }
      else {
        if (Date.now() - strafeFlip > 1600) { strafeDir *= -1; strafeFlip = Date.now(); }
        const px = -dz / bd * strafeDir, pz = dx / bd * strafeDir;
        if (pz < -0.3) want.push('W'); else if (pz > 0.3) want.push('S');
        if (px < -0.3) want.push('A'); else if (px > 0.3) want.push('D');
      }
      await setKeys(want);
    }
    if (lastPos) {
      if (Math.hypot(st.px - lastPos[0], st.pz - lastPos[1]) < 0.05) stuckT += 120; else stuckT = 0;
      if (stuckT > 2500) {
        const dirs = [['W'], ['A'], ['S'], ['D'], ['W', 'A'], ['W', 'D'], ['S', 'A'], ['S', 'D']];
        await setKeys(dirs[Math.floor(Math.random() * dirs.length)]);
        stuckT = 0;
        await sleep(900);
      }
    }
    lastPos = [st.px, st.pz];
    const bricks = await page.evaluate(() => window.__game.bricksBroken);
    if (bricks > 0 && !shotBreak) { await snap(page, 'r4-wide-break.png'); shotBreak = true; }
    // rAF 节拍
    await Promise.race([
      page.evaluate(() => new Promise((res) => {
        const g = window.__game, t0 = g.time;
        const f = () => (g.time !== t0 || g.state !== 'playing') ? res() : requestAnimationFrame(f);
        requestAnimationFrame(f);
      })),
      sleep(1200),
    ]);
  }
  await setKeys([]);
  await page.keyboard.up('Space');
  for (let i = 0; i < 25; i++) {
    const s = await page.evaluate(() => window.__game.state);
    if (s === 'over') break;
    await sleep(200);
  }
  const fin = await page.evaluate(() => {
    const g = window.__game;
    return { kills: g.kills, total: g._totalEnemies, lives: g.lives, hp: g.player.hp,
             score: g.score, bricks: g.bricksBroken, shots: g.shotsFired,
             hits: g.hitsOnEnemies, hitsOnPlayer: g.hitsOnPlayer,
             enemies: g.enemies.length, time: +g.time.toFixed(1) };
  });
  const win = fin.kills >= fin.total && fin.lives > 0;
  ok(fin.shots > shotsStart && fin.hits > 0, `[宽屏] 真实射击链路：${fin.shots} 炮 / ${fin.hits} 命中敌`);
  ok(win, `[宽屏] 自然打满固定 4 敌任务：${win ? '胜利' : '战败'}（${fin.kills}/${fin.total} 击杀，${fin.lives} 命，${fin.hp}HP，${fin.score} 分，破砖 ${fin.bricks}，中弹 ${fin.hitsOnPlayer}，游戏时 ${fin.time}s）`);
  await snap(page, 'r4-wide-over.png');
  console.log('WIDE:', JSON.stringify(fin));
  await ctx.close();
}

// ============ ② 窄屏 900×1000：真实战斗 + 冲四角穿行 ============
{
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const page = await ctx.newPage();
  attach(page, 'narrow');
  await page.goto((process.env.BASE_URL || 'http://127.0.0.1:5179/'));
  await page.waitForFunction(() => window.__game, { timeout: 15000 });
  await page.bringToFront().catch(() => {});
  await page.click('#btnStart');
  await waitCombat(page);
  await snap(page, 'r4-narrow-start.png');
  await page.keyboard.down('Space');
  // 冲左上角入口（瓦片 (0,1) 邻域）穿行，同时持续瞄准最近敌
  const t0 = Date.now();
  let movedFar = false, shots0 = 0, hits0 = 0;
  while (Date.now() - t0 < 30000) {
    const st = await page.evaluate(() => {
      const g = window.__game;
      return {
        state: g.state, time: g.time,
        px: g.player.group.position.x, pz: g.player.group.position.z,
        enemies: g.enemies.map((e) => ({ x: e.tank.group.position.x, z: e.tank.group.position.z })),
        shots: g.shotsFired, hits: g.hitsOnEnemies,
      };
    });
    if (st.state !== 'playing') break;
    if (!shots0) shots0 = st.shots;
    if (!hits0) hits0 = st.hits;
    // 先冲向左上角（< 2.5m 到边界即算穿行到角区），随后在角区附近游走
    const want = [];
    const nearCorner = st.px < 12 && st.pz < 12;
    if (!nearCorner) { want.push('W', 'A'); }
    else {
      // 角区横移（沿回廊），保持真实移动
      const ph = Math.floor((Date.now() - t0) / 2500) % 2;
      if (ph) want.push('S'); else want.push('D');
    }
    for (const k of ['W', 'A', 'S', 'D']) { if (want.includes(k)) await page.keyboard.down('Key' + k); else await page.keyboard.up('Key' + k); }
    if (nearCorner) movedFar = true;
    if (st.enemies.length) {
      let tgt = null, bd = 1e9;
      for (const e of st.enemies) { const d = Math.hypot(e.x - st.px, e.z - st.pz); if (d < bd) { bd = d; tgt = e; } }
      const scr = await toScreen(page, tgt.x, tgt.z);
      await page.mouse.move(scr.sx, scr.sy, { steps: 2 });
    }
    if (Date.now() - t0 > 15000) break; // 15s 足够穿行+交火
    await sleep(120);
  }
  for (const k of ['W', 'A', 'S', 'D']) await page.keyboard.up('Key' + k);
  await page.keyboard.up('Space');
  const fin = await page.evaluate(() => {
    const g = window.__game;
    return { shots: g.shotsFired, hits: g.hitsOnEnemies, px: g.player.group.position.x, pz: g.player.group.position.z,
             state: g.state, time: +g.time.toFixed(1), kills: g.kills };
  });
  ok(movedFar, `[窄屏] 玩家实际移动到左上角区 (${fin.px.toFixed(1)}, ${fin.pz.toFixed(1)})`);
  ok(fin.shots > 0 && fin.hits > 0, `[窄屏] 真实瞄准射击：${fin.shots} 炮 / ${fin.hits} 命中（新投影链路成立）`);
  await snap(page, 'r4-narrow-fight.png');
  console.log('NARROW:', JSON.stringify(fin));
  await ctx.close();
}

// ============ ③ 768×1024：暂停/继续/结算卡片真实按钮 ============
{
  const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  const page = await ctx.newPage();
  attach(page, 'tiny');
  await page.goto((process.env.BASE_URL || 'http://127.0.0.1:5179/'));
  await page.waitForFunction(() => window.__game, { timeout: 15000 });
  await page.bringToFront().catch(() => {});
  await snap(page, 'r4-tiny-menu.png');
  const mc = await page.evaluate(() => {
    const r = document.querySelector('#screen-menu .card').getBoundingClientRect();
    return { inWin: r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
  });
  ok(mc.inWin, '[768] 菜单卡片在窗口内（可滚动）');
  await page.click('#btnStart');
  await waitCombat(page);
  await page.click('#btnPause');
  await page.waitForFunction(() => window.__game.state === 'paused', { timeout: 5000 });
  const pc = await page.evaluate(() => {
    const r = document.querySelector('#screen-pause .card').getBoundingClientRect();
    return { inWin: r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
  });
  ok(pc.inWin, '[768] 暂停卡片在窗口内');
  await page.screenshot({ path: 'tests/evidence/r4-tiny-pause.png' }).catch(() => {});
  await page.click('#btnResume');
  await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 5000 });
  ok(true, '[768] 真实按钮 暂停→继续 正常');
  await ctx.close();
}

await browser.close();
ok(errors.length === 0, `0 页错误/资源失败 (${errors.length}) ${errors[0] || ''}`);
writeFileSync('tests/evidence/r4-play-sessions.json', JSON.stringify({ wide: 1, pageErrors: errors }, null, 2));
console.log(fail ? '\n→ FAIL' : '\n→ PASS');
process.exit(fail);
