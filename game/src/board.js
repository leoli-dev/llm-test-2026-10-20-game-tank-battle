// 本机排行榜：localStorage 持久化
// R3 新 key：不与旧多关卡分数混算
const KEY = 'steel-horizon.leaderboard.r3';
export const DIFF_NAMES = { easy: '简单', normal: '普通', hard: '困难' };

export function loadBoard() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveEntry(entry) {
  const board = loadBoard();
  const e = {
    name: String(entry.name || 'TANKER').slice(0, 10).toUpperCase() || 'TANKER',
    score: Math.max(0, Math.round(entry.score)),
    result: entry.result || '-',
    kills: entry.kills,
    diff: entry.diff,
    date: new Date().toISOString().slice(0, 10),
  };
  board.push(e);
  board.sort((a, b) => b.score - a.score);
  const top = board.slice(0, 10);
  const rank = top.findIndex((x) => x === e) + 1;
  try {
    localStorage.setItem(KEY, JSON.stringify(top));
  } catch { /* 存储不可用时静默 */ }
  return { entry: e, rank, board: top };
}

export function renderBoard(el, highlightEntry) {
  const board = loadBoard();
  if (!board.length) {
    el.innerHTML = '<h3>🏆 排行榜</h3><div class="empty">— 暂无记录，来写下第一条 —</div>';
    return;
  }
  let rows = board.map((e, i) =>
    `<tr${e === highlightEntry ? ' class="me"' : ''}>
      <td>${i + 1}</td><td>${escapeHtml(e.name)}</td><td>${e.score}</td>
      <td>${escapeHtml(e.result ?? '-')}</td><td>${e.kills}</td><td>${DIFF_NAMES[e.diff] || e.diff}</td><td>${e.date}</td>
    </tr>`).join('');
  el.innerHTML =
    `<h3>🏆 排行榜（本机 Top ${board.length}）</h3>
     <table>
       <tr><th>#</th><th>呼号</th><th>得分</th><th>结果</th><th>击毁</th><th>难度</th><th>日期</th></tr>
       ${rows}
     </table>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
