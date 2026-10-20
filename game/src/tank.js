// 坦克（贴装甲甲 + 履带），支持 360° 炮塔（世界角 API 保留）
import * as THREE from 'three';
import { camoTexture, treadTexture, barrelTexture } from './textures.js';

const PALETTES = {
  player: { base: '#66744a', dark: '#454f33', light: '#8d9a63', seed: 21 },
  basic:  { base: '#8a4636', dark: '#5c2f24', light: '#b26a4e', seed: 22 },
  fast:   { base: '#a3904a', dark: '#6f6233', light: '#c8b56e', seed: 23 },
  heavy:  { base: '#5b5474', dark: '#3c3852', light: '#8078a0', seed: 24 },
};

let TREAD = null, BARREL = null;
function sharedTextures() {
  if (!TREAD) TREAD = treadTexture();
  if (!BARREL) BARREL = barrelTexture();
  return { TREAD, BARREL };
}

export class Tank {
  constructor(type = 'basic') {
    this.type = type;
    this.dead = false;
    this.flashT = 0;
    this.mats = [];
    const pal = PALETTES[type] || PALETTES.basic;
    const camo = camoTexture(pal.base, pal.dark, pal.light, pal.seed);
    const { TREAD, BARREL } = sharedTextures();

    this.group = new THREE.Group();

    const hullMat = new THREE.MeshStandardMaterial({ map: camo.map, bumpMap: camo.bump, bumpScale: 0.12, roughness: 0.7, metalness: 0.25 });
    const treadMat = new THREE.MeshStandardMaterial({ map: TREAD.map, bumpMap: TREAD.bump, bumpScale: 0.2, roughness: 0.9, metalness: 0.4 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.85, metalness: 0.3 });
    this.mats.push(hullMat, treadMat, darkMat);

    // 车体
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.85, 3.0), hullMat);
    hull.position.y = 0.75;
    hull.castShadow = hull.receiveShadow = true;
    this.group.add(hull);
    // 甲板
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.22, 2.5), darkMat);
    deck.position.y = 1.26;
    deck.castShadow = true;
    this.group.add(deck);
    // 履带
    for (const s of [-1, 1]) {
      const track = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.75, 3.3), treadMat);
      track.position.set(s * 1.32, 0.42, 0);
      track.castShadow = track.receiveShadow = true;
      this.group.add(track);
    }
    // 前/后装甲坡
    const slopeF = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.3, 0.5), darkMat);
    slopeF.position.set(0, 0.82, -1.62);
    this.group.add(slopeF);

    // 炮塔
    this.turret = new THREE.Group();
    this.turret.position.y = 1.42;
    const domeMat = hullMat;
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.55, 12), domeMat);
    dome.castShadow = true;
    this.turret.add(dome);
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 0.28, 10), darkMat);
    hatch.position.set(-0.15, 0.4, -0.2);
    this.turret.add(hatch);
    // 炮管（建在本地 -Z 侧：worldTurretYaw=a 时本地 -Z → 世界 (-sin a, -cos a)，
    // 与 turretForward() 及弹道同向，保证可见炮管指向射击方向）
    const bMat = new THREE.MeshStandardMaterial({ map: BARREL.map, bumpMap: BARREL.bump, bumpScale: 0.08, roughness: 0.45, metalness: 0.7 });
    this.mats.push(bMat);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.15, 2.7, 10), bMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.1, -2.05);
    barrel.castShadow = true;
    this.turret.add(barrel);
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.4, 10), darkMat);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.1, -3.3);
    this.turret.add(muzzle);
    this.muzzle = muzzle;
    this.group.add(this.turret);

    // 血条（sprite）
    this.hpBar = this._makeHpBar();
    this.hpBar.position.set(0, 3.1, 0);
    this.group.add(this.hpBar);
  }

  _makeHpBar() {
    const c = document.createElement('canvas');
    c.width = 96; c.height = 14;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    s.scale.set(2.2, 0.3, 1);
    s.userData.ctx = c.getContext('2d');
    return s;
  }

  setHpFrac(f) {
    const ctx = this.hpBar.userData.ctx;
    ctx.clearRect(0, 0, 96, 14);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(1, 1, 94, 12);
    ctx.fillStyle = f > 0.5 ? '#54d164' : f > 0.25 ? '#e0b83e' : '#e04b3e';
    ctx.fillRect(3, 3, 90 * Math.max(0, f), 8);
    this.hpBar.material.map.needsUpdate = true;
  }

  worldTurretYaw() {
    // 关键：世界角 = 车体 yaw + 炮塔局部 yaw（R2 保留 R1 修复）
    return this.group.rotation.y + this.turret.rotation.y;
  }
  setWorldTurretYaw(a) {
    this.turret.rotation.y = a - this.group.rotation.y;
  }

  turretForward() {
    const a = this.worldTurretYaw();
    return new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a));
  }

  hitFlash(t = 0.14) { this.flashT = t; }
  update(dt) {
    this.group.position.y = 0;
    if (this.flashT > 0) {
      this.flashT -= dt;
      const e = this.flashT > 0 ? 0.9 : 0;
      for (const m of this.mats) m.emissive?.setRGB(e, e * 0.3, e * 0.2);
    } else if (this.mats.some((m) => m.emissive && m.emissive.r > 0)) {
      for (const m of this.mats) m.emissive?.setRGB(0, 0, 0);
    }
    // 出生闪烁
    if (this.blinkT > 0) {
      this.blinkT -= dt;
      this.group.visible = Math.floor(this.blinkT * 8) % 2 === 0;
      if (this.blinkT <= 0) this.group.visible = true;
    }
  }
  setSpawnBlink(t) { this.blinkT = t; }
  get pos() { return this.group.position; }
  dispose(scene) {
    scene.remove(this.group);
    for (const m of this.mats) m.dispose();
  }
}
