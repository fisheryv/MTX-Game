/**
 * 节奏音符实体：八分音符（♪）造型，绕自身旋转。
 * 普通音符提供能量；金色音符提供更多能量并触发短时共振。
 */
import * as THREE from 'three';
import type { NoteKind } from '../types';

export class NoteItem {
  public readonly mesh: THREE.Group;
  public kind: NoteKind = 'normal';
  public active = false;
  public alive = true;

  private childMeshes: THREE.Mesh[] = [];

  private static normalMat = new THREE.MeshStandardMaterial({
    color: 0x9be8ff,
    emissive: 0x3aa0e0,
    emissiveIntensity: 0.9,
    metalness: 0.3,
    roughness: 0.4,
    side: THREE.DoubleSide
  });
  private static goldenMat = new THREE.MeshStandardMaterial({
    color: 0xffe27a,
    emissive: 0xffa030,
    emissiveIntensity: 1.0,
    metalness: 0.6,
    roughness: 0.3,
    side: THREE.DoubleSide
  });

  // 几何体只创建一次，所有实例共享
  private static headGeo: THREE.SphereGeometry;
  private static stemGeo: THREE.BoxGeometry;
  private static flagGeo: THREE.ExtrudeGeometry;

  static {
    // 音符头：扁椭球
    NoteItem.headGeo = new THREE.SphereGeometry(0.2, 16, 12);
    NoteItem.headGeo.scale(1.3, 0.7, 0.5);

    // 符干：细长方体
    NoteItem.stemGeo = new THREE.BoxGeometry(0.05, 0.85, 0.05);

    // 符尾（八分音符旗）：用 Shape + ExtrudeGeometry 构造弯曲旗帜
    const flagShape = new THREE.Shape();
    flagShape.moveTo(0, 0);
    flagShape.quadraticCurveTo(0.25, -0.05, 0.3, -0.2);
    flagShape.quadraticCurveTo(0.32, -0.3, 0.15, -0.38);
    flagShape.quadraticCurveTo(0.28, -0.28, 0.2, -0.12);
    flagShape.quadraticCurveTo(0.12, -0.02, 0, -0.04);
    flagShape.closePath();
    NoteItem.flagGeo = new THREE.ExtrudeGeometry(flagShape, {
      depth: 0.04,
      bevelEnabled: false
    });
  }

  constructor() {
    this.mesh = new THREE.Group();

    // 音符头（底部，略向左偏，微微倾斜）
    const head = new THREE.Mesh(NoteItem.headGeo, NoteItem.normalMat);
    head.position.set(-0.05, -0.35, 0);
    head.rotation.z = -0.3;
    this.mesh.add(head);
    this.childMeshes.push(head);

    // 符干（从音符头右侧向上延伸）
    const stem = new THREE.Mesh(NoteItem.stemGeo, NoteItem.normalMat);
    stem.position.set(0.18, 0.05, 0);
    this.mesh.add(stem);
    this.childMeshes.push(stem);

    // 符尾旗（在符干顶部）
    const flag = new THREE.Mesh(NoteItem.flagGeo, NoteItem.normalMat);
    flag.position.set(0.18, 0.48, -0.02);
    this.mesh.add(flag);
    this.childMeshes.push(flag);

    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  public spawn(x: number, y: number, z: number, kind: NoteKind) {
    this.kind = kind;
    const mat = kind === 'golden' ? NoteItem.goldenMat : NoteItem.normalMat;
    for (const m of this.childMeshes) m.material = mat;
    // 金色音符略大
    const s = kind === 'golden' ? 1.3 : 1.0;
    this.mesh.scale.setScalar(s);
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.visible = true;
    this.active = true;
    this.alive = true;
  }

  public update(dt: number, driftZ: number) {
    if (!this.active) return;
    this.mesh.rotation.y += dt * 2.0;
    this.mesh.rotation.x += dt * 1.2;
    // 轻微上下浮动
    this.mesh.position.y += Math.sin(performance.now() * 0.004 + this.mesh.position.x) * dt * 0.4;
    void driftZ;
  }

  public recycle() {
    this.active = false;
    this.alive = false;
    this.mesh.visible = false;
  }

  public get position(): THREE.Vector3 {
    return this.mesh.position;
  }
}
