/**
 * 障碍 / 环境元素：
 *  - 'rock'  : 悬崖突石 / 枯木，碰撞扣能量并打断 combo
 *  - 'thermal': 上升气流（视觉光柱），进入后向前加速、回复微量能量
 *  - 'turbulence': 逆风/雷暴，使控制产生偏移
 */
import * as THREE from 'three';

export type ObstacleKind = 'rock' | 'thermal' | 'turbulence';

export class Obstacle {
  public readonly group: THREE.Group;
  public kind: ObstacleKind = 'rock';
  public active = false;
  public collideRadius = 1.0;

  private mesh!: THREE.Mesh;
  private pillar?: THREE.Mesh; // thermal 光柱
  private spin = 0;

  private static rockMat = new THREE.MeshStandardMaterial({
    color: 0x3a2e2a,
    flatShading: true,
    roughness: 0.95
  });
  private static thermalMat = new THREE.MeshBasicMaterial({
    color: 0x66ffd0,
    transparent: true,
    opacity: 0.25,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  private static turbMat = new THREE.MeshStandardMaterial({
    color: 0x4a3a6a,
    emissive: 0x2a1a4a,
    emissiveIntensity: 0.6,
    flatShading: true,
    transparent: true,
    opacity: 0.7
  });

  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;
  }

  public spawn(x: number, y: number, z: number, kind: ObstacleKind) {
    this.kind = kind;
    this.group.position.set(x, y, z);
    this.group.visible = true;
    this.active = true;
    this.buildForKind(kind);
  }

  private buildForKind(kind: ObstacleKind) {
    // 清理旧 mesh
    while (this.group.children.length > 0) {
      const c = this.group.children[0];
      this.group.remove(c);
      if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry.dispose();
    }
    this.pillar = undefined;

    if (kind === 'rock') {
      const geo = new THREE.DodecahedronGeometry(1.4 + Math.random() * 0.8, 0);
      this.mesh = new THREE.Mesh(geo, Obstacle.rockMat);
      this.mesh.rotation.set(Math.random(), Math.random(), Math.random());
      this.collideRadius = 1.6;
      this.group.add(this.mesh);
    } else if (kind === 'thermal') {
      const geo = new THREE.CylinderGeometry(2.2, 2.2, 60, 16, 1, true);
      this.pillar = new THREE.Mesh(geo, Obstacle.thermalMat);
      this.pillar.position.y = 30;
      this.group.add(this.pillar);
      this.collideRadius = 2.0;
    } else {
      // turbulence：扭曲的暗紫云团
      const geo = new THREE.IcosahedronGeometry(2.4, 0);
      this.mesh = new THREE.Mesh(geo, Obstacle.turbMat);
      this.group.add(this.mesh);
      this.collideRadius = 2.2;
    }
  }

  public update(dt: number) {
    if (!this.active) return;
    this.spin += dt;
    if (this.kind === 'thermal' && this.pillar) {
      this.pillar.rotation.y += dt * 1.5;
      const m = this.pillar.material as THREE.MeshBasicMaterial;
      m.opacity = 0.18 + Math.sin(this.spin * 3) * 0.08;
    } else if (this.kind === 'turbulence' && this.mesh) {
      this.mesh.rotation.y += dt * 2.0;
      this.mesh.rotation.z += dt * 1.2;
    } else if (this.mesh) {
      this.mesh.rotation.y += dt * 0.5;
    }
  }

  public recycle() {
    this.active = false;
    this.group.visible = false;
  }

  public get position(): THREE.Vector3 {
    return this.group.position;
  }
}
