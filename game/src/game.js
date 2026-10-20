// STEEL HORIZON R3 — 固定歼灭战（迷宫巷道 + 敌追猎玩家）
import * as THREE from 'three';
import { buildScene } from './scene.js';
import { Tank } from './tank.js';
import { AudioSys } from './audio.js';
import { loadBoard, saveEntry, renderBoard } from './board.js';
import { GRID, TILE, WORLD, buildBattle, tileWorld, findPath, hasLOS, ENEMY_SPAWNS, ENEMY_TYPES } from './level.js';
import { brickTextures, steelTexture } from './textures.js';

const TANK_R = 1.15;
const ETYPES = {
  basic: { hp: 24, speed: 4.6, dmg: 10, cd: 1.8, bspd: 26, score: 100 },
  fast:  { hp: 16, speed: 7.2, dmg: 8,  cd: 1.4, bspd: 28, score: 150 },
  heavy: { hp: 48, speed: 3.4, dmg: 16, cd: 2.2, bspd: 22, score: 200 },
};
const DIFF = { easy: { dmg: 0.7, spd: 0.85 }, normal: { dmg: 1, spd: 1 }, hard: { dmg: 1.3, spd: 1.1 } };

export class Game {
  constructor(root) {
    this.root = root; // #stage：战场画布独占区（顶部/底部 HUD 栏之外的区域）
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    root.appendChild(this.renderer.domElement);

    const env = buildScene();
    this.scene = env.group;
    this.scene.fog = env.fog;
    this.camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 400);
    // 固定全场俯视 + 包围球自适应：任意画布宽高比下 52m 战场（含四角）始终完整入画
    this._camY = 58; this._camOff = 12;
    this._syncCanvas();
    this._frameCamera();
    this.camera.position.set(WORLD / 2, this._camY, WORLD / 2 + this._camOff);
    this.camera.lookAt(WORLD / 2, 0, WORLD / 2 - 1);

    this.audio = new AudioSys();
    this.diff = 'normal';
    this.state = 'menu';       // menu | playing | paused | over
    this.phase = 'idle';       // intro | fight | cleared
    this.phaseT = 0;
    this.overShown = false;
    this.overPanelT = 0;
    this.score = 0;
    this.lives = 2;            // R3：2 条命
    this.kills = 0;
    this.bricksBroken = 0;
    this.shotsFired = 0;
    this.hitsOnEnemies = 0;
    this.hitsOnPlayer = 0;
    this.time = 0;
    this.freezeEnemies = false;
    this.shake = 0;
    this.hurtVignette = 0;

    this.player = new Tank('player');
    this.player.hp = 100;
    this.player.invuln = 0;
    this.player.setHpFrac(1);
    this.scene.add(this.player.group);
    this.enemies = [];
    this.bullets = [];
    this.fx = [];

    this._tileMats();
    this._buildBattle(true);
    this._resetRun();

    this._ui();
    this._inputs();
    this._clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._frame());
    this._drawMinimap(0.1);
  }

  // ---------- 瓦片材质 ----------
  _tileMats() {
    const bt = brickTextures();
    const st = steelTexture();
    this.matBrickOk = new THREE.MeshStandardMaterial({ map: bt.ok.map, bumpMap: bt.ok.bump, bumpScale: 0.2, roughness: 0.9 });
    this.matBrickCr = new THREE.MeshStandardMaterial({ map: bt.cracked.map, bumpMap: bt.cracked.bump, bumpScale: 0.2, roughness: 0.9 });
    this.matSteel = new THREE.MeshStandardMaterial({ map: st.map, bumpMap: st.bump, bumpScale: 0.12, roughness: 0.4, metalness: 0.6 });
  }

  // R3：固定歼灭战——4 辆敌人开局一次性全部入场，无补充、无关卡
  _buildBattle(silent) {
    // 清理旧瓦片（密集数组：tileMeshes[i] 与 i = z*GRID+x 一一对应，空位为 null）
    for (const m of this.tileMeshes ?? []) if (m) this.scene.remove(m);
    this.tileMeshes = new Array(GRID * GRID).fill(null);
    for (const e of this.enemies) e.tank.dispose(this.scene);
    this.enemies = [];
    this.level = buildBattle();
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      const cell = this.level.cells[z][x];
      if (!cell) continue;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(TILE, 2.2, TILE),
        cell.type === 'B' ? this.matBrickOk : this.matSteel);
      const [wx, wz] = tileWorld(x, z);
      mesh.position.set(wx, 1.1, wz);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.tileMeshes[z * GRID + x] = mesh;
    }
    this._totalEnemies = this.level.totalEnemies;
    // 四角全部入场（2s 出生闪烁无敌）
    this.level.enemySpawns.forEach(([sx, sz], i) => {
      this._spawnEnemyAt(ENEMY_TYPES[i] || 'basic', sx, sz);
    });
    this.phase = 'intro';
    this.phaseT = 1.5;
    this._banner(`敌军 ${this._totalEnemies} 辆已全部入场 · 全灭获胜`, 2);
    if (!silent) this.audio.waveStart();
  }

  _tileMesh(i) { return i === null ? null : this.tileMeshes[i]; }
  _tileIndex(x, z) {
    const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
    if (tx < 0 || tz < 0 || tx >= GRID || tz >= GRID) return null;
    return tz * GRID + tx;
  }

  // ---------- 瓦片伤害（碰撞与弹道共用同一数据源） ----------
  damageTile(tx, tz, isPlayerBullet) {
    const cell = this.level.cells[tz][tx];
    if (!cell) return;
    const i = tz * GRID + tx;
    if (cell.type === 'S') {
      this.audio.steelHit();
      this._sparks(this.tileMeshes[i].position);
      return;
    }
    // 砖墙
    cell.hp -= 1;
    if (cell.hp <= 0) {
      this.bricksBroken += 1;
      this.score += 5;
      this.audio.brickBreak();
      this._debris(this.tileMeshes[i].position);
      this.scene.remove(this.tileMeshes[i]);
      this.tileMeshes[i] = null;
      this.level.cells[tz][tx] = null;
      this._drawMinimap(0);
    } else {
      this.audio.brickHit();
      this.tileMeshes[i].material = this.matBrickCr;
      this._debris(this.tileMeshes[i].position, true);
    }
  }

  // ---------- 开局 / 重开 ----------
  _resetRun() {
    this.score = 0;
    this.lives = 2;
    this.kills = 0;
    this.bricksBroken = 0;
    this.shotsFired = 0;
    this.hitsOnEnemies = 0;
    this.hitsOnPlayer = 0;
    this.enemies.forEach((e) => e.tank.dispose(this.scene));
    this.enemies = [];
    this.bullets.forEach((b) => this.scene.remove(b.mesh));
    this.bullets = [];
    this.time = 0;
    this._buildBattle(true);
    this._respawnPlayer(true);
  }

  startGame(diff = 'normal') {
    this.diff = diff || 'normal';
    this.audio.unlock();
    this.audio.startMusic();
    this.audio.setBPM(132);
    this.audio.musicGain.gain.value = 0.15;
    this._resetRun();
    this.state = 'playing';
    this.overShown = false;
    this.overPanelT = 0;
    this._showScreen('play');
  }

  restart() { this.startGame(this.diff); }

  toMenu() {
    this.state = 'menu';
    this.audio.stopMusic();
    this._resetRun();
    this._showScreen('menu');
    this._renderBoards();
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.audio.musicGain.gain.value = 0.04;
      this.$('#pause-stats').textContent = `得分 ${this.score} · 剩余敌军 ${this.enemies.length}/${this._totalEnemies} · 击毁 ${this.kills} · 破墙 ${this.bricksBroken}`;
      this._showScreen('pause');
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.audio.musicGain.gain.value = 0.15;
      this._showScreen('play');
    }
  }

  _renderBoards() {
    renderBoard(this.$('#menu-board'));
    renderBoard(this.$('#over-board'));
  }

  _respawnPlayer(first = false) {
    const [tx, tz] = this.level.playerSpawn;
    const [x, z] = tileWorld(tx, tz);
    this.player.group.position.set(x, 0, z);
    this.player.group.rotation.y = 0;
    this.player.setWorldTurretYaw(0);
    this.player.hp = 100;
    this.player.setHpFrac(1);
    this.player.dead = false;
    this.player.invuln = first ? 1.5 : 3;
    this.player.setSpawnBlink(first ? 1.5 : 3);
    this.player.heat = 0;
    this.player.overheatT = 0;
    this.player.fireCd = 0;
  }

  // ---------- UI ----------
  $(sel) { return document.querySelector(sel); }
  _ui() {
    const on = (id, fn) => this.$(id)?.addEventListener('click', (e) => {
      this.audio.unlock(); this.audio.click(); fn(); e.currentTarget.blur();
    });
    on('#btnStart', () => this.startGame(this.diff));
    document.querySelectorAll('.diff-btn').forEach((b) => b.addEventListener('click', (e) => {
      this.diff = e.currentTarget.dataset.diff;
      document.querySelectorAll('.diff-btn').forEach((x) => x.classList.toggle('sel', x === e.currentTarget));
      this.audio.unlock(); this.audio.click();
    }));
    on('#btnPause', () => this.togglePause());
    on('#btnSound', () => {
      this.audio.setMuted(!this.audio.muted);
      this.$('#btnSound').textContent = '♪ 声音：' + (this.audio.muted ? '关' : '开');
    });
    on('#btnResume', () => this.togglePause());
    on('#btnRestartPause', () => this.restart());
    on('#btnMenuPause', () => this.toMenu());
    on('#btnAgain', () => this.restart());
    on('#btnMenu', () => this.toMenu());
    on('#btnMap', () => this.toggleMinimap());
    this._chEl = this.$('#crosshair');
    this._renderBoards();
  }

  _showScreen(name) {
    for (const id of ['screen-menu', 'screen-pause', 'screen-over']) {
      this.$('#' + id)?.classList.toggle('hidden', id !== 'screen-' + name);
    }
  }

  _banner(text, t) {
    const el = this.$('#banner');
    el.textContent = text;
    el.classList.remove('hidden');
    this._bannerT = t;
  }

  _inputs() {
    this.keys = {};
    const sr = this.renderer.domElement.getBoundingClientRect();
    this.mouse = { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2, down: false };
    this.aimPoint = new THREE.Vector3(WORLD / 2, 0, WORLD / 2 - 10);
    addEventListener('resize', () => this._syncCanvas());
    new ResizeObserver(() => this._syncCanvas()).observe(this.root);
    this._updateAim(); // 初始瞄准画面中心（画布相对坐标）
    addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'KeyP' || e.code === 'Escape') { if (this.state === 'playing' || this.state === 'paused') this.togglePause(); }
      if (e.code === 'KeyM') this.audio.setMuted(!this.audio.muted);
      if (e.code === 'KeyR' && this.state === 'over') this.restart();
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('pointermove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this._updateAim(); });
    addEventListener('pointerdown', (e) => {
      this.audio.unlock();
      if (e.target === this.renderer.domElement) this.mouse.down = true;
    });
    addEventListener('pointerup', () => { this.mouse.down = false; });
  }

  _updateAim() {
    // NDC 相对画布实际区域（画布不再全屏，必须用 canvas rect 而非窗口尺寸）
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector3(((this.mouse.x - r.left) / r.width) * 2 - 1, (-((this.mouse.y - r.top) / r.height) * 2) + 1, 0.5);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p);
    if (p) this.aimPoint.copy(p);
  }

  // ---------- 主循环 ----------
  _frame() {
    const dt = Math.min(this._clock.getDelta(), 0.05);
    if (this.state === 'playing') this._update(dt);
    else if (this.state === 'over' && !this.overShown) {
      // 结算面板延迟（主循环计时：暂停安全，重开复位）
      this.overPanelT -= dt;
      if (this.overPanelT <= 0) this._showOverPanel();
    }
    this._updateCamera(dt);
    // 相机外特效更新（菜单/暂停也播放残影粒子）
    this._updateFx(dt, this.state !== 'paused');
    if (this._chEl) {
      this._chEl.classList.toggle('hidden', this.state !== 'playing');
      this._chEl.style.left = this.mouse.x + 'px';
      this._chEl.style.top = this.mouse.y + 'px';
    }
    this.renderer.render(this.scene, this.camera);
  }

  _update(dt) {
    this.time += dt;
    this._updatePhase(dt);
    this._updatePlayer(dt);
    if (!this.freezeEnemies) {
      for (const e of [...this.enemies]) this._updateEnemy(e, dt);
    }
    this._updateBullets(dt);
    for (const t of [this.player, ...this.enemies.map((e) => e.tank)]) t.update(dt);
    this._hud();
    this._drawMinimap(dt);
  }

  _updatePhase(dt) {
    if (this._bannerT > 0) {
      this._bannerT -= dt;
      if (this._bannerT <= 0) this.$('#banner').classList.add('hidden');
    }
    if (this.phase === 'intro') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.phase = 'fight';
      return;
    }
    // 全灭 → 胜利（主循环计时，暂停安全/重开复位）；R3 无刷兵队列，enemies 为空即全灭
    if (this.phase === 'fight' && this.enemies.length === 0) {
      const bonus = 500;
      this.score += bonus;
      this.phase = 'cleared';
      this.phaseT = 1.2;
      this._banner(`全灭 +${bonus}`, 1.4);
      this.audio.levelClear();
      return;
    }
    if (this.phase === 'cleared') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        this.audio.victory();
        this._gameOver(true, '敌军全灭');
      }
    }
  }

  // ---------- 玩家 ----------
  _updatePlayer(dt) {
    const p = this.player;
    if (p.invuln > 0) p.invuln -= dt;
    const k = this.keys;
    let mx = (k['KeyD'] ? 1 : 0) - (k['KeyA'] ? 1 : 0);
    let mz = (k['KeyS'] ? 1 : 0) - (k['KeyW'] ? 1 : 0);
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      mx /= len; mz /= len;
      const spd = 7;
      const nx = p.group.position.x + mx * spd * dt;
      const nz = p.group.position.z + mz * spd * dt;
      this._collideTank(p.group, nx, nz);
      // 车体朝向移动方向
      const targetYaw = Math.atan2(-mx, -mz);
      p.group.rotation.y = this._lerpAngle(p.group.rotation.y, targetYaw, 10 * dt);
    }
    // 炮塔瞄准
    const dx = this.aimPoint.x - p.group.position.x;
    const dz = this.aimPoint.z - p.group.position.z;
    p.setWorldTurretYaw(Math.atan2(-dx, -dz));
    // 射击
    if (p.heat == null) p.heat = 0;
    if (p.heat > 0) p.heat = Math.max(0, p.heat - 26 * dt);
    if ((p.overheatT || 0) > 0) p.overheatT -= dt;
    p.fireCd = (p.fireCd || 0) - dt; // 冷却随游戏时间流逝（与是否按住无关；暂停时本函数不执行 → 自动冻结）
    if ((this.mouse.down || k['Space']) && (p.overheatT || 0) <= 0 && p.fireCd <= 0) {
      if (p.heat >= 100) { p.overheatT = 2.2; p.heat = 0; this.audio.overheat(); this._hud(true); }
      else {
        p.fireCd = 0.38;
        p.heat += 12;
        this.shotsFired++;
        this.audio.fire(true);
        const fwd = p.turretForward();
        const m = p.group.position.clone().addScaledVector(fwd, 3.4).setY(1.5);
        this._spawnBullet(m, fwd, 38, 12, true, 1.7);
        this._muzzle(p, fwd);
      }
    }
    this._hud();
  }

  // 圆形坦克 vs 瓦片 AABB（玩家/敌人共用 → 同一碰撞规则）
  _collideTank(group, nx, nz) {
    for (let iter = 0; iter < 3; iter++) {
      let blocked = false;
      const i = this._tileIndex(nx, nz);
      if (i != null && this.level.cells[Math.floor(i / GRID)][i % GRID]) {
        const tx = i % GRID, tz = Math.floor(i / GRID);
        const cx = tx * TILE, cz = tz * TILE;
        const px = Math.max(cx, Math.min(nx, cx + TILE));
        const pz = Math.max(cz, Math.min(nz, cz + TILE));
        const ddx = nx - px, ddz = nz - pz;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < TANK_R * TANK_R) {
          const d = Math.sqrt(d2) || 0.001;
          const push = (TANK_R - d) / d;
          nx += ddx * push; nz += ddz * push;
          blocked = true;
        }
      }
      // 邻居瓦片（跨格时）
      const ix = Math.floor(nx / TILE), iz = Math.floor(nz / TILE);
      for (const [tx, tz] of [[ix - 1, iz], [ix + 1, iz], [ix, iz - 1], [ix, iz + 1]]) {
        if (tx < 0 || tz < 0 || tx >= GRID || tz >= GRID) continue;
        if (!this.level.cells[tz][tx]) continue;
        const cx = tx * TILE, cz = tz * TILE;
        const px = Math.max(cx, Math.min(nx, cx + TILE));
        const pz = Math.max(cz, Math.min(nz, cz + TILE));
        const ddx = nx - px, ddz = nz - pz;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < TANK_R * TANK_R) {
          const d = Math.sqrt(d2) || 0.001;
          const push = (TANK_R - d) / d;
          nx += ddx * push; nz += ddz * push;
          blocked = true;
        }
      }
      nx = Math.max(TANK_R, Math.min(WORLD - TANK_R, nx));
      nz = Math.max(TANK_R, Math.min(WORLD - TANK_R, nz));
      if (!blocked) break;
    }
    group.position.x = nx;
    group.position.z = nz;
  }

  // ---------- 敌人（R3 追猎 AI：目标永远=玩家，有 LOS 侧翼包夹，无 LOS 寻路+破砖）----------
  _updateEnemy(e, dt) {
    const t = e.tank;
    if (t.blinkT > 0) { t.update(dt); return; }
    const pAlive = !this.player.dead;
    const pPos = this.player.group.position;
    const dP = t.pos.distanceTo(pPos);

    // 寻路：目标格变化或 0.7s 超时重算（玩家穿墙角 → 立即换路）
    e.pathT -= dt;
    const et = [Math.floor(t.pos.x / TILE), Math.floor(t.pos.z / TILE)];
    const gt = [Math.floor(pPos.x / TILE), Math.floor(pPos.z / TILE)];
    if (!e.path || e.pathT <= 0 || e.goalKey !== `${gt[0]},${gt[1]}`) {
      e.path = findPath(this.level, et, gt) || [];
      e.pathT = 0.7;
      e.goalKey = `${gt[0]},${gt[1]}`;
    }

    const los = pAlive && hasLOS(this.level, t.pos.x, t.pos.z, pPos.x, pPos.z);
    const engaged = los && dP < 22;

    // 移动：近距→横走侧翼；中距有 LOS→直逼；无 LOS→沿路径
    let moveDir = null;
    if (engaged && dP < 11) {
      e.strafeT = (e.strafeT ?? 0) - dt;
      let s = e.strafeDir ?? 1;
      if (e.strafeT <= 0) { e.strafeDir = -s; e.strafeT = 1.6 + Math.random() * 1.2; s = e.strafeDir; }
      const px = (pPos.x - t.pos.x) / (dP || 1), pz = (pPos.z - t.pos.z) / (dP || 1);
      moveDir = [ pz * s, -px * s ];
    } else if (engaged) {
      moveDir = [ (pPos.x - t.pos.x) / dP, (pPos.z - t.pos.z) / dP ];
    } else if (e.path.length) {
      let [tx, tz] = e.path[0];
      while (e.path.length && (tx === et[0] && tz === et[1])) { [tx, tz] = e.path.shift(); }
      if (e.path.length) {
        const [nx, nz] = tileWorld(tx, tz);
        const dx = nx - t.pos.x, dz = nz - t.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.3) e.path.shift();
        else moveDir = [ dx / dist, dz / dist ];
      }
    }
    if (moveDir) {
      const [hx, hz] = moveDir;
      // 防重叠：前进方向 2.4m 内有他车则停（侧翼时立即反向）
      let blocked = false;
      for (const o of [this.player.group, ...this.enemies.map((o2) => o2.tank.group)]) {
        if (o === t.group) continue;
        const ox = o.position.x - t.pos.x, oz = o.position.z - t.pos.z;
        const along = ox * hx + oz * hz;
        if (along > 0 && along < 2.4 && Math.hypot(ox - along * hx, oz - along * hz) < 1.9) {
          blocked = true;
          if (engaged) e.strafeT = 0;
          break;
        }
      }
      if (!blocked) {
        const ox0 = t.pos.x, oz0 = t.pos.z;
        this._collideTank(t.group, t.pos.x + hx * e.speed * dt, t.pos.z + hz * e.speed * dt);
        const vx = t.pos.x - ox0, vz = t.pos.z - oz0;
        if (Math.hypot(vx, vz) > 0.005) t.group.rotation.y = this._lerpAngle(t.group.rotation.y, Math.atan2(-vx, -vz), 8 * dt);
        e.prevX = t.pos.x; e.prevZ = t.pos.z;
      }
    }

    // 炮塔：有 LOS 瞄玩家（限速 2.6rad/s → 有真实瞄准窗口）；否则路径上 14m 内有砖 → 破捷径
    let aimX = pPos.x, aimZ = pPos.z;
    let fireAt = pAlive ? 'player' : null;
    if (!engaged && e.path.length) {
      const [tx, tz] = e.path[0];
      const cell = this.level.cells[tz][tx];
      if (cell?.type === 'B') {
        const [bx, bz] = tileWorld(tx, tz); // tileWorld 返回 [x, z]
        if (t.pos.distanceTo(new THREE.Vector3(bx, 0, bz)) < 14) { aimX = bx; aimZ = bz; fireAt = 'brick'; }
      }
    }
    const want = Math.atan2(-(aimX - t.pos.x), -(aimZ - t.pos.z));
    t.setWorldTurretYaw(this._lerpAngle(t.worldTurretYaw(), want, 2.6 * dt));

    // 开火：对准 + 冷却 + 射程；玩家目标 ±1.5° 散布（有威胁但不过度精准）
    e.fireCd -= dt;
    const ang = t.worldTurretYaw();
    const align = Math.abs(this._angDiff(ang, want)) < 0.1;
    const dAim = Math.hypot(aimX - t.pos.x, aimZ - t.pos.z);
    if (fireAt && align && e.fireCd <= 0 && dAim < 24) {
      e.fireCd = e.cd;
      const fwd = t.turretForward();
      const dir = (fireAt === 'player')
        ? new THREE.Vector3(fwd.x, 0, fwd.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.052)
        : new THREE.Vector3(fwd.x, 0, fwd.z);
      this._spawnBullet(t.pos.clone().addScaledVector(dir, 3.4).setY(1.5), dir, e.bspd, e.dmg, false, 1.6);
      this._muzzle(t, dir);
      this.audio.fire(false);
    }
  }

  // ---------- 子弹 ----------
  _spawnBullet(pos, dir, speed, dmg, friendly, life) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 8),
      new THREE.MeshBasicMaterial({ color: friendly ? 0x7dfcb0 : 0xff8a5c })
    );
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.bullets.push({ mesh, vel: dir.clone().multiplyScalar(speed), dmg, friendly, life, hitT: 0 });
  }

  _updateBullets(dt) {
    for (const b of [...this.bullets]) {
      b.life -= dt;
      if (b.life <= 0) { this._killBullet(b); continue; }
      const steps = 3;
      let dead = false;
      for (let s = 0; s < steps && !dead; s++) {
        b.mesh.position.addScaledVector(b.vel, dt / steps);
        const { x, y, z } = b.mesh.position;
        if (x < 0.2 || z < 0.2 || x > WORLD - 0.2 || z > WORLD - 0.2) { this._killBullet(b); dead = true; break; }
        // 瓦片
        const i = this._tileIndex(x, z);
        if (i != null) {
          const tx = i % GRID, tz = Math.floor(i / GRID);
          const cell = this.level.cells[tz][tx];
          if (cell) { this.damageTile(tx, tz, b.friendly); this._killBullet(b); dead = true; break; }
        }
        // 坦克
        if (b.friendly) {
          for (const e of [...this.enemies]) {
            const d = e.tank.pos.distanceTo(new THREE.Vector3(x, 0, z));
            if (d < 1.35 && e.tank.blinkT <= 0) {
              this.hitsOnEnemies++;
              e.hp -= b.dmg;
              e.tank.hitFlash();
              e.tank.setHpFrac(Math.max(0, e.hp / e.maxHp));
              this.audio.hitTank();
              this._sparks(new THREE.Vector3(x, 1.2, z));
              if (e.hp <= 0) this._killEnemy(e);
              this._killBullet(b); dead = true;
              break;
            }
          }
        } else {
          const p = this.player;
          if (!p.dead && p.invuln <= 0) {
            const d = p.group.position.distanceTo(new THREE.Vector3(x, 0, z));
            if (d < 1.35) {
              this.hitsOnPlayer++;
              p.hp -= b.dmg;
              p.hitFlash();
              p.setHpFrac(Math.max(0, p.hp / 100));
              this.audio.hurt();
              this.hurtVignette = 0.6;
              this.shake = Math.max(this.shake, 0.35);
              if (p.hp <= 0) this._playerDown();
              this._killBullet(b); dead = true;
            }
          }
        }
      }
    }
  }

  _killBullet(b) {
    this.scene.remove(b.mesh);
    b.mesh.geometry.dispose();
    b.mesh.material.dispose();
    this.bullets.splice(this.bullets.indexOf(b), 1);
  }

  _killEnemy(e) {
    this.enemies.splice(this.enemies.indexOf(e), 1);
    this._explode(e.tank.pos.clone(), e.type === 'heavy');
    e.tank.dispose(this.scene);
    this.kills++;
    this.score += e.score;
    this.shake = Math.max(this.shake, 0.3);
    this.audio.explosion(e.type === 'heavy');
  }

  _playerDown() {
    this.player.dead = true;
    this._explode(this.player.group.position.clone(), true);
    this.lives--;
    this.audio.explosion(true);
    this._hud(true);
    if (this.lives <= 0) this._gameOver(false, '坦克损毁');
    else {
      this._respawnPlayer(false);
      this._banner('复活！注意炮火', 1.6);
    }
  }

  _gameOver(win, reason = '') {
    this.state = 'over';
    this.win = win;
    this.overReason = reason;
    this.overShown = false;
    this.overPanelT = win ? 0.8 : 1.3;
    this.mouse.down = false;
    this.audio.stopMusic();
  }

  _showOverPanel() {
    this.overShown = true;
    this.$('#over-title').textContent = this.win ? '任务完成' : '任务失败';
    this.$('#over-title').className = this.win ? 'win' : 'lose';
    this.$('#over-reason').textContent = this.overReason || (this.win ? '敌军全灭' : '坦克损毁');
    this.$('#over-stats').innerHTML =
      `最终得分 <b>${this.score}</b> · 击毁 <b>${this.kills}/${this._totalEnemies}</b> · 破墙 <b>${this.bricksBroken}</b> · 存活 <b>${Math.round(this.time)}s</b>`;
    const btn = this.$('#btnSave');
    btn.disabled = false;
    btn.textContent = '录入排行榜';
    btn.onclick = () => {
      const name = (this.$('#name-input').value || '玩家').slice(0, 10).toUpperCase();
      saveEntry({ name, score: this.score, result: this.win ? '胜利' : '战败', kills: this.kills, diff: this.diff });
      this._renderBoards();
      btn.disabled = true;
      btn.textContent = '已录入';
    };
    this._renderBoards();
    this._showScreen('over');
  }

  // ---------- 特效 ----------
  _muzzle(tank, fwd) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95 }));
    m.position.copy(tank.group.position).addScaledVector(fwd, 3.6).setY(1.5);
    this.scene.add(m);
    this.fx.push({ obj: m, t: 0.07, kind: 'fade' });
  }
  _sparks(p) {
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0xffd98a }));
      m.position.copy(p);
      this.scene.add(m);
      this.fx.push({ obj: m, t: 0.3, kind: 'fly', v: new THREE.Vector3((Math.random() - 0.5) * 6, 3 + Math.random() * 3, (Math.random() - 0.5) * 6) });
    }
  }
  _debris(p, small = false) {
    const n = small ? 5 : 12;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0x8a3b2a, roughness: 1 }));
      m.position.copy(p).setY(1.1 + Math.random());
      this.scene.add(m);
      this.fx.push({ obj: m, t: 0.7, kind: 'debris', v: new THREE.Vector3((Math.random() - 0.5) * 7, 2 + Math.random() * 4, (Math.random() - 0.5) * 7) });
    }
  }
  _explode(p, big = false) {
    for (let i = 0; i < (big ? 26 : 16); i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35),
        new THREE.MeshBasicMaterial({ color: i % 3 ? 0xffa64d : 0xffe28a, transparent: true, opacity: 1 }));
      m.position.copy(p).setY(1 + Math.random());
      this.scene.add(m);
      this.fx.push({ obj: m, t: 0.8, kind: 'debris', v: new THREE.Vector3((Math.random() - 0.5) * 10, 3 + Math.random() * 6, (Math.random() - 0.5) * 10) });
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 1, 24), new THREE.MeshBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(p).setY(0.15);
    this.scene.add(ring);
    this.fx.push({ obj: ring, t: 0.5, kind: 'ring' });
  }
  _updateFx(dt, anim) {
    if (!anim) return;
    for (const f of [...this.fx]) {
      f.t -= dt;
      if (f.kind === 'fly' || f.kind === 'debris') {
        f.obj.position.addScaledVector(f.v, dt);
        f.v.y -= 14 * dt;
        if (f.kind === 'debris') f.obj.rotation.x += dt * 6, f.obj.rotation.z += dt * 4;
        if (f.obj.position.y < 0.1) { f.obj.position.y = 0.1; f.v.set(0, 0, 0); }
      }
      if (f.kind === 'fade' || f.kind === 'ring') {
        const mat = f.obj.material;
        if (mat) mat.opacity = Math.max(0, f.t / (f.kind === 'ring' ? 0.5 : 0.07));
        if (f.kind === 'ring') f.obj.scale.setScalar(1 + (0.5 - f.t) * 8);
      }
      if (f.t <= 0) {
        if (f.kind === 'restore') f.obj.material = f.mat;
        else this.scene.remove(f.obj);
        f.obj.geometry?.dispose();
        f.obj.material?.dispose?.();
        this.fx.splice(this.fx.indexOf(f), 1);
      }
    }
  }

  // ---------- 相机（固定全场俯视，轻微斜角保留 3D 立体感）----------
  _updateCamera(dt) {
    const sh = this.shake > 0 ? this.shake : 0;
    this.shake = Math.max(0, this.shake - 2.5 * dt);
    const ox = (Math.random() - 0.5) * sh * 0.5, oz = (Math.random() - 0.5) * sh * 0.5;
    const cx = WORLD / 2 + ox, cz = WORLD / 2 + oz;
    this.camera.position.set(cx, this._camY, cz + this._camOff);
    this.camera.lookAt(cx, 0, cz - 1);
  }

  // 画布尺寸 → renderer/aspect（#stage 实际区域，含底部栏展开变化）
  _syncCanvas() {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._frameCamera();
  }

  // 包围球拟合：战场 52×52 的外接球在最小 FOV 半角内 → 四角/出生点任意宽高比下不被裁切
  _frameCamera() {
    const w = this.root.clientWidth || 16, h = this.root.clientHeight || 9;
    const vFov = 55 * Math.PI / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (w / h));
    const half = Math.min(vFov, hFov) / 2;
    const R = Math.hypot(WORLD / 2, WORLD / 2) * 1.04; // 战场外接球半径（含少量余量）
    const dist = R / Math.sin(half);
    const d = new THREE.Vector3(0, 58, 13).normalize(); // 与原俯视斜角一致
    this._camY = d.y * dist;
    this._camOff = d.z * dist;
  }

  // ---------- HUD / 小地图 ----------
  _hud(force) {
    const ui = this._uiCache ??= {
      hull: this.$('#hullbar'), hptext: this.$('#hptext'),
      heat: this.$('#heatbar'), heatlabel: this.$('#heatlabel'),
      score: this.$('#score'),
      infoPhase: this.$('#info-phase'), infoNum: this.$('#info-num'), enemyNum: this.$('#enemy-num'),
      lives: this.$('#lives'), base: this.$('#enemybar'),
      vignette: this.$('#vignette'),
    };
    const p = this.player;
    const frac = Math.max(0, p.hp / 100);
    ui.hull.style.width = (frac * 100) + '%';
    ui.hull.style.background = frac > 0.5 ? '#54d164' : frac > 0.25 ? '#e0b83e' : '#e04b3e';
    ui.hptext.textContent = Math.max(0, Math.round(p.hp));
    ui.heat.style.width = (p.heat || 0) + '%';
    ui.heatlabel.textContent = p.overheatT > 0 ? '过热!' : '炮温';
    ui.heatlabel.classList.toggle('bad', p.overheatT > 0);
    ui.score.textContent = this.score;
    const remain = this.enemies.length;
    const total = this._totalEnemies || 0;
    // 阶段名与关键数字分置两 span：窄屏只隐藏阶段名，敌军 N/4 与击毁数始终可见
    ui.infoPhase.innerHTML = this.level ? `歼灭战 · ${this.level.name}` : '';
    ui.infoNum.innerHTML = this.level ? ` &nbsp;|&nbsp; 敌军 ${remain}/${total} &nbsp;|&nbsp; 击毁 ${this.kills}` : '';
    ui.lives.textContent = '▲'.repeat(this.lives) + '▽'.repeat(Math.max(0, 2 - this.lives));
    ui.enemyNum.textContent = `${remain}/${total}`;
    ui.base.style.width = ((total ? remain / total : 0) * 100) + '%';
    this._vignetteV = Math.max(this._vignetteV ?? 0, this.hurtVignette);
    this.hurtVignette = 0;
    ui.vignette.style.opacity = Math.max(0, (this._vignetteV -= 0.02)) * 0.8;
  }

  _minimapCtx = null;
  _mmLast = 0;
  toggleMinimap() {
    const w = this.$('#minimap-wrap');
    w.classList.toggle('on');
    this.$('#btnMap').textContent = '地图：' + (w.classList.contains('on') ? '开' : '关');
    if (w.classList.contains('on')) this._drawMinimap(0); // 立即刷一次；ResizeObserver 会同步画布尺寸
  }
  _drawMinimap(dt) {
    if (!this.level) return;
    if (!this.$('#minimap-wrap').classList.contains('on')) return;
    if (!this._minimapCtx) {
      const c = this.$('#minimap');
      if (!c) return;
      c.width = GRID * 10; c.height = GRID * 10;
      this._minimapCtx = c.getContext('2d');
    }
    if (dt > 0 && this.time - this._mmLast < 0.25) return;
    this._mmLast = this.time;
    const x = this._minimapCtx;
    x.fillStyle = 'rgba(10,14,10,0.9)';
    x.fillRect(0, 0, GRID * 10, GRID * 10);
    for (let z = 0; z < GRID; z++) for (let cx = 0; cx < GRID; cx++) {
      const cell = this.level.cells[z][cx];
      if (!cell) continue;
      x.fillStyle = cell.type === 'B' ? (cell.hp < 2 ? '#a05a3a' : '#c26a3e') : cell.type === 'S' ? '#9aa7b5' : '#ffd23e';
      x.fillRect(cx * 10 + 1, z * 10 + 1, 8, 8);
    }
    for (const e of this.enemies) {
      x.fillStyle = '#ff5a4a';
      x.fillRect(Math.floor(e.tank.pos.x / TILE) * 10 + 2, Math.floor(e.tank.pos.z / TILE) * 10 + 2, 6, 6);
    }
    x.fillStyle = '#54ffb0';
    x.fillRect(Math.floor(this.player.group.position.x / TILE) * 10 + 2, Math.floor(this.player.group.position.z / TILE) * 10 + 2, 6, 6);
  }

  // ---------- 工具 ----------
  _lerpAngle(a, b, t) {
    let d = this._angDiff(b, a);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * Math.min(1, t);
  }
  _angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

  // ---------- 测试钩子（仅测试使用） ----------
  get testInfo() {
    return {
      state: this.state, phase: this.phase,
      levelName: this.level?.name,
      score: this.score, kills: this.kills, lives: this.lives,
      bricksBroken: this.bricksBroken,
      playerHp: this.player.hp, playerDead: this.player.dead,
      enemies: this.enemies.length, toSpawn: 0, // R3：无刷兵队列，开局后恒 0
      totalEnemies: this._totalEnemies,
      shotsFired: this.shotsFired, hitsOnEnemies: this.hitsOnEnemies, hitsOnPlayer: this.hitsOnPlayer,
      playerPos: [this.player.group.position.x, this.player.group.position.z],
      audioUnlocked: this.audio.unlocked,
      audioRunning: this.audio?.ctx?.state,
      muted: this.audio.muted,
      board: loadBoard().length,
    };
  }
  // 供测试读取的瓦片状态
  tileAt(wx, wz) {
    const i = this._tileIndex(wx, wz);
    if (i == null) return null;
    const c = this.level.cells[Math.floor(i / GRID)][i % GRID];
    return c ? { type: c.type, hp: c.hp === Infinity ? -1 : c.hp } : null;
  }
  damageTileAt(wx, wz, byPlayer = false) {
    const i = this._tileIndex(wx, wz);
    if (i == null) return;
    this.damageTile(i % GRID, Math.floor(i / GRID), byPlayer);
  }
  // 测试钩子：在空闲格直接刷一辆指定敌人（辅助测试用；默认玩法固定 4 辆无补充）
  spawnTestEnemy(type = 'basic') {
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      if (!this.level.cells[z][x] && Math.hypot(x * TILE + 2 - this.player.group.position.x, z * TILE + 2 - this.player.group.position.z) > 12) {
        return this._spawnEnemyAt(type, x, z);
      }
    }
    return null;
  }
  _spawnEnemyAt(type, sx, sz) {
    const [x, z] = tileWorld(sx, sz);
    const def = ETYPES[type];
    const d = DIFF[this.diff];
    const tank = new Tank(type);
    tank.group.position.set(x, 0, z);
    tank.group.rotation.y = Math.PI;
    tank.setWorldTurretYaw(Math.PI);
    tank.setSpawnBlink(2);
    this.scene.add(tank.group);
    tank.setHpFrac(1);
    const e = {
      type, tank, hp: def.hp, maxHp: def.hp,
      speed: def.speed * d.spd, dmg: def.dmg * d.dmg,
      cd: def.cd, bspd: def.bspd, score: def.score,
      fireCd: def.cd + 1, path: null, pathT: 0, prevX: x, prevZ: z,
      strafeT: 0, strafeDir: 1,
    };
    this.enemies.push(e);
    return e;
  }

  projectToScreen(x, y, z) {
    // 返回页面坐标（画布 rect 偏移 + 画布内 NDC），与鼠标输入同一坐标系
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
  }
  dealPlayerDamage(n) {
    if (this.player.dead) return;
    this.hitsOnPlayer++;
    this.player.hp = Math.max(0, this.player.hp - n);
    this.player.setHpFrac(this.player.hp / 100);
    if (this.player.hp <= 0) this._playerDown();
  }
  getLevel() {
    return {
      grid: this.level.cells.map((r) => r.map((c) => (c ? c.type : '.'))),
      playerSpawn: this.level.playerSpawn,
      enemySpawns: ENEMY_SPAWNS,
    };
  }
  // 校验关卡可解性（测试用）
  validateLevelNow() {
    return import('./level.js').then((m) => m.validateLevel(this.level));
  }
}
