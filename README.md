# Tank Battle / LLM Test 2026-10-20

在 Apple M5 Max（40 GPU / 128GiB）上，以 MLTF 0.1.2 运行 Qwen3.8-27B-MLTF-q8c，经 pi 1.3.0 制作浏览器坦克游戏。四轮用户反馈，430次请求，461,939输出token；游戏由本地模型唯一编写，监督者提供29次文字提示并独立验证。

- [完整中文报告](./REPORT.zh-CN.md) · [HTML报告](./REPORT.zh-CN.html)
- [MLTF GitHub](https://github.com/DT-HJ/my-little-trie-forge)
- [8-bit prepared q8c模型](https://huggingface.co/Ho-Jin-93/Qwen3.8-27B-MLTF-q8c)
- [任务书](./prompts/README.md) · [模型/引擎固定身份](./evidence/model-engine-identity.json)

## 在线试玩

[GitHub Pages：Tank Battle](https://leoli-dev.github.io/llm-test-2026-10-20-game-tank-battle/) · [所有 LLM 测试报告](https://leoli-dev.github.io/llm-test-reports/#test=TANK-01)

## 玩游戏

```sh
cd game
npm ci
npm run dev -- --host 127.0.0.1 --port 5179
```

打开 http://127.0.0.1:5179/ 。WASD移动，鼠标瞄准，左键/Space射击，P/Esc暂停。游戏可独立运行，无须LLM服务。排行榜存于浏览器本机。

默认一局四辆敌人全部出现，敌人追击玩家，清光即胜利，无后续补兵。代码/测试/旧自评保留pi原始产物；它们的历史误述以综合报告核对为准。自然试玩采用状态辅助瞄准、真实键鼠输入，不是纯视觉或人类盲测。所有结论限于本机任务，非MLTF官方基准。

`evidence/` 为整理后的性能、截图与关键复测数据；原始私有客户端配置和模型权重未附。Three.js、Vite、Playwright等依赖由npm按package-lock安装。

## 发布与验证

仓库日期采用测试开始日期：2026-10-20。游戏 `game/src/` 与测试结束时的分享快照一致；发布时只补充部署配置、文档，并将浏览器测试的本机 Chromium 绝对路径改为可选 `CHROMIUM_PATH` / `BASE_URL`。不设置该变量时使用 Playwright 安装的 Chromium。

```sh
cd game
npm ci
npx playwright install chromium
npm run build
npm run dev -- --host 127.0.0.1 --port 5179
# 另开终端，在 game 目录运行
npm run test:all
```

`test:all` 包含真实键鼠与状态辅助瞄准的自然试玩，运行时间较长。历史测试结果和本次发布检查分开记录；这不是一轮新的 LLM 测试。
