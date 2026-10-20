// 波次/结算延时的暂停与重开边界测试
// 场景A: 清波等待期 暂停3s 再继续 → 不应卡死（wave 能推进到 2）
// 场景B: 清波等待期 暂停→点重新开始 → 新局应保持 wave 1（旧任务不得污染）
// 场景C: 死亡结算面板出现前按 R 重开 → 不应弹出旧结算面板
import { chromium } from 'playwright';
const EXE = process.env.CHROME || process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const info = () => page.evaluate(() => window.__game.testInfo);
const fireKey = async () => { await page.keyboard.down(' '); await page.waitForTimeout(90); await page.keyboard.up(' '); };

async function killCurrentWave() {
  for (let guard = 0; guard < 60; guard++) {
    const cur = await info();
    if (cur.state !== 'playing') return;
    if (cur.enemies === 0 && cur.toSpawn === 0) return; // 清波等待期
    if (cur.enemies === 0) { await page.waitForTimeout(600); continue; }
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__game.stageWaveForTest());
    await page.waitForTimeout(250);
    for (let g2 = 0; g2 < 40; g2++) {
      const c = await info();
      if (c.state !== 'playing' || c.enemies === 0) return;
      if (c.overheated) { await page.waitForTimeout(2600); continue; }
      const sp = await page.evaluate(() => {
        const g = window.__game;
        const e = g.enemies[0].tank.position;
        return g.projectToScreen(e.x, 1.2, e.z);
      });
      if (sp.x < 60 || sp.x > 1220 || sp.y < 60 || sp.y > 740) {
        await page.waitForTimeout(600);
        await page.evaluate(() => window.__game.stageWaveForTest());
        continue;
      }
      await page.mouse.move(sp.x, sp.y);
      await page.waitForTimeout(140);
      for (let s = 0; s < 4; s++) { await fireKey(); await page.waitForTimeout(520); }
      const after = await info();
      if (after.hitsOnEnemies === c.hitsOnEnemies) await page.evaluate(() => window.__game.stageWaveForTest());
    }
  }
}

const report = [];
const ok = (n, c, x = '') => { report.push([n, c]); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  [' + x + ']' : ''}`); };

await page.goto((process.env.BASE_URL || 'http://127.0.0.1:5179/'), { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game);
await page.evaluate(() => { window.__game.freezeEnemies = true; });
await page.click('#btnStart');
await page.waitForFunction(() => window.__game.testInfo.state === 'playing');

// ---------- 场景 A ----------
await killCurrentWave();
let t = await info();
ok('A0: 进入清波等待期（enemies=0, toSpawn=0, wave=1）', t.enemies === 0 && t.toSpawn === 0 && t.wave === 1, JSON.stringify(t));
await page.keyboard.press('p');
await page.waitForFunction(() => window.__game.testInfo.state === 'paused');
await page.waitForTimeout(3000); // 跨越原本 2.6s 的推进窗口
await page.keyboard.press('p');
await page.waitForFunction(() => window.__game.testInfo.state === 'playing');
await page.waitForTimeout(4000); // 应触发 wave 2
t = await info();
ok('A: 清波期暂停3s再继续 → 正常推进到 wave 2', t.state === 'playing' && t.wave === 2, `wave=${t.wave} enemies=${t.enemies}`);

// ---------- 场景 B ----------
// 清掉 wave 2 再在等待期重开
await killCurrentWave();
t = await info();
ok('B0: wave 2 清波等待期', t.enemies === 0 && t.toSpawn === 0 && t.wave === 2, JSON.stringify(t));
await page.keyboard.press('p');
await page.waitForFunction(() => window.__game.testInfo.state === 'paused');
await page.click('#btnRestart1');
await page.waitForFunction(() => window.__game.testInfo.state === 'playing');
t = await info();
await page.waitForTimeout(3500); // 若旧回调存活，此时会跳到 wave 3
t = await info();
ok('B: 清波期重开 → 新局保持 wave 1 且不跳波', t.state === 'playing' && t.wave === 1 && t.score === 0, `wave=${t.wave} score=${t.score}`);
ok('B: 重开后面板未误显', !(await page.isVisible('#screen-over:not(.hidden)')) && !(await page.isVisible('#screen-pause:not(.hidden)')));

// ---------- 场景 C ----------
await page.evaluate(() => window.__game.dealPlayerDamage(999));
await page.waitForFunction(() => window.__game.testInfo.state === 'over', null, { timeout: 4000 });
// 在 1.3s 面板延迟内立即重开
await page.keyboard.press('r');
await page.waitForFunction(() => window.__game.testInfo.state === 'playing', null, { timeout: 4000 });
await page.waitForTimeout(2000);
t = await info();
ok('C: 死亡结算延迟内 R 重开 → 无旧面板、新局正常', t.state === 'playing' && !(await page.isVisible('#screen-over:not(.hidden)')) && t.playerHp === 100, `hp=${t.playerHp}`);

console.log('errors:', errors.length, errors.slice(0, 3));
const failed = report.filter(([, c]) => !c);
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);
