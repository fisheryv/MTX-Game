/**
 * 星芒金币：散落在天空，用于局外养成。
 * 视觉：金色圆盘硬币 + 浮雕五角星，缓慢自转。
 */
import * as THREE from 'three';

export class Coin {
  public readonly mesh: THREE.Group;
  public active = false;
  /** 碰撞半径（包裹硬币的包围球，半径 0.42 + 厚度/2） */
  public readonly collideRadius = 0.5;
  private spin = 0;

  private static discGeo: THREE.CylinderGeometry;
  private static starGeo: THREE.ExtrudeGeometry;
  private static edgeGeo: THREE.TorusGeometry;
  private static mat: THREE.MeshStandardMaterial;

  static {
    // 硬币圆盘
    Coin.discGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.09, 32);

    // 硬币边缘齿纹环
    Coin.edgeGeo = new THREE.TorusGeometry(0.42, 0.025, 8, 32);

    // 浮雕五角星
    const starShape = new THREE.Shape();
    const outerR = 0.22;
    const innerR = outerR * 0.4;
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) starShape.moveTo(x, y);
      else starShape.lineTo(x, y);
    }
    starShape.closePath();
    Coin.starGeo = new THREE.ExtrudeGeometry(starShape, {
      depth: 0.04,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.015,
      bevelSegments: 2
    });

    Coin.mat = new THREE.MeshStandardMaterial({
      color: 0xffd75a,
      emissive: 0xff9020,
      emissiveIntensity: 0.6,
      metalness: 0.85,
      roughness: 0.25
    });
  }

  constructor() {
    this.mesh = new THREE.Group();

    // 内层组：竖放（圆盘面朝 ±Z），外层组负责绕垂直轴旋转
    const inner = new THREE.Group();
    inner.rotation.x = Math.PI / 2;

    // 硬币圆盘（默认轴沿 Y，竖放后轴沿 Z）
    const disc = new THREE.Mesh(Coin.discGeo, Coin.mat);
    inner.add(disc);

    // 边缘环
    const edge = new THREE.Mesh(Coin.edgeGeo, Coin.mat);
    edge.rotation.x = Math.PI / 2;
    inner.add(edge);

    // 正面五角星
    const starFront = new THREE.Mesh(Coin.starGeo, Coin.mat);
    starFront.position.set(0, 0.045, 0);
    starFront.rotation.x = -Math.PI / 2;
    inner.add(starFront);

    // 背面五角星
    const starBack = new THREE.Mesh(Coin.starGeo, Coin.mat);
    starBack.position.set(0, -0.045, 0);
    starBack.rotation.x = Math.PI / 2;
    inner.add(starBack);

    this.mesh.add(inner);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  public spawn(x: number, y: number, z: number) {
    this.mesh.position.set(x, y, z);
    this.mesh.visible = true;
    this.active = true;
    this.spin = Math.random() * Math.PI;
  }

  public update(dt: number) {
    if (!this.active) return;
    this.spin += dt * 3.0;
    // 硬币平放，绕垂直轴（Y）旋转
    this.mesh.rotation.y = this.spin;
    this.mesh.rotation.x = 0;
  }

  public recycle() {
    this.active = false;
    this.mesh.visible = false;
  }

  public get position(): THREE.Vector3 {
    return this.mesh.position;
  }
}
