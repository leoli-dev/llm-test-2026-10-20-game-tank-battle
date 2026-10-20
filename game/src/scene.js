// 3D 场景环境：白天光照 + 贴地图面 + 边界钢墙
import * as THREE from 'three';
import { WORLD, GRID } from './level.js';
import { groundTexture, steelTexture } from './textures.js';

export function buildScene() {
  const group = new THREE.Group();

  const bg = new THREE.Color(0x9fb4c7);
  const fog = new THREE.Fog(bg, 70, 190);

  const hemi = new THREE.HemisphereLight(0xdfeaf5, 0x565844, 1.15);
  group.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1d6, 1.9);
  sun.position.set(38, 64, 26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 160;
  sun.shadow.bias = -0.0006;
  group.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(0xcfd8e8, 0.35);
  fill.position.set(-30, 30, -20);
  group.add(fill);

  // 外部大地
  const outer = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshStandardMaterial({ color: 0x4c513d, roughness: 1 })
  );
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.02;
  outer.receiveShadow = true;
  group.add(outer);

  // 战场地面（贴图 + bump）
  const gt = groundTexture();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD, WORLD),
    new THREE.MeshStandardMaterial({ map: gt.map, bumpMap: gt.bump, bumpScale: 0.35, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(WORLD / 2, 0, WORLD / 2);
  ground.receiveShadow = true;
  group.add(ground);

  // 边界钢墙
  const st = steelTexture();
  const wallMat = new THREE.MeshStandardMaterial({ map: st.map, bumpMap: st.bump, bumpScale: 0.15, roughness: 0.45, metalness: 0.55 });
  const t = 4, h = 2.6, off = 2;
  const mkWall = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, h / 2, z);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };
  mkWall(WORLD + t * 2, t, WORLD / 2, -off);          // 北
  mkWall(WORLD + t * 2, t, WORLD / 2, WORLD + off);   // 南
  mkWall(t, WORLD, -off, WORLD / 2);                  // 西
  mkWall(t, WORLD, WORLD + off, WORLD / 2);           // 东
  void GRID;

  return { group, fog, sun };
}
