# 计划 — 3D Tank Battle（本机 Qwen3.8-27B-MLTF-q8c 独立开发）

## 技术栈
- Vite + 原生 JS + Three.js（npm 安装，允许）
- WebAudio 程序化音效 + 程序化配乐（用户手势解锁）
- localStorage 排行榜（本机持久化，刷新不丢）
- 端口：优先 127.0.0.1:5179

## 结构
- index.html — HUD/GUI DOM
- src/main.js — 入口、游戏状态机（menu/playing/paused/gameover/victory）
- src/scene.js — 场景、地形、掩体/障碍、光照、雾、氛围
- src/tank.js — 玩家/敌人坦克模型、血条 sprite
- src/audio.js — WebAudio：射击/命中/爆炸/UI + 程序化配乐循环
- src/board.js — 排行榜读写 localStorage
- src/test-hooks.js — 暴露 window.__game 供确定性断言（不替代真操作）

## 机制
- 玩家：WASD 移动/转向，鼠标瞄准炮塔，点击/空格射击，P/Esc 暂停，M 静音
- 敌人 AI：波次刷新（5 波=胜利），追击/走位/不规则开火；HP 条、受伤闪白
- 子弹与地形/掩体碰撞；爆炸粒子+闪光；血条 HUD；弹药过热
- 得分：击杀+连击；死亡进名字→排行榜；胜利结算

## 测试
- Playwright + 已缓存 Chromium（非 Google Chrome）
- 流程：菜单→开始→WASD/鼠标/射击→击杀/受伤→暂停→继续→死亡→排行榜录入→重开
- 截图并 read 读取主菜单与战斗截图做视觉评估；监听 console/pageerror
- 验证 resize；验证刷新后排行榜仍在
- 证据存 tests/evidence/，最后写 SELF-REVIEW.md
