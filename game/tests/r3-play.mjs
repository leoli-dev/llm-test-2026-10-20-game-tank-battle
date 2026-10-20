// R3 自然试玩：≥3 局，真实 WASD/鼠标/Space 输入，等待可观察前置条件（fight 且 game.time 连续推进）。
// 记录全部结果（含战败），不做 fixture 胜利。证据：截图 + sessions.json。
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const EXE = process.env.CHROMIUM_PATH || undefined;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SESSIONS = 3;
const BUDGET_MS = 150000;

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('' + e));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// 页内 rAF 等待一帧（游戏时间变化或离开 playing 即返回；null=超时/卡顿）
async function waitFrame(timeoutMs = 1500) {
  try {
    return await Promise.race([
      page.evaluate(() => new Promise((res) => {
        const g = window.__game;
        const t0 = g.time;
        const f = () => (g.time !== t0 || g.state !== 'playing') ? res(g.time - t0) : requestAnimationFrame(f);
        requestAnimationFrame(f);
      })),
      sleep(timeoutMs).then(() => null),
    ]);
  } catch { return null; }
}

// ---- 可观察前置：战斗阶段 + game.time 连续推进（page.waitForFunction 默认 rAF 轮询，从 intro 起生效）----
async function waitCombat(label) {
  let lastErr = '';
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.bringToFront().catch(() => {});
    await page.screenshot({ path: 'tests/evidence/r3-play-awake.png' }).catch(() => {}); // 真实截帧唤醒合成器
    try {
      await page.waitForFunction(() => {
        const g = window.__game;
        return g.state === 'playing' && g.phase === 'fight' && g.enemies.length === 4;
      }, { timeout: 12000 });
      const t0 = await page.evaluate(() => window.__game.time);
      await page.waitForFunction((a) => window.__game.time - a > 0.2, t0, { timeout: 8000 });
      return;
    } catch (e) {
      lastErr = e.message;
      console.log(`waitCombat(${label}) 尝试${attempt + 1} 未就绪，唤醒重试: ${lastErr.slice(0, 60)}`);
      await sleep(600);
    }
  }
  const s = await page.evaluate(() => {
    const g = window.__game;
    return { state: g.state, phase: g.phase, time: +g.time.toFixed(2), enemies: g.enemies.length };
  });
  throw new Error(`前置超时(${label}): ` + JSON.stringify(s) + ' ' + lastErr);
}

// 世界坐标 → 屏幕坐标（真实鼠标瞄准用；R4 画布不再全屏，用游戏自带 projectToScreen，返回页面坐标）
async function toScreen(x, z) {
  return page.evaluate(([x, z]) => {
    const p = window.__game.projectToScreen(x, 0, z);
    return { sx: p.x, sy: p.y };
  }, [x, z]);
}

async function snap(name) { try { await page.screenshot({ path: `tests/evidence/${name}` }); } catch {} }

const results = [];
await page.goto((process.env.BASE_URL || 'http://127.0.0.1:5179/'));
await sleep(800);
for (let s = 1; s <= SESSIONS; s++) {
  if (s > 1) {
    // 真实 UI 重开：over 状态下按 R
    await page.keyboard.press('KeyR');
    await waitCombat();
  } else {
    // 真实手势开始（pointerdown 触发 audio unlock）
    await page.click('#btnStart');
    await waitCombat();
    await snap('r3-play-s1-start.png');
  }
  // 真实按住 Space（持续射击，自然玩家行为）
  await page.keyboard.down('Space');
  const keys = { W: false, A: false, S: false, D: false };
  const setKey = async (k, on) => {
    if (keys[k] === on) return;
    keys[k] = on;
    if (on) await page.keyboard.down('Key' + k); else await page.keyboard.up('Key' + k);
  };
  let stallCount = 0;
  const setKeys = async (want) => {
    for (const k of ['W', 'A', 'S', 'D']) await setKey(k, want.includes(k));
  };
  const t0 = Date.now();
  let lastPos = null, stuckT = 0, strafeDir = 1, strafeFlip = 0, shotAtBreak = false;
  while (Date.now() - t0 < BUDGET_MS) {
    const st = await page.evaluate(() => {
      const g = window.__game;
      return {
        state: g.state, phase: g.phase, time: g.time,
        px: g.player.group.position.x, pz: g.player.group.position.z,
        hp: g.player.hp, lives: g.lives,
        enemies: g.enemies.map((e) => ({ x: e.tank.group.position.x, z: e.tank.group.position.z, hp: e.tank.hp })),
        kills: g.kills, bricks: g.bricksBroken, shots: g.shotsFired,
      };
    });
    if (st.state !== 'playing') break;
    // 选最近敌人
    let tgt = null, bd = 1e9;
    for (const e of st.enemies) { const d = Math.hypot(e.x - st.px, e.z - st.pz); if (d < bd) { bd = d; tgt = e; } }
    if (tgt) {
      const scr = await toScreen(tgt.x, tgt.z);
      if (scr) await page.mouse.move(scr.sx, scr.sy, { steps: 2 });
      // 移动策略：远→逼近，近→后撤，中→横走（每 1.6s 换向）
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
    // 卡住检测（位置 2.5s 不变）→ 随机方向突围
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
    if (st.bricks > 0 && !shotAtBreak) { await snap('r3-play-break.png'); shotAtBreak = true; }
    // 以页内 rAF 帧为节拍；卡顿时截帧/置顶唤醒并计数（不改游戏时间步）
    const adv = await waitFrame(1200);
    if (adv == null) {
      stallCount++;
      await page.bringToFront().catch(() => {});
      await page.screenshot({ path: 'tests/evidence/r3-play-stall.png' }).catch(() => {});
      await sleep(300);
    }
  }
  await setKeys([]);
  await page.keyboard.up('Space');
  // over 后等 5s 确认无自动续关/补敌（可观察断言）
  let over = null;
  for (let i = 0; i < 25; i++) {
    over = await page.evaluate(() => ({ state: window.__game.state, enemies: window.__game.enemies.length, time: window.__game.time }));
    if (over.state === 'over') break;
    await sleep(200);
  }
  const tOver = Date.now() - t0;
  const t1 = await page.evaluate(() => window.__game.time);
  await sleep(5000);
  const t2 = await page.evaluate(() => ({ state: window.__game.state, enemies: window.__game.enemies.length, time: window.__game.time }));
  const noAuto = t2.state === 'over' && t2.enemies === 0;
  const fin = await page.evaluate(() => window.__game.testInfo);
  results.push({ stalls: stallCount,
    session: s,
    result: fin.kills >= fin.totalEnemies && fin.lives > 0 ? '胜利' : '战败',
    kills: fin.kills, enemiesLeft: fin.enemies, lives: fin.lives, hp: fin.playerHp,
    score: fin.score, bricksBroken: fin.bricksBroken,
    shots: fin.shotsFired, hits: fin.hitsOnEnemies, hitsOnPlayer: fin.hitsOnPlayer,
    durationS: +(tOver / 1000).toFixed(1),
    gameTimeS: +t1.toFixed(1),
    noAutoAfterOver: noAuto,
    worldAdvanced: t2.time > 0,
  });
  await snap(`r3-play-s${s}-over.png`);
  console.log(`S${s}: ${JSON.stringify(results[s - 1])}`);
}
await browser.close();
writeFileSync('tests/evidence/r3-play-sessions.json', JSON.stringify({ sessions: results, pageErrors: errors }, null, 2));
const wins = results.filter((r) => r.result === '胜利').length;
const okAll = results.length >= 3 && wins >= 1 && results.every((r) => r.noAutoAfterOver) && errors.length === 0;
console.log('stalls/session:', results.map((r) => r.stalls).join(','));
console.log(`\n会话=${results.length} 胜利=${wins} 页错误=${errors.length} → ${okAll ? 'PASS' : 'FAIL'}`);
if (errors.length) console.log('errors:', errors.slice(0, 5));
process.exit(okAll ? 0 : 1);
