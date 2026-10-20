# 在 M5 Max 上用 MLTF 驱动 8-bit Qwen3.8-27B：pi 制作 3D 坦克大战的四轮监督实测

实验日期：2026-10-20，America/Toronto（EDT）。本文面向 GitHub 分享，记录用户如何逐轮改变需求、本地模型经 pi 实际改了什么、哪些失败被保留，以及推理引擎和主机的测量数据。游戏是实验产物，仍是可玩原型。

**推理引擎：[MLTF / My Little Trie Forge](https://github.com/DT-HJ/my-little-trie-forge)。目标模型：[Ho-Jin-93/Qwen3.8-27B-MLTF-q8c](https://huggingface.co/Ho-Jin-93/Qwen3.8-27B-MLTF-q8c)，27B、8-bit q8c 量化。** 代码由本机模型通过 pi 编写；监督者组织 prompt、观察、文字提示、独立测试和撰写报告，没有修改游戏实现。四轮共 **430 个请求、461,939 输出 token、326.48 分钟 pi 工作时间（约 5.44 小时）**，共 29 次方向性提示。轮间等待不计入工作时间。

最终游戏是 13×13 砖墙迷宫中的固定四敌歼灭战：敌人追击玩家，开局四辆全部出现，无补兵/自动下一波；有两命、血量、破墙、纹理与阴影、音效配乐、本机榜、开始/暂停/继续/重开；HUD 与可折叠小地图位于画布外。最终不保留第二轮的基地防守与三关刷兵目标。

![最终宽屏界面](./evidence/r4-wide.png)

## 1. 轮次按用户要求划分，不能按测试次数拆轮

| 轮次 | 用户发起的要求 | pi 的主要变化 | 当轮结果与下一轮原因 |
|---|---|---|---|
| R1 | 从零制作浏览器 3D 坦克大战，并实际玩、记录性能 | 实现开放场景、玩家/敌人、GUI、音频、排行榜和五波循环 | 基础可玩，但缺少墙体战术、节奏和材质完成度 |
| R2 | 加真正可破坏墙体，纠正群殴与粗糙美术，让 pi 自己玩 | 瓦片墙体、程序纹理/光影、受控并发、三关和基地防守 | 墙与画面改善；基地优先与持续出兵偏离用户期望 |
| R3 | 敌人追玩家；敌人一次有限全部出现；真正迷宫 | 移除基地目标/续兵/自动关卡，固定四敌，玩家追猎 AI，巷道迷宫 | 可以自然清场；窄屏 HUD 遮挡与裁切未解决 |
| R4 | 生命栏挡出生点，小地图挡右下角 | HUD 移至画布外上下栏，小地图可收起，相机/鼠标/resize 联动 | 四种视口独立检查通过，宽窄屏真实输入清场 |

R1–R4 都继续同一 pi 会话和同一 MLTF 服务。监督者在一轮内的提示、pi 自测、失败重试、上下文压缩、回归都计入该轮，不能包装成新的用户迭代。用户的 Chromium 偏好和环境消息是约束，不单列为游戏需求轮次。

| 轮次 | 开始–pi 收尾（EDT） | pi 分钟 | 推理请求 | 输出 token（含思考） | 监督提示 |
|---|---|---|---|---|---|
| R1 | 00:38:17–01:24:15 | 45.97 | 66 | 82,551 | 3 |
| R2 | 07:27:25–09:48:06 | 140.67 | 186 | 180,564 | 12 |
| R3 | 09:58:25–11:43:41 | 105.27 | 125 | 145,772 | 12 |
| R4 | 11:50:04–12:24:38 | 34.57 | 53 | 53,052 | 2 |

以下原话保留用户表达；随后明确区分用户要求、监督者转译给 pi 的任务书和 pi 的自主设计。

## 2. R1：从空目录制作可玩的浏览器 3D 坦克大战

**用户原始要求：**

> 我要测试本机 mltf (local llm)性能
> 你去别的session找出来端口和调用方法
>
> 我让你作为监督者，通过 pi(local/Qwen3.8-27B-MLTF-q8c [mltf])，在 ~/Code/qwen3.8-tests 里面 开一个新的sub folder
> 目的是做一个可以直接在浏览器里面玩的3D坦克大战
>
> 有 GUI、有敌人、有血量、有环境场景、有音效、有配乐、有排行榜，能开始、暂停、继续、重新来过
>
> pi可以用浏览器用视觉检查、自己玩自己测评
>
> 你负责init prompt开始工程
>
> 然后你要持续监控，如果发现效果偏离太远，或者pi在死循环很久，你就出手帮忙提示，不能上手改，只能告诉他一点建议
>
> 你要记录他的过程，出错的情况，还有本机的CPU GPU 内存占用变化，还有推理引擎 token生成速度 prefill 速度
>
> 最后给我一个详细report
>
> 审视这个model和推理引擎的能力和稳定性

**转译给 pi 的验收：** 从零实现真实 3D、完整游戏循环和默认浏览器音频解锁；必须在 Chromium 实际按键、瞄准射击、读截图、检查页面异常、保存/刷新成绩，不能只跑 build；仅 pi 修改 game/，不得使用其他编码模型或子 agent。[R1 任务书](./prompts/r1-initial-prompt.md)。API 端口最初从历史会话《更新 mlx-dspark 和相关模型库》定位，再由本机配置、监听进程和认证状态交叉验证。

**pi 实现：** 选择 Three.js + Vite + 原生 JavaScript，拆分场景、坦克、程序音频、榜单与游戏循环；搭建低多边形夜战开放场地、地面/树木/箱体/掩体、玩家移动和鼠标炮塔、敌军、五波推进、HUD/小地图、血量反馈、死亡与胜利结算、localStorage 榜。第一轮的五波是 pi 自主设计，不是用户明确规定。

**关键问题与改进：** 首次缺 npm dev 脚本，pi 自修；炮塔局部角度/世界方向混用，转向约 76° 后炮口与弹道偏离约 76°，在监督提示后统一方向；清波异步回调在暂停中吞掉推进，并可能污染重开后的新局，pi 改为游戏循环内计时；截图自检发现暂停与结束标题重复 DOM ID，pi 自主修复。另修复浏览器输入/API 细节、胜利脚本只杀 5 敌却误称完成五波的问题。三次监督提示分别针对默认 Chromium/音频验收、炮口方向、清波状态生命周期。[R1 提示](./evidence/r1-interventions.json)。

**实际验证：** pi 主 E2E 最终 28 项通过，但存在无条件 true、零移动仍 PASS 和 shell 管道掩盖失败的问题，不能将数量视为覆盖率。监督者真实输入打出 4 发、3 命中、1 击杀后被自然击毁，保存分数并刷新持久化成功；默认音频策略下 AudioContext running，测得非零音频信号。五波 40 击杀/7,000 分的胜利包含冻结/摆位夹具，不是默认难度自然全通。已有基础循环，仍未证明墙体战术、关卡路线和人类可玩难度。

![R1：开放场景与早期 HUD](./evidence/r1-battle.png)

**当轮判断：** 有限监督完成可玩原型。其简易几何、散放装饰和开局敌群并未满足用户对坦克大战的体验期待，直接引出 R2；不能因基础测试通过宣称成品。

## 3. R2：墙体战术、节奏、贴图与光影

**用户反馈原文：**

> 地图没有障碍物，坦克大战是有墙体，要打掉墙体才能攻击对方，而且这个游戏只有一个玩家对全场敌人，一进去就是敌人群殴玩家，设计有问题，多思考一下玩法进行改进
>
> 让pi自己去玩
>
> 还有，游戏缺乏贴图，只有简单3D模块，没有贴图没有光阴，只有简易模具，不算一个完全游戏
>
> 你组织prompt，然后让pi继续，你继续观察，搜集数据，总结并更新报告

用户原文“光阴”在任务书中按上下文转译为“光影”。监督者要求 pi 先玩旧版，再做真实挡车/挡弹/可破坏砖墙、可解路线、安全开局、敌人节奏、实际纹理与照明，并至少自然完成入门段；允许状态辅助瞄准，不得冻结/改血量冒充自然胜利。[R2 任务书](./prompts/r2-initial-prompt.md)。

**pi 的玩法改造：** 13×13 瓦片地图，砖墙 2HP、两发破坏，钢墙不可破坏；加入三关，每关 8/12/16 敌，并发限制 2/3/3，入口受控、出生提示和保护；三条命、基地 6HP，保护基地并清敌推进。三关和基地防守由 pi 自主选定，是对公平节奏的实现尝试，用户并未明确要求保卫基地。

**pi 的画面改造：** 使用实际 CanvasTexture；地面、砖、钢/金属、装甲迷彩与履带纹理，配合损伤裂纹、碎片、凹凸、太阳主光/补光和投影；保留并调整 WebAudio 音效配乐与全图相机。独立遍历曾确认 8 个不同纹理 map、34 个投影对象和主光阴影开启；它们只证明机制启用，不能单凭数量证明美术质量。

**实质故障与修复：** tileMeshes 未初始化导致运行崩溃；旧菜单覆盖战斗；渲染墙体数组是压缩存储，伤害逻辑却按密集网格索引，导致真实 6 发出现毁墙 114、墙 HP=-60 和 126 次异常，修复后同样 6 发正常移除两块沿线砖；炮口/弹道又反向，点积由 -1 修至 +1；重装排序错误、基地二维目标坐标错误把敌人引向地图顶部、LOS 把实体目标自身挡住，均经历监督观察后修正。旧测试未迁移造成 300 秒无效等待，精确替换、端口、截断日志和 shell 返回码处理也反复出错。共 12 次监督提示。[R2 提示](./evidence/r2-interventions.json)。

**pi 自己玩出的结果：** 保留了 s1–s5、n1–n3、p1–p3 等多个中间版本与策略，不能混成一个固定版本的胜率。最终同一基地 AI 下，追敌组 n1–n3 全败，守家组 p1–p3 也全败，三关全胜 **0/6**；守家组入门关 **3/3** 清完，两局到第三关后基地被毁。另有中间版 s4 达 240 秒时限仍未结束，属于 AI 失效版本，不能当“存活久、平衡好”。pi 曾把到第三关后失败称为“三关通关”，经监督纠正。

**独立证据：** 完整墙挡车，一发 HP1、两发移除，再可通行；墙后目标夹具中前两发只破墙、第三发才伤敌。最终 AI 真实输入约 38.956 秒清入门关，8 杀、44 发、16 次敌命中、玩家未中弹并进入第二关；另一次真实远离基地静置，基地 6→0，玩家仍 100HP，证明基地威胁实际存在。夹具只验物理/状态分支，不算自然通关。

![R2：砖墙、材质与基地防守版](./evidence/r2-battle.png)

**当轮判断：** 墙体和视觉有实质改进，但“持续分批来敌 + 基地优先”把体验变成守点，普通有限歼灭的需求没有被理解。R2 是返工后仍存在产品方向偏差的一轮；模型自评中的胜负与版本归因也需审查，不能用零页面错误掩盖不好玩。

## 4. R3：有限敌群、真正追玩家与巷道迷宫

**用户反馈原文：**

> 敌人AI 只会攻击基地，不会攻击玩家，而且敌人应该一次过出来有限个数，不应该一波一波一直来，这怎么可能打得过，不好玩
>
> 敌人不会追击玩家，只会指责玩家基地攻击，一点都不好玩，砖块没有生成迷宫样式，太简单了
>
> 继续让pi改进

监督者明确撤销旧基地/三关方向，要求一局少量敌人同时全部出现、无后续补充、清光即胜利；敌人追玩家换位与转角，打砖或绕路；墙体组成巷道、转角、环路和岔路；真实输入自然赢一局，验证存活+击杀恒等于初始数量，并保留失败。[R3 任务书](./prompts/r3-initial-prompt.md)。

**pi 的规则与 AI 改进：** 固定四辆 basic 敌车，分置四角入口，一次全部进场；无待刷队列、下一波或自动下一关；移除基地目标和基地失败条件，HUD 显示 N/4；玩家两命、每命 100HP。敌人获取玩家位置并随玩家换格重寻路，有射线时瞄准射击，近距离横移，墙挡路则绕行或破砖。R3 基础敌人参数为 HP24、伤害10、速度4.6m/s、射击间隔1.8s；玩家速度7m/s。这些参数有可赢性证据，但尚未为人类精调。

**pi 的地图改进与返工：** 最初 C 形墙图、之后四道孤立长墙仍不是用户期待的迷宫，监督者两次按全图退回。pi 随后编写生成器并固化巷道地图：13×13 格、49 砖 + 4 钢，真实开放子图存在 20 个环，四入口初始路线长度至少12格且有多次转角；4m 通道适配约2.3m碰撞直径。转角判据曾把直线也算拐弯；生成器忘挖目标节点却先误改外圈，均需监督提示。另修复点射冷却仅在按住时减少的问题，短按三次由只开一炮变为三炮。

**测试与监督成本：** 共 12 次提示，包括需求偏差、地图生成、点射、前置等待、松键仍发 keydown、把 enemies 数组与数字4比较的永假等待、文档混入旧结果。多次等待超时不能自动归因 GPU 或 MLTF。最终 build/test:all 返回0，旧套件36条PASS及自然局通过，但此前失败和返回码掩盖仍保留。[R3 提示](./evidence/r3-interventions.json)。

**自然试玩：** pi 首组三局全胜，含两次后续回归共9局均清四敌，游戏总时长约9.4–9.5s，剩余80–90HP；它们沿用同一地图和状态辅助瞄准策略，不是9个人类独立样本。监督者最终迷宫独立两局约11.41s/11.26s获胜，剩90/100HP；另一次真实移动但不射击，敌人造成20次命中并耗尽两命，证明追击与伤害实际生效。记录敌人对象 ID，后续 ID 均是初始集合子集，存活+击杀=4，结算后等待仍无续兵；UI存分刷新保留。墙、暂停/继续、重开与音频通路另以标注夹具检查。

![R3：固定四敌、迷宫与自然胜利](./evidence/r3-victory.png)

**当轮判断：** 三项要求均有实证，但状态辅助瞄准下极短且全胜，只证明可完成，不能证明成熟的战术深度与难度曲线。窄屏全图/HUD 没有充分验证，最终被 R4 的实际截图揭出。

## 5. R4：生命栏和小地图遮挡战场

**用户反馈原文：**

> UI 完全阻挡视线，生命挡住了敌人重生点，地图挡住了右下角

用户附截图。虽然图中还有旧版基地/三关，监督者对当前 R3 服务独立复现了同类问题：900×1000 活动期生命栏与战场相交约8,013px²、小地图约18,176px²；下方出生坦克部分出画。768×1024四个出生模型都有部分裁切。宽屏基线无同样活动期覆盖，说明旧验收遗漏响应式边界。

**pi 改进：** 顶栏放分数、敌军数字、按钮和短开局提示；底栏放装甲/炮温/生命/敌军条及小地图；中间 stage 仅放渲染画布。小地图默认关闭，展开仍在底栏。相机 aspect、renderer 尺寸、地面鼠标求交、projectToScreen 均以真实 canvas 矩形计算；window resize 与 ResizeObserver 联动，解决底栏开合并不触发窗口 resize 的情况。窄屏只省略阶段名，不再丢掉剩余敌数/击毁数字。[R4 任务书](./prompts/r4-initial-prompt.md)。

**两次监督提示及错误：** 第一次指出900宽开局横幅仍与按钮相交约560px²，且整段隐藏敌军数字；pi 修正栏内布局。其自写 inter() 期望 l/t/r/b 却收到原生 DOMRect（left/top/right/bottom），导致两轮假阳性；模型据此继续改CSS、写调试脚本，/tmp脚本又无法解析Playwright。第二次提示核对数据字段后修正断言。合并回归首次旧smoke时间推进超时，两次单跑通过，加入有限截帧/置顶重试后整链返回0；根因未定，不能称GPU故障。README精确文本编辑还失败一次，回读后恢复。[R4 提示](./evidence/r4-interventions.json)、[测试各次输出](./evidence/r4-pi-test-results.json)。

**最终验证：** pi布局46项、试玩8项通过；最终合并90行PASS、退出0，前次失败日志保留。pi自己用1280×800真实输入自然清场（20炮/8命中、90HP、两命、925分、约9.5s），900×1000真实战斗27炮/8命中、12s清场，768宽实点暂停/继续并读截图。监督者独立1440×900/900×1000分别约11.63/11.60s清场，剩70/90HP；竖屏存榜刷新仍在，清场后5秒无新波。

| 视口 | 最终地图关闭画布（CSS像素） | 出生坦克模型完整入画 | HUD与战场相交 |
|---|---|---|---|
| 1440×900 | 1440×788，y52 | 4/4 | 0 |
| 1280×800 | 1280×688，y52 | 4/4 | 0 |
| 900×1000 | 900×888，y52 | 4/4 | 0 |
| 768×1024 | 768×895，y69 | 4/4 | 0 |

每档检查开局、活动期、地图展开，无HUD组间交叠、无水平溢出、无页面异常；独立投影真实mesh顶点包围范围，不只检查中心点。另有23项缩放/真实鼠标夹具：切换六种窗口/地图状态、renderer/aspect、四个地面点鼠标求交、实际移动、暂停冻结、继续、重开均通过；该组冻结AI，仅隔离UI/投影，不冒充自然胜利。[布局原始测量](./evidence/r4-layout.json)、[缩放夹具](./evidence/r4-resize.json)、[独立宽屏局](./evidence/r4-natural-wide.json)、[独立竖屏局](./evidence/r4-natural-portrait.json)。

![R4：768宽，小地图展开在下栏](./evidence/r4-narrow-map.png)

**仍有自述误差：** pi记录把试玩8项写成7项；部分画布高度和768顶栏高度不符；把包围球保守取景称为“最大缩放”缺乏依据。本报告采用独立测量。相机取景保守、宽屏留白多，是后续美术/取景打磨空间。[自述核对](./evidence/r4-self-review-audit.md)。


## 6. MLTF项目、模型地址、固定版本与量化身份

### 6.1 项目地址与版本

| 项目 | 明确地址 / 身份 |
|---|---|
| MLTF当前GitHub | [https://github.com/DT-HJ/my-little-trie-forge](https://github.com/DT-HJ/my-little-trie-forge) |
| 本机原Git remote | [hojin12312/my-little-trie-forge](https://github.com/hojin12312/my-little-trie-forge)，核对时重定向到DT-HJ |
| 本机保存的源码提交 | [873d5574d903f5c1685e286c9cd59b79475a49f6](https://github.com/DT-HJ/my-little-trie-forge/tree/873d5574d903f5c1685e286c9cd59b79475a49f6)，工作树无修改 |
| 实际服务版本 | MLTF0.1.2；本机wheel安装的Python入口+原生Metal引擎 |
| 运行内核build ID | `src-ddca31101abcdea9199c6c79a27b2d329509c06b66d69af627725212bf53a4c6`；这是服务状态值，不能用Git提交号替代 |
| 代码许可证/来源 | Apache-2.0；派生自[Splash](https://github.com/incoai/splash)，继承机制和独立扩展见UPSTREAM |
| 项目支持范围 | 上游验证M5 Max40GPU/128GiB；安装文档要求必要GPU特性和macOS26.4+；其他机器不据此保证同速 |

以上链接于报告整理时在线核对；实际实验身份取本机包、manifest与当轮/status快照。公开仓库最新README会变化，复现技术细节优先固定提交。[固定README](https://github.com/DT-HJ/my-little-trie-forge/blob/873d5574d903f5c1685e286c9cd59b79475a49f6/README.md)、[UPSTREAM](https://github.com/DT-HJ/my-little-trie-forge/blob/873d5574d903f5c1685e286c9cd59b79475a49f6/UPSTREAM.md)、[安装](https://github.com/DT-HJ/my-little-trie-forge/blob/873d5574d903f5c1685e286c9cd59b79475a49f6/docs/INSTALL.md)、[验证范围](https://github.com/DT-HJ/my-little-trie-forge/blob/873d5574d903f5c1685e286c9cd59b79475a49f6/docs/VALIDATION.md)。

### 6.2 模型及所有资产来源

**这里测试的是 Qwen3.8-27B 的 8-bit 目标权重，经MLTF prepared q8c打包后运行；不是4-bit目标，也不是27B全精度权重常驻。** 模型的27B参数名、权重位宽、prefill激活位宽、decode激活位宽、KV缓存位宽是不同概念。

| 角色 | 仓库地址 | 本机固定revision / 说明 |
|---|---|---|
| Qwen基础模型 | [Qwen/Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B) | 架构/模型身份来源 |
| 实际prepared包 | [Ho-Jin-93/Qwen3.8-27B-MLTF-q8c](https://huggingface.co/Ho-Jin-93/Qwen3.8-27B-MLTF-q8c) | `524209960111b8c6a3d79f7c68a6f04c0a6dca91`；第三方为MLTF转换的checkpoint，不是Qwen官方另发版本 |
| 8-bit目标源 | [mlx-community/Qwen3.8-27B-8bit](https://huggingface.co/mlx-community/Qwen3.8-27B-8bit/tree/815b83c0df8ffd1d1b5244cf75fd6ef14fca9ef9) | `815b83c0df8ffd1d1b5244cf75fd6ef14fca9ef9` |
| DFlash2草稿源 | [incoai/Qwen3.8-27B-DFlash2](https://huggingface.co/incoai/Qwen3.8-27B-DFlash2/tree/dedf8df68adfb1afeaf7b7480c0a0243108177b4) | `dedf8df68adfb1afeaf7b7480c0a0243108177b4` |
| tokenizer / vision源 | [mlx-community/Qwen3.8-27B-4bit](https://huggingface.co/mlx-community/Qwen3.8-27B-4bit/tree/3e6447f082e89cc7f0bc6e5441afd38dfce760ff) | `3e6447f082e89cc7f0bc6e5441afd38dfce760ff`；仅这两个资产角色，不是27B目标权重来源 |
| 模板/包参考 | [incoai/Qwen3.8-27B-Splash](https://huggingface.co/incoai/Qwen3.8-27B-Splash/tree/9d27070b71f7142c6b6025f03ac011d70a73cb48) | `9d27070b71f7142c6b6025f03ac011d70a73cb48` |

来源链由本机manifest的upstream字段、公开模型卡及[MLTF MODEL_ASSETS](https://github.com/DT-HJ/my-little-trie-forge/blob/873d5574d903f5c1685e286c9cd59b79475a49f6/MODEL_ASSETS.md)交叉核对。MODEL_ASSETS中关于“代码不附权重/无随代码候选发布的模型包”的措辞与现已存在的独立HF prepared仓库要分开理解：引擎代码包与单独模型仓库是两份产物；本机prepared包确实对应上表HF固定revision。模型卡和源码对各自资产许可证有说明，不能仅以引擎Apache许可证覆盖全部资产角色。

| q8c包的可核对细节 | 实际值 |
|---|---|
| manifest schema / format | 5 / `splash-packed-q8c` |
| 权重位宽 / group size | `q8_bits=8` / `q8_group_size=64` |
| 量化参数 / 存储几何 | `bf16-scale-zero` / `q8_storage_n=256` |
| 文件段对齐 | 16,384字节 |
| manifest SHA-256 | `e2c7919947a1784b18bf67323de786e500e53d1e47798aede1c38667c388760e` |
| artifact set SHA-256 | `2d5414df4eac12ad1e9dbd5ab770a650f5e418782c4a5c523e8d3ff2155f5f95` |
| 资产数 / 总文件字节 | 78 / 30,848,996,049（约28.73GiB） |
| /status target权重估算 | 28,625,977,344字节（约26.66GiB）；draft1,266,040,832，vision930,250,752字节 |

28.73GiB是目标+draft+vision+tokenizer等资产文件合计，不是运行总内存，也不能与最终约95GiB引擎分配量混为一谈。包manifest与运行时内核使用的dtype还需分别看：目标权重是8bit group64、BF16 scale/zero；KV是另一套symmetric INT8/FP32 scale设计。[公开prepared文件树](https://huggingface.co/Ho-Jin-93/Qwen3.8-27B-MLTF-q8c/tree/524209960111b8c6a3d79f7c68a6f04c0a6dca91)、[精简身份JSON](./evidence/model-engine-identity.json)。

## 7. MLTF针对M5 Max + Qwen3.8-27B的实现与本次启用范围

下面是源码/发布profile和本机状态支持的技术解释，**不是对每项优化做消融后测得的独立加速倍数**。本实验没有以其他引擎或FP16/4bit模式做公平对照。

### 7.1 专用Metal矩阵内核与q8c布局

MLTF针对该模型的QKV/MLP投影使用group64、StorageN256的packed q8c块。源码把affine UINT8码平移-128为signed INT8，并把对应偏移折入bias，匹配其signed矩阵运算路径；BF16 scale/zero可在内核重建折叠bias。MPP `mpp::tensor_ops`、cooperative tensor、`matmul2d`与明确的SIMD group/tile组织对应M5所需GPU能力，减少通用框架调度/通用布局的负担。这是从代码结构作出的用途解释，并非本实验单独测得的因果收益。[q8公共tile源码](https://github.com/DT-HJ/my-little-trie-forge/blob/873d5574d903f5c1685e286c9cd59b79475a49f6/runtime/metal/kernels/common/q8_mpp_tiles.h)、[decode q8内核](https://github.com/DT-HJ/my-little-trie-forge/blob/873d5574d903f5c1685e286c9cd59b79475a49f6/runtime/metal/kernels/decode/linear_q8.metal)。

**prefill W8A8 / decode-verify W8A16：** W8始终是8位目标权重；A8预填充按group64对激活做对称INT8量化，整数点积后再按scale/bias重组；A16解码/目标验证保留BF16激活。不能把W8A16误写为权重恢复成16bit。实现还固定FMA组合顺序以减少不同tile/槽位舍入差异；`split2-rounded`把量化group分两段算partial再规约，保留明确数值策略。[prefill内核](https://github.com/DT-HJ/my-little-trie-forge/blob/873d5574d903f5c1685e286c9cd59b79475a49f6/runtime/metal/kernels/prefill/linear_q8.metal)、[发布profile](https://github.com/DT-HJ/my-little-trie-forge/blob/873d5574d903f5c1685e286c9cd59b79475a49f6/RELEASE_PROFILE.json)。

本机/status实际为 `q8_prefill_activation=a8`、`q8_residual_decode_policy=split2-rounded`、`q8_split2_m32_sg16=true`、`paired_long_prefill=true`；stagepage、stage_parameters、direct_single_split、canonical_long_prefill、canonical_decode_burst等标志为false。源码存在的候选内核/可选优化不等于本次全部开启。发布包物理解码B1–B4、B3 padded-M32能力保留，本实验只有一个pi顺序发起请求，没有测四并发总吞吐。

### 7.2 DFlash2投机解码与模型验证

准备包记录7个proposal token、8行draft query、8行target verify、draft sliding window2048。草稿提出候选，目标模型批量验证，接受部分候选以摊薄逐token工作；收益依赖草稿接受比例、上下文和输出。四轮实际accepted/drafted比例约36.9%–38.9%，不应套用上游短上下文高接受率的headline。DFlash2基础继承并归功于Splash，上游归因不能省略。[UPSTREAM](https://github.com/DT-HJ/my-little-trie-forge/blob/873d5574d903f5c1685e286c9cd59b79475a49f6/UPSTREAM.md)、[DFlash2源模型](https://huggingface.co/incoai/Qwen3.8-27B-DFlash2)、[prepared身份](./evidence/model-engine-identity.json)。

### 7.3 INT8 KV、Page32与prefix-tree状态复用

本机KV使用`symmetric_int8`，FP32 scale，每token/head的K/V数据按不同布局存放：K token-major、V dimension-major；每块32 token。状态预算信息列出16个full-attention层、4个KV head、head dimension256，Page32字节1,064,960；这描述KV相关full-attention层，不是声称模型总共只有16层。MLTF保留Qwen混合结构相关GDN/状态恢复与prefix-tree缓存路径，复用历史前缀和状态，降低长编码会话重复prefill。32-token块粒度、sparse backing和约128MiB extent组织服务于动态分配与回收。具体计数可由当轮/status复查；稀疏虚拟容量不等于实际驻留量。[KV store内核](https://github.com/DT-HJ/my-little-trie-forge/blob/873d5574d903f5c1685e286c9cd59b79475a49f6/runtime/metal/kernels/decode/attention_q8_store.metal)、[缓存/GDN归因](https://github.com/DT-HJ/my-little-trie-forge/blob/873d5574d903f5c1685e286c9cd59b79475a49f6/UPSTREAM.md)。

本机启用暖态内存缓存和图像embedding复用，**SSD cache关闭**。项目支持可选SSD durable cache、内存准入和有界异步持久化，相关设计承认oMLX sidecar工作的影响；本次未测SSD路径，不能把内存缓存效果归为SSD。[ACKNOWLEDGEMENTS](https://github.com/DT-HJ/my-little-trie-forge/blob/873d5574d903f5c1685e286c9cd59b79475a49f6/ACKNOWLEDGEMENTS.md)。

### 7.4 统一内存与可用性治理

硬件为M5 Max18CPU/40GPU/128GiB统一内存，服务报告Apple GPU family10、32KiB threadgroup memory及统一内存/sparse placement支持。配置预算96GiB，实际governor约95.25GiB，按主机可用量和预留控制准入/增长/缓存回收。四轮部分存在warning、内部预留拒绝和状态淘汰，但没有实际请求失败。这个治理与零失败同时被观察到，不能据此证明每个机制贡献多少，或证明没有内存风险。

引擎支持262,144总上下文token（含输出），**本次服务人为限131,072（128Ki）**；最大实际单次prompt114,775。pi输出上限通常32,768，接近上下文上限会缩减；不要把上游256Ki能力写成这次做过256Ki极限测试。上游README中2Ki冷请求的71.7tok/s、四并发218.9tok/s是其独立基准条件，不是本坦克任务测得值；此处仅提供[上游完整方法与数据](https://github.com/DT-HJ/my-little-trie-forge/blob/873d5574d903f5c1685e286c9cd59b79475a49f6/docs/MEASUREMENT_METHOD.md)供区分。

## 8. 本机部署、调用链和可复现入口

| 项目 | 实验实际设置 |
|---|---|
| 系统/硬件 | /status报告macOS27.0.1；M5 Max18CPU/40GPU/128GiB |
| pi | 1.3.0，medium，同一RPC会话；只用内置read/bash/edit/write，无其他编码模型、skills/MCP/扩展加入游戏开发 |
| 采样 | temperature1.0，top_p0.95，top_k20；实际请求确认；output cap最高32768、按余量下调 |
| 本机引擎API | http://127.0.0.1:8083/v1；model ID `local/Qwen3.8-27B-MLTF-q8c` |
| 实验代理 | pi→http://127.0.0.1:8085/v1→8083；透明转发与SSE统计，不修改模型/采样；仅监测期间运行 |
| 游戏 | http://127.0.0.1:5179/；本地回环地址，GitHub读者需自行启动，不是公网试玩地址 |
| 游戏栈 | Three.js0.186.1、Vite8.3.4、Playwright1.64.1（本机安装版本）；JavaScript/WebAudio/localStorage |
| 浏览器 | 独立Chromium；默认autoplay用户手势限制，未用Google Chrome；R1早期偏离已被纠正并记录 |
| 视觉与操作 | pi可读PNG；状态辅助自动瞄准/选路+真实输入，不是纯视觉盲玩；无其他视觉/编码模型接管 |

上游公开安装的默认端口为8000，**本机8083是本次部署选择**。以下展示与本机关键运行参数一致的复现形式；新读者应先看[安装文档](https://github.com/DT-HJ/my-little-trie-forge/blob/873d5574d903f5c1685e286c9cd59b79475a49f6/docs/INSTALL.md)和[模型卡](https://huggingface.co/Ho-Jin-93/Qwen3.8-27B-MLTF-q8c)，从模型站下载，不把权重塞进游戏仓库。

```sh
# 使用实验版本wheel；资产下载与服务启动分开
pip install https://github.com/hojin12312/my-little-trie-forge/releases/download/v0.1.2/my_little_trie_forge-0.1.2-py3-none-macosx_26_0_arm64.whl
mltf download --model Ho-Jin-93/Qwen3.8-27B-MLTF-q8c --accept-model-licenses
mltf serve --model local/Qwen3.8-27B-MLTF-q8c --model-path /path/to/prepared-q8c --host 127.0.0.1 --port 8083 --max-context 128K --max-memory 96G
```

此命令是文档复现示例，没有在报告整理时重新安装、下载或重启；本次原部署使用本机venv和控制脚本。鉴权沿用各自部署的私有配置，设置方法见上游CLI/API；不能把示例占位值当本机真实凭证。

已认证的OpenAI-compatible调用形式如下；`MLTF_API_KEY`由使用者在本机自行设置，报告不填真实凭证：

```sh
curl http://127.0.0.1:8083/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MLTF_API_KEY" \
  --data '{"model":"local/Qwen3.8-27B-MLTF-q8c","messages":[{"role":"user","content":"请简短确认服务已就绪"}],"stream":true,"temperature":1,"top_p":0.95,"top_k":20,"reasoning_effort":"medium","max_tokens":1024}'
```

pi端的关键选择是OpenAI-compatible API、text+image能力和128Ki上下文，指向8083；复现监控时才指向8085代理。配置好本地provider后：

```sh
pi --provider mltf --model local/Qwen3.8-27B-MLTF-q8c --thinking medium
```

游戏不依赖LLM服务即可游玩。克隆分享仓库后在其根目录运行：

```sh
cd game
npm ci
npm run dev -- --host 127.0.0.1 --port 5179
# 生产构建
npm run build
```

最终操作：WASD按世界方向移动，鼠标瞄准，左键/Space射击，P/Esc暂停，M静音；重开使用界面按钮。排行榜为本浏览器localStorage。开发测试用系统Chromium绝对路径；其他机器要安装对应Chromium并按自身路径配置测试脚本。游戏启动本身不需要Playwright/Chromium测试路径。

## 9. 四轮推理速度、稳定性与计量边界

| 轮次 | 原生decode tok/s | 原生prefill tok/s | TTFT中位/P95 秒 | 最大实际prompt | 草稿接受比 | 请求失败/取消/Metal/容量/重启 |
|---|---|---|---|---|---|---|
| R1 | 46.16 | 474.10 | 2.76 / 14.34 | 106,076 | 38.24% | 0 / 0 / 0 / 0 / 0 |
| R2 | 38.62 | 456.98 | 2.97 / 20.08 | 114,445 | 36.93% | 0 / 0 / 0 / 0 / 0 |
| R3 | 32.47 | 387.78 | 3.85 / 39.56 | 114,775 | 36.86% | 0 / 0 / 0 / 0 / 0 |
| R4 | 39.72 | 469.86 | 3.44 / 41.15 | 114,122 | 38.93% | 0 / 0 / 0 / 0 / 0 |

四轮合计原生工作区间加权约 **37.59 decode token/s、431.79 prefill token/s**。分母是各轮对应native累计wall_ms差值之和，不是对四个速率做简单平均；输出token含reasoning、代码、工具参数、测试、文档和压缩摘要，并非有用代码行数。四轮增量共430请求，HTTP全部200，实际失败/取消/Metal/容量失败/重启均0。

每轮原生速率=结束/status累计token减开始累计token，再除对应wall时间差；请求生命周期速率另取SSE各请求总tokens÷计时区间之和。prefill只计未缓存新增输入，不把反复发送历史prompt全部算作重新处理；TTFT取服务端request_latency，代理role/空delta不算首内容token。监控与浏览器工具等待计入开发用时，不算decode工作区间。

这是一场同机长会话工程任务，开始前引擎已热、已有模型和缓存；未重启清缓存做冷启动，亦未做固定prompt、恒定长度、等采样、多引擎对照。R1→R3速度下降、R4回升，不能简单归因为热降频、持续退化或某项优化生效；prompt/缓存/图片/输出/接受比/背景负载均变化。R3 TTFT最大约102.04s，R4约82.02s，正常长prefill与长思考不等于死循环。

### 上下文压缩成本

| 轮次 | 压缩次数 | 压缩辅助请求 | 辅助输出token | 辅助请求分钟 |
|---|---|---|---|---|
| R1 | 0 | 0 | 0 | 0.00 |
| R2 | 3 | 6 | 15,540 | 11.07 |
| R3 | 3 | 6 | 16,775 | 13.26 |
| R4 | 1 | 2 | 5,663 | 3.72 |

压缩请求已包含在各轮请求、token与总时间，不能另算一次开发轮。R4一次压缩从估计114,906→26,985token，两个辅助请求共5,663输出token、约3分43秒；对34.57分钟的小改动是明显成本。R1原始RPC无压缩事件；R2旧版精简timeline漏列压缩，但完整RPC保留3次事件，且与6个辅助请求的15,540输出token交叉相符，不能误填0。[R1压缩核对](./evidence/r1-compaction.json)、[R2压缩核对](./evidence/r2-compaction.json)。

## 10. CPU / GPU / 内存：四轮趋势

约5秒采样/status、IORegistry GPU、Mach CPU tick差分、进程RSS、vm_stat和swap；R1 CPU tick差分在开始数分钟后才补入，不能假造完整早期CPU基线。CPU/GPU都是整机口径，含浏览器、监控与其他桌面任务。原始本机日志保留；公开目录放可复核的分轮汇总和曲线。

| 轮次 | CPU中位/峰值 | 活跃推理期GPU中位 | 引擎分配起→止/峰值 GiB | native RSS中位GiB | 系统swap范围GiB | 压力normal/warning样本 |
|---|---|---|---|---|---|---|
| R1 | 4.84% / 18.77% | 99% | 81.728 → 94.414 / 95.213 | 14.54 | 5.49–11.48 | 202 / 360 |
| R2 | 7.98% / 32.32% | 99% | 94.414 → 95.114 / 95.250 | 17.23 | 10.79–11.59 | 1014 / 680 |
| R3 | 8.91% / 31.48% | 99% | 95.114 → 95.111 / 95.248 | 22.66 | 10.80–14.56 | 995 / 279 |
| R4 | 6.21% / 31.26% | 99% | 95.111 → 95.081 / 95.247 | 34.18 | 11.65–11.69 | 422 / 0 |

![R1资源与速度](./evidence/r1-performance.png)

![R2资源与速度](./evidence/r2-performance.png)

![R3资源与速度](./evidence/r3-performance.png)

![R4资源与速度](./evidence/r4-performance.png)

引擎分配、设备资源、进程RSS、系统swap口径不同，不能相加。约95GiB分配包含权重、草稿、vision、KV、前缀/状态缓存和workspace；不能声称“8bit27B权重需要95GiB”。R1已存在暖缓存，后续轮继承占用；全机swap的已有部分不能归为当轮新增。R4采样压力均normal，也不能反推早期三轮没有warning。预留拒绝/缓存淘汰与服务失败分开，具体数见各轮JSON。

## 11. 能力评价、归因与GitHub分享内容

**模型与pi：** 能从空目录搭起并迭代有真实3D、物理遮挡、AI、音频、状态流和本机榜的原型；能编写浏览器脚本、实际操作并读取截图。短板是需求理解、3D坐标/异步生命周期、生成器与测试判据、自评数值校准；两轮较大返工各12次监督提示，最终不是一次prompt无监督成品。长思考、重复诊断、假PASS、shell掩码和冗长文档均增加成本。

**MLTF：** 在这台M5 Max的430次顺序请求与约5.44小时pi工作中保持请求可用性，包含长prompt、读图、工具循环与多次压缩；这支持“本工程负载稳定运行”，不证明所有长时/并发场景都稳定，也不证明生成的软件正确。游戏JS异常、测试超时、模型误诊与Metal/推理失败分别记录，不能混为同一种引擎不稳定。

**作品：** R1功能原型→R2墙体/材质/基地→R3固定四敌追击迷宫→R4画布外HUD，是用户反馈驱动的实际轨迹。仍有简单模型和程序纹理、重复地面、保守取景、同图短局、状态辅助瞄准胜率、未精调的人类难度等局限；非联网榜、无触控/手柄，不声称商用完成度。音频信号存在与浏览器解锁通过，也不等同于主观听感评分。

**公开目录 github-share/** 包含本报告MD/HTML、pi原样游戏源码副本、四轮任务书公开副本、监督提示、分轮性能汇总/曲线、关键截图、R4详细布局/真实输入/失败与回归证据、模型及引擎身份JSON。该目录可独立上传；没有将私有pi配置、API key、完整会话流或模型权重纳入。游戏实现文件保持与R4冻结manifest一致，报告整理没有代替pi改代码。

公开日志/任务书中的本机绝对工作区路径替换为 `${WORKSPACE}`，其余数值和失败输出保留；游戏源码副本不做此替换。

关键过程证据：[R2异常破墙修复前](./evidence/r2-probe-before-fix.json)、[修复后](./evidence/r2-probe-after-fix.json)、[R2最终AI自然局](./evidence/r2-natural-play.json)、[R3三局](./evidence/r3-pi-natural-sessions.json)、[R3追击伤害](./evidence/r3-pursuit-observer.json)、[R3独立自然局](./evidence/r3-natural-final.json)。

公开证据索引：[R1指标](./evidence/r1-metrics.json)、[R2指标](./evidence/r2-metrics.json)、[R3指标](./evidence/r3-metrics.json)、[R4指标](./evidence/r4-metrics.json)、[模型/引擎身份](./evidence/model-engine-identity.json)、[R4失败日志](./evidence/r4-regression-failure.log)、[R4最终回归](./evidence/r4-regression-final.log)。这些是本机冻结数据的整理，不是MLTF作者的官方游戏评测或背书；上游基准、模型来源、本次实测三者分别标注。
