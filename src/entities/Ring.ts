/**
 * 教学光环：由晨光构成的发光圆环，玩家需穿过。
 * 用于《序章》第二阶段的横向转向引导（S 形排布）。
 */
import * as THREE from 'three';

export class Ring {
  public readonly group: THREE.Group;
  public active = false;
  public passed = false;
  /** 穿环判定半径（环内可通过区域） */
  public readonly innerRadius = 3.2;

  private ringMesh: THREE.Mesh;
  private glowMesh: THREE.Mesh;
  private spin = 0;
  private baseColor = new THREE.Color(0xffd98a);

  private static ringGeo = new THREE.TorusGeometry(3.4, 0.28, 12, 48);
  private static glowGeo = new THREE.TorusGeometry(3.4, 0.7, 8, 48);

  constructor() {
    this.group = new THREE.Group();

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xffd98a,
      emissive: 0xffb347,
      emissiveIntensity: 1.2,
      metalness: 0.4,
      roughness: 0.3
    });
    this.ringMesh = new THREE.Mesh(Ring.ringGeo, ringMat);
    this.group.add(this.ringMesh);

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffca6a,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.glowMesh = new THREE.Mesh(Ring.glowGeo, glowMat);
    this.group.add(this.glowMesh);

    this.group.visible = false;
  }

  public spawn(x: number, y: number, z: number) {
    this.group.position.set(x, y, z);
    this.group.visible = true;
    this.active = true;
    this.passed = false;
    this.setPassed(false);
  }

  /** 标记为已穿过：变绿并增亮 */
  public setPassed(passed: boolean) {
    this.passed = passed;
    const ringMat = this.ringMesh.material as THREE.MeshStandardMaterial;
    if (passed) {
      ringMat.color.set(0x8affc0);
      ringMat.emissive.set(0x40ff90);
    } else {
      ringMat.color.copy(this.baseColor);
      ringMat.emissive.set(0xffb347);
    }
  }

  public update(dt: number) {
    if (!this.active) return;
    this.spin += dt;
    // 环面朝向 -Z（飞行方向），绕自身法线缓慢旋转
    this.ringMesh.rotation.z += dt * 0.6;
    const glowMat = this.glowMesh.material as THREE.MeshBasicMaterial;
    glowMat.opacity = 0.2 + Math.sin(this.spin * 2.5) * 0.08;
  }

  public recycle() {
    this.active = false;
    this.group.visible = false;
  }

  public get position(): THREE.Vector3 {
    return this.group.position;
  }
}
