// 回归：胜利结算标题/颜色应为“任务完成”（修复 #over-title 与暂停面板 ID 冲突）
import { chromium } from 'playwright';
const EXE = process.env.CHROME || process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto((process.env.BASE_URL || 'http://127.0.0.1:5179/'), { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game);
await page.click('#btnStart');
await page.waitForFunction(() => window.__game.testInfo.state === 'playing');
// 直接进入胜利结算（只验证 UI 标题，走真实状态机）
await page.evaluate(() => window.__game._gameOver(true));
await page.waitForSelector('#screen-over:not(.hidden)', { timeout: 4000 });
const title = await page.textContent('#screen-over #over-title');
const cls = await page.getAttribute('#screen-over #over-title', 'class');
const pauseTitle = await page.textContent('#screen-pause #pause-title');
console.log(JSON.stringify({ title: title?.trim(), cls, pauseTitle: pauseTitle?.trim() }));
const okAll = title?.trim() === '任务完成' && cls === 'win' && pauseTitle?.trim() === '已暂停';
console.log(okAll ? 'PASS 胜利标题正确，暂停标题不受影响' : 'FAIL');
await page.screenshot({ path: 'tests/evidence/11-victory-title.png' });
await browser.close();
process.exit(okAll ? 0 : 1);
