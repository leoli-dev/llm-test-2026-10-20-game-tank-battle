# 开发日志（Qwen3.8-27B-MLTF-q8c 自主开发记录）

日期：2026-10-20。全程仅本模型开发，未调用其他 LLM/子 agent，未参考相邻目录代码。
下文 1–8 为 R1（波次制）记录；**R2（关卡制）见下节**。

## 时间线

1. **选型与骨架**：Vite + 原生 JS + Three.js（npm 安装）。端口 127.0.0.1:5179（vite strictPort=false，冲突自动换并在 dev.log 记录）。模块：scene/tank/audio/board/game/main + tests/。
2. **第一版实现**：场景（夜间、雾、星空、灯柱、5 类掩体 48 个）、玩家/敌人坦克、子弹/碰撞/爆炸粒子、WebAudio 合成器配乐+SFX、HUD/小地图/菜单/暂停/结算/排行榜。
3. **测试基建**：Playwright + 独立 Chromium（headless）。首跑失败 2 项 + 1 崩溃，逐个定位：
   - `playwright --user-data-dir` 参数被 Playwright 拒绝 → 去掉，用其内置临时 profile
   - Playwright 键名 `escape` 不合法 → `Escape`
   - **空格 `keyboard.press(' ')` 的 keydown/keyup 落在同一渲染帧**，`keys` 集合被清空前帧循环没读到 → 改成 down→90ms→up 持键，真实玩家行为也更接近
   - favicon 404 噪音 → 内联 SVG favicon
4. **击杀 0 命中（两轮排查）**：
   - 第一轮怀疑弹道被障碍挡：扫描只查了敌人落点，没查 8m 弹道 → 测试改为整条线段采样
   - 仍 0 命中 → 写 `tests/debug-aim.mjs` 现场打印相机/炮塔/子弹。发现：**未转向时正常，转向后弹道偏一个车体角**。
   - **根因（关键 bug）**：`turretForward()` 只用炮塔**局部** yaw，没加车体 yaw；玩家/敌人把世界角直接写进局部旋转变量。车体转 76° → 弹道偏 76°。修复：新增 `worldTurretYaw()/setWorldTurretYaw()`，弹道与瞄准全部走世界角。
   - 另发现测试侧问题：第三人称相机 lerp 滞后，投影坐标基于旧相机 → 瞄准前等相机稳定
5. **波次/结算 setTimeout 生命周期 bug（监督协助复现）**：清波后暂停 3s 再继续 → 回调因 `state!=='playing'` 被吞，卡死在 wave=1/enemies=0/toSpawn=0；清波期重开 → 旧回调把新局跳到 wave 2。修复：波次推进、胜利延迟、结算面板延迟全部改为**主循环内状态计时器**（暂停天然冻结、重开 `_resetRun` 复位），补 `tests/wave-edge.mjs` 三场景回归（清波期暂停/重开、死亡面板延迟内 R 重开）。
6. **胜利标题 ID 冲突**：暂停面板与结算面板共用 `#over-title`，`_gameOver(true)` 写到了暂停面板上，胜利仍显示红色"阵亡"。修复：暂停面板改 `#pause-title`，补 `tests/victory-title.mjs` + victory.mjs 断言。
7. **完整胜利验证**：`stageWaveForTest(zeroSpawn=false)` 保留整波刷兵，真实射击全清 5 波 40 敌（7000 分）→ 胜利结算 → 排行榜录入。
8. **真实 AI 验证**：不冻结、不干预，站桩 60s 内敌人命中玩家（hp 100→90.99，伤害落在难度区间），确认 AI 自主移动/预瞄/开火链路真实工作。

## 失败 → 修复速查

| # | 症状 | 根因 | 修复 |
|---|---|---|---|
| 1 | 空格射击不触发 | press 同帧 down/up，状态来不及被帧循环读取 | 持键 90ms |
| 2 | 转向后弹道偏转 76° | 炮塔局部角当世界角（弹道/瞄准两处） | worldTurretYaw 统一世界角 |
| 3 | 瞄准打不中近处敌人 | 相机 lerp 滞后 + 弹道被障碍挡（测试侧） | 稳定等待 + 弹道线段采样 |
| 4 | 清波期暂停→卡死 | setTimeout 回调被 `state` 守卫吞掉 | 循环内计时器 |
| 5 | 清波期重开→跳波 | 旧 setTimeout 污染新局 | 同上（重开复位） |
| 6 | 胜利显示"阵亡" | 两面板 `#over-title` ID 冲突 | 拆分 ID |
| 7 | `--user-data-dir` 启动报错 | Playwright 不允许该 arg | 用内置临时 profile |
| 8 | e2e 受伤断言偶发 FAIL（hp 小数、hits=2） | **真实敌人弹道**先于钩子命中玩家，断言写死"恰好 1 次/整数" | 断言改基线差值+取整比较（游戏无 bug，反向证明真实弹道伤害生效） |

## R2 关卡制重构（2026-10-20，监督反馈驱动）

### 重构动机（R1 实机反馈）
R1 试玩 22.5s 即死：敌人 0.4–2s 间隔乱刷、无掩体结构、纯彩箱画面。R2 按 `REWORK-PLAN.md` 重做为经典坦克大战「保卫基地」：13×13 瓦片网格（4m/格）、砖墙 2HP 可破坏/钢墙/基地 6HP、3 关递进（8/12/16 敌）、三条命、正俯斜视角固定全场相机、白天光照+程序化贴图。

### R2 时间线
1. **新模块**：`src/level.js`（地图/A* 寻路/LOS/校验）、`src/textures.js`（全程序化贴图）；重写 `game.js`（关卡状态机、渐进刷兵、瓦片破坏、敌人 AI）、`tank.js`（贴图+炮塔世界角）、`scene.js`（白天光照+2048 阴影）。
2. **R2-02/03 监督复现修复**：
   - **炮管方向**：炮管/炮口原在局部 +Z，与 `turretForward()`（-Z 约定）相反，dot=-1；移到 -Z 侧后 dot=1.0（r2-diag 固化）。
   - **重复碰撞结算**（6 发子弹 bricksBroken=114、hp=-60）：根因是 `tileMeshes` 用 `push` 压缩索引，而 `damageTile` 用稠密 `i=z*GRID+x`，两者错位 → 每次命中都打到错误网格上反复结算。改 `tileMeshes` 为稠密数组（`[i]=mesh`，空格为 null），计数/负 HP 归零。
   - **敌人 `_updateEnemy` 崩溃**：误用 `t.userData`（Tank 非 Object3D）→ 改用敌人条目 `prevX/prevZ`。
   - **`overheatT/fireCd` 未初始化** → 玩家无法开火；`_respawnPlayer` 显式置 0。
3. **R2-04 画面可读性**：`.hidden` CSS 缺失导致横幅不消失（补全局 `.hidden{display:none!important}`）；玩家跟随相机留大片空白 → 改**固定全场俯视** `(26,58,64)` 看向 `(26,0,25)`，52m 战场始终完整可读（r2-shot-A/B 截图人工确认）。
4. **R2-06/08/09 基地威胁三连修（关键）**：
   - 敌人目标 `new Vector3(...tileWorld(...),0)`：`tileWorld` 返回 `[x,z]`，spread 后瓦片 z 进了 Vector3 的 **y**，z=0 → 敌人全朝地图顶部走。改拆包构造 `(bx,0,bz)`。
   - `findPath` 目标为不可穿格（基地 H/钢 S）时永远返回 null → 敌人原地不动；改为自动选用最近可达邻格作路径终点（启发式同步用新目标）。
   - `hasLOS` 注释说忽略起终点格但实现未跳过：采样点离目标 0.5m 仍落在基地自身格 → 贴墙敌人 `los` 恒 false 永不开火；实现改为跳过起点/终点自身格。
   - 验证（r2-base，复现监督者场景）：玩家真按 A 撤到 (1.15,50) 静置，两敌寻路至基地，基地 6→5→3→2→0，34s「基地被毁」任务失败；玩家 hp 全程 100（伤害确实打基地）。
5. **R2-07 重装队列承诺**：原 shuffle 后“前 4 换出 heavy”实际是 heavy↔heavy 互换（监督者实测 85/100 违例）；改为与第一个非重装互换，200 采样 0 违例。
6. **自然试玩三阶段**（详见 `PLAYTEST-R2.md`）：A（修复前）s1–s5 全败于坦克损毁、基地恒 6（威胁不存在的证据）；B（最终 AI + 贪推进 bot）n1–n3 全败于基地被毁（25–98s）；C（守家 bot）p1–p3 全败于基地被毁、其中两局自然打到 L3（130s+、25 击杀）。全程 0 浏览器异常。**三关全胜未实证。**
7. **测试重组**：R1 波次制套件（e2e/ai/wave-edge/victory/victory-title/debug-aim）移入 `tests/legacy-r1/` 存档（系统已移除，不适配）；R2 套件：r2-diag/r2-wall/r2-base/r2-idle/r2-play/r2-capture。

### R2 失败 → 修复速查（补充）

| # | 症状 | 根因 | 修复 |
|---|---|---|---|
| R2-1 | 炮口与炮塔朝向相反（dot=-1） | 炮管/炮口建在局部 +Z，约定 forward 是 -Z | 移到 -Z 侧，半径顺序同步换 |
| R2-2 | 6 发子弹 bricksBroken=114、hp=-60 | `tileMeshes` push 压缩索引 vs `damageTile` 稠密索引错位 → 反复结算错误网格 | 稠密数组 `[i]=mesh` |
| R2-3 | 敌人更新 TypeError | `t.userData` 不存在（Tank 非 Object3D） | 条目 `prevX/prevZ` |
| R2-4 | 玩家无法开火 | `overheatT/fireCd` undefined（`undefined>0`=false 但后续运算 NaN） | 生成/复活显式置 0，读取处兜底 `\|\| 0` |
| R2-5 | 敌人朝地图顶部走 | `Vector3(...tileWorld(...),0)` y/z 互换 | 拆包 `(bx,0,bz)` |
| R2-6 | 敌人对基地原地不动 | A* 目标格不可穿 → null | 最近可达邻格代目标 |
| R2-7 | 贴墙敌人不对基地开火 | `hasLOS` 把目标自身格当遮挡 | 跳过起终点自身格 |
| R2-8 | 前 4 辆含重装（85/100） | heavy↔heavy 互换无效 | 与第一个非重装互换（200 采样验证） |
| R2-9 | 横幅不消失 | CSS 只定义了 `.screen.hidden`，`#banner` 无规则 | 全局 `.hidden{display:none!important}` |
| R2-10 | 画面大片空白 | 跟随相机 | 固定全场俯视相机 |

## 环境记录

- 服务：`npm run dev`，127.0.0.1:5179（无冲突，未换端口）
- 浏览器：`/Applications/Chromium.app/Contents/MacOS/Chromium`（独立 Chromium，headless，非用户 Chrome；无 autoplay 豁免参数，音频由真实点击解锁，测试断言 `AudioContext.state==='running'` 与配乐循环存活）
- 证据：`tests/evidence/`（R1：01..11*.png；R2：r2-*.png 菜单/开场/战斗/墙前后/静置/基地威胁/自然局终局）
- 记录：R2 自然试玩与机制验证全量数据见 `PLAYTEST-R2.md`（含全部失败局）

## R3（固定歼灭战）时间线

1. **玩法转向（REWORK-R3.md）**：移除 LEVELS/levelIdx/baseHp/baseCell/_spawnQueue/_updateSpawning/_buildLevel/_flashBase/dealBaseDamage；新增 `_buildBattle()`、固定 4 敌（四角同时、2s 闪白、无补充）、2 命、追击 AI（LOS<22m 接敌/<11m 横走/无 LOS A* 寻路/14m 开砖）、全灭 +500 → 任务完成。排行榜换独立键 `steel-horizon.leaderboard.r3`。
2. **地图三次迭代**：
   - v1 四镜像 C 墙 + 中央贯通直道 → 监督否决（四敌汇入同一走廊）。
   - v2「风车四门」（180° 对称 + 中央双钢柱）→ 结构校验全过但仍被否决（孤立长墙 + 散钢块，非巷道路网）。
   - **v3 生成器**（`tests/dev-r3-maze.mjs`，固定种子 31337）：7×7 节点递归回溯 + 全开外圈回廊 + 14 条内墙打通（回路）+ 2 个 2×2 口袋 + 贯通行打断 + 4 格钢墙（替换时验证砖可穿连通）。生成器首跑 22 个连通分量的根因：**回溯只挖开节点间墙格、目标节点本身未置空**——修复后多种子跑 `r3-maze-check.mjs`，选 31337（23/23 PASS），固化为 `src/level.js` 的 `R3_MAP`。
3. **点射冷却 bug（真实缺陷）**：`fireCd` 扣减在 `(mouse.down||Space) && ... && (fireCd -= dt) <= 0` 短路链内 → 松开后冷却不恢复，70ms 短按无响应。改为每帧无条件扣减（暂停天然冻结）。独立复测 3 短按 shots 1→2→3 通过。
4. **测试基建教训**（未因此改任何游戏逻辑/时间步）：
   - 转角计数初版取"当前→前一格 vs 当前→后一格"，直路误计为转角 → 改一致前进方向，直线 0/两折 2/四折 4 样例核验。
   - 固定 Node sleep 假定"2s 后必在战斗"在 headless 帧停顿下反复误判 → 全部改 `page.waitForFunction`（rAF 轮询可观察状态）+ 停顿截帧/置顶唤醒重试。
   - `| tail` 管道掩码了测试退出码（FAIL 却 EXIT=0）→ 日志落盘后直接取 `npm run test:all` 自身退出码。
   - 冒烟 W+A 斜向 3s 仅移 0.85m：根因未完全定位（当时误断言正西 (5,6) 为砖，实际该格为空、(4,6) 才是砖）；改正北单轴 W（(6,5) 为空）并等实际跨格后查 goal。
   - r3-play `setKey` 两个 bug：`keyboard[k?'down':'up']`（k 恒真 → 永不松键）+ 缺 `Key` 前缀 → `keyboard[on?'down':'up']('Key'+k)`。
5. **自然试玩**：`r3-play.mjs` 3 局真实键鼠全胜利（7.6–7.7s、20–21 炮、8 命中、中弹 1–2、破砖 5–6、0 停顿 0 错误）；独立复核：旧图一局 10.8s/25 炮自然胜利 + 最终迷宫一局 11.41s/27 炮/90HP 与点射修复后一局 11.26s/27 炮/100HP 自然胜利 + 一局无射击观察战败 + 墙体四段链路验证 + UI 存榜 reload 保留（详见 PLAYTEST-R3.md）。
6. **归档**：R2 套件 → `tests/legacy-r2/`（勿运行）；`test:all` 换为 r3 五脚本链。

### R3 失败 → 修复速查

| # | 症状 | 根因 | 修复 |
|---|---|---|---|
| R3-1 | 70ms 短按 Space 无响应（shots 恒 1） | fireCd 扣减在开火条件短路链内，松键后不恢复 | 冷却每帧无条件扣减（暂停不执行即冻结） |
| R3-2 | 生成迷宫 22 个连通分量 | 回溯只挖节点间墙格，目标节点本身未置空 | 访问节点时 `map[NODES[az]][NODES[ax]]='.'` |
| R3-3 | 初版地图两次被否决 | 手摆孤立墙段，无连续巷道路网 | 固定种子回溯生成 + 打通回路 + 结构自检 23 项 |
| R3-4 | 转角计数虚高（直路也计转角） | 前后向量方向不一致（一进一出） | 统一前进方向比较 + 小样例核验 |
| R3-5 | 脚本误判"世界没推进" | 固定 sleep 前置 + headless 偶发 rAF 停顿 | waitForFunction 等可观察状态 + 截帧唤醒重试（未改游戏时间步） |
| R3-6 | test:all FAIL 但 EXIT=0 | `2>&1 \| tail` 掩码退出码 | 日志落盘 + 取命令自身退出码 |
| R3-7 | 移动键永不松开 / WASD 无效 | `keyboard[k?'down':'up']`（k 恒真）+ 缺 `Key` 前缀 | `keyboard[on?'down':'up']('Key'+k)` |

---

## R4：HUD 独立栏 + 画布自适应（同日，UI/渲染层，玩法/迷宫零改动）

- **动机**：旧布局把 HUD 绝对定位浮在画布四角（顶中横幅、底左 HUD、底右小地图），窄窗口下信息丢失且小地图压住右下战场。
- **改动**：`index.html` 三段 flex 列（`#topbar` / `#stage` 只含画布 / `#botbar`），HUD 全部进栏；横幅改顶栏中间 `#banner-zone`（内容自适应盒体，窄屏换整行）；窄屏只隐藏阶段名、保留「敌军 N/4｜击毁 n」，敌军条旁加 `N/4` 数字；小地图默认收起、展开占底栏（画布外）。`game.js`：`_syncCanvas()`（renderer 尺寸 + aspect 取 `#stage` 实际像素）、`_frameCamera()`（包围球 R=38.3m，距离取该 aspect 下更紧的垂直/水平 FOV——任何宽高比四角完整入画）、`_updateAim()` NDC 与 `projectToScreen()` 均改按 `canvas.getBoundingClientRect()`（后者返回页面坐标，与 clientX/Y 同系）；window resize + ResizeObserver 双触发重排。`main.js` 画布父节点 `#app`→`#stage`。
- **测试**：新增 `tests/r4-layout.mjs`（4 档分辨率 + 游戏中 resize + 小地图开合，46 断言）与 `tests/r4-play.mjs`（宽屏完整自然局 / 窄屏真实交火穿角 / 768 按钮流）；`test:all` 换入两脚本。`npm run build` ✓；`test:all` 90 条 PASS、退出码 0。宽屏自然局 9.5s 全灭（20 炮 8 命中），窄屏 27 炮 8 命中——新投影链路下真实鼠标瞄准成立。
- **两次失败与定位**：① r4-layout 横幅断言假阳性——`inter()` 判据期望 `{l,r,t,b}` 却收到原生 DOMRect（`right/bottom` 字段）→ `a.r` 恒 undefined 恒判相交；独立 debug（转字段后）确认四档尺寸横幅实际不相交；修判据后通过，产品 CSS 未因假阳性误改。② r3-smoke 时间推进检查 10s 超时（既有间歇帧停顿，单跑两连过）——给时间/跨格检查加截帧唤醒重试，整链一次通过。
- **文档**：PLAYTEST-R4.md（四档分辨率表、试玩会话、失败定位、宽屏留白局限）；README 功能清单/测试/已知问题更新。
