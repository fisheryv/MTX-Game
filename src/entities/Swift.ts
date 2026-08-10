/**
 * 雨燕玩家实体：加载外部 GLB 模型（火烈鸟）+ 姿态控制 + 翅膀扇动动画。
 * 若模型未就绪则回退到 low-poly 程序化鸟形。
 */
import * as THREE from 'three';
import { clamp, lerp } from '../utils/MathUtils';

export class Swift {
  public readonly group: THREE.Group;
  public readonly position: THREE.Vector3;
  public readonly quaternion: THREE.Quaternion;
  public readonly velocity: THREE.Vector3;

  // 模型模式（GLB）vs 程序化模式
  private useModel = false;
  private morphMesh: THREE.Mesh | null = null; // 带有 morphTarget 的网格

  // 程序化模式专用
  private body!: THREE.Mesh;
  private leftWing!: THREE.Mesh;
  private rightWing!: THREE.Mesh;

  private trail!: THREE.Points;

  // 控制状态
  private yaw = 0; // 转向累积
  private bank = 0; // 视觉侧倾
  private pitchVis = 0; // 视觉俯仰
  private wingPhase = 0;
  private baseSpeed = 26; // m/s 前向
  public speed = 26;

  // 拖尾粒子
  private trailPositions: Float32Array;
  private trailCount = 60;
  private trailCursor = 0;
  private trailTimer = 0;

  // 临时变量复用（避免 update 中 new，消除 GC 抖动）
  private tmpEuler = new THREE.Euler();
  private tmpEulerYaw = new THREE.Euler();
  private tmpQuat = new THREE.Quaternion();
  private tmpRight = new THREE.Vector3();
  private tmpForward = new THREE.Vector3(0, 0, -1);

  constructor(model?: THREE.Group) {
    this.group = new THREE.Group();
    this.position = this.group.position;
    this.quaternion = this.group.quaternion;
    this.velocity = new THREE.Vector3(0, 0, -this.baseSpeed);
    this.trailPositions = new Float32Array(this.trailCount * 3);

    if (model) {
      this.setupModel(model);
      this.useModel = true;
    } else {
      this.buildProceduralMesh();
    }
    this.buildTrail();
  }

  /** 使用外部 GLB 模型 */
  private setupModel(model: THREE.Group) {
    // 火烈鸟模型默认朝 +Z，需旋转 180° 使喙朝 -Z（飞行方向）
    model.rotation.y = Math.PI;
    // 原始模型边界约 52×89×177，缩放至约 1.3×2.2×4.4
    model.scale.setScalar(0.025);
    // 模型几何中心偏下，上移使身体中心对齐原点
    model.position.y = 0.85;
    this.group.add(model);

    // 查找带有 morphTarget 的网格用于翅膀动画
    model.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        child.morphTargetDictionary &&
        child.morphTargetInfluences
      ) {
        this.morphMesh = child;
      }
    });

    // 光晕（受能量影响）
    const glowGeo = new THREE.SphereGeometry(1.2, 16, 12);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x6ad0ff,
      transparent: true,
      opacity: 0.18,
      side: THREE.BackSide
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.name = 'glow';
    this.group.add(glow);
  }

  /** 程序化 low-poly 鸟形（回退方案） */
  private buildProceduralMesh() {
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a22,
      flatShading: true,
      metalness: 0.1,
      roughness: 0.6
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x6ad0ff,
      flatShading: true,
      emissive: 0x1a4060,
      emissiveIntensity: 0.4
    });

    // 身体：拉长的椭球
    const bodyGeo = new THREE.IcosahedronGeometry(0.55, 1);
    bodyGeo.scale(1.0, 0.7, 1.8);
    this.body = new THREE.Mesh(bodyGeo, bodyMat);
    this.group.add(this.body);

    // 头
    const headGeo = new THREE.IcosahedronGeometry(0.4, 0);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.set(0, 0.08, -0.95);
    this.group.add(head);

    // 喙
    const beakGeo = new THREE.ConeGeometry(0.12, 0.4, 6);
    const beak = new THREE.Mesh(beakGeo, accentMat);
    beak.rotation.x = -Math.PI / 2;
    beak.position.set(0, 0.05, -1.35);
    this.group.add(beak);

    // 尾羽（分叉）
    const tailGeo = new THREE.ConeGeometry(0.18, 0.9, 4);
    const tailMat = new THREE.MeshStandardMaterial({
      color: 0x4aa0e0,
      flatShading: true,
      emissive: 0x103050,
      emissiveIntensity: 0.3
    });
    const tailL = new THREE.Mesh(tailGeo, tailMat);
    tailL.position.set(-0.2, 0, 1.0);
    tailL.rotation.set(Math.PI / 2, 0, 0.4);
    this.group.add(tailL);
    const tailR = new THREE.Mesh(tailGeo, tailMat);
    tailR.position.set(0.2, 0, 1.0);
    tailR.rotation.set(Math.PI / 2, 0, -0.4);
    this.group.add(tailR);

    // 翅膀（左右各一，可旋转）
    const wingGeo = new THREE.ConeGeometry(0.5, 2.2, 3);
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a36,
      flatShading: true,
      side: THREE.DoubleSide
    });
    this.leftWing = new THREE.Mesh(wingGeo, wingMat);
    this.leftWing.position.set(-1.0, 0.1, 0);
    this.leftWing.rotation.set(0, 0, Math.PI / 2);
    this.leftWing.scale.set(1, 1.6, 0.4);
    this.group.add(this.leftWing);

    this.rightWing = new THREE.Mesh(wingGeo, wingMat);
    this.rightWing.position.set(1.0, 0.1, 0);
    this.rightWing.rotation.set(0, 0, -Math.PI / 2);
    this.rightWing.scale.set(1, 1.6, 0.4);
    this.group.add(this.rightWing);

    // 光晕（受能量影响）
    const glowGeo = new THREE.SphereGeometry(1.2, 16, 12);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x6ad0ff,
      transparent: true,
      opacity: 0.18,
      side: THREE.BackSide
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.name = 'glow';
    this.group.add(glow);
  }

  private buildTrail() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x6ad0ff,
      size: 0.6,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.trail = new THREE.Points(geo, mat);
    this.trail.frustumCulled = false;
    // 初始化位置都为雨燕起点，避免远处飞点
    for (let i = 0; i < this.trailCount; i++) {
      this.trailPositions[i * 3] = 0;
      this.trailPositions[i * 3 + 1] = 0;
      this.trailPositions[i * 3 + 2] = 0;
    }
    // trail 由 Game 单独加入 scene
  }

  get trailPoints(): THREE.Points {
    return this.trail;
  }

  public reset() {
    this.position.set(0, 8, 0);
    this.quaternion.identity();
    this.yaw = 0;
    this.bank = 0;
    this.pitchVis = 0;
    this.speed = this.baseSpeed;
    this.velocity.set(0, 0, -this.baseSpeed);
    for (let i = 0; i < this.trailPositions.length; i++) this.trailPositions[i] = 0;
  }

  /** 更新姿态与位置 */
  public update(
    dt: number,
    pitch: number, // -1 拉升 ~ 1 俯冲
    roll: number, // -1 左 ~ 1 右
    glideActive: boolean,
    invincible: boolean,
    energyRatio: number
  ) {
    // 俯冲加速，拉升减速
    const speedTarget =
      this.baseSpeed + pitch * 14 + (glideActive ? -10 : 0);
    this.speed = lerp(this.speed, clamp(speedTarget, 8, 60), dt * 1.5);

    // 转向：roll 决定偏航速率
    const yawRate = roll * 0.9; // rad/s
    this.yaw += yawRate * dt;

    // 垂直方向：pitch 正 -> 俯冲 -> y 下降；负 -> 拉升 -> y 上升
    // 同时受 roll 影响产生轻微下坠以增加手感
    const verticalVel = pitch * 18 - Math.abs(roll) * 2.0;
    // 滑翔时大幅降低下坠
    const glideFactor = glideActive ? 0.35 : 1.0;

    // 构造朝向
    this.tmpEuler.set(pitch * 0.5, this.yaw, -roll * 0.6, 'YXZ');
    this.tmpQuat.setFromEuler(this.tmpEuler);
    this.quaternion.slerp(this.tmpQuat, Math.min(1, dt * 6));

    // 前向方向（朝 -Z 再绕 yaw），复用 tmpEulerYaw
    this.tmpEulerYaw.set(0, this.yaw, 0, 'YXZ');
    this.tmpForward.set(0, 0, -1).applyEuler(this.tmpEulerYaw);
    this.position.addScaledVector(this.tmpForward, this.speed * dt);
    this.position.y += verticalVel * dt * glideFactor;

    // 限制高度区间，避免飞出场景
    if (this.position.y > 60) this.position.y = 60;
    if (this.position.y < -10) this.position.y = -10;

    // 视觉姿态
    this.bank = lerp(this.bank, -roll * 0.7, Math.min(1, dt * 8));
    this.pitchVis = lerp(this.pitchVis, pitch * 0.5, Math.min(1, dt * 6));

    // 翅膀扇动
    this.wingPhase += dt * this.flapSpeed(pitch, glideActive);

    if (this.useModel) {
      this.animateModelWings(glideActive);
    } else {
      this.animateProceduralWings(pitch, glideActive);
    }

    // 速度向量（用于碰撞与跟随）
    this.velocity.set(0, verticalVel * glideFactor, 0).addScaledVector(this.tmpForward, this.speed);

    // 拖尾
    this.trailTimer += dt;
    if (this.trailTimer > 0.03) {
      this.trailTimer = 0;
      const i = this.trailCursor * 3;
      this.trailPositions[i] = this.position.x;
      this.trailPositions[i + 1] = this.position.y;
      this.trailPositions[i + 2] = this.position.z + 1.2;
      this.trailCursor = (this.trailCursor + 1) % this.trailCount;
      (this.trail.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }

    // 光晕颜色随能量
    const glow = this.group.getObjectByName('glow') as THREE.Mesh | undefined;
    if (glow) {
      const mat = glow.material as THREE.MeshBasicMaterial;
      const hue = 0.55 + energyRatio * 0.08; // 蓝 -> 青
      (mat.color as THREE.Color).setHSL(hue, 0.8, 0.6);
      mat.opacity = 0.12 + energyRatio * 0.2;
      glow.visible = !invincible ? true : Math.floor(this.wingPhase * 4) % 2 === 0;
    }

    // 闪避无敌时闪烁
    this.group.visible = invincible ? Math.floor(this.wingPhase * 6) % 2 !== 0 : true;
  }

  private flapSpeed(pitch: number, glideActive: boolean): number {
    const flapSpeed = 6 + Math.max(0, -pitch) * 8 + (glideActive ? -4 : 0);
    return Math.max(2, flapSpeed);
  }

  /** GLB 模型模式：通过 morphTarget 驱动翅膀 */
  private animateModelWings(glideActive: boolean) {
    if (this.morphMesh && this.morphMesh.morphTargetInfluences) {
      // morphTargetInfluences[0] 控制翅膀上挥（0=收拢 1=展开）
      const flap = Math.sin(this.wingPhase) * (glideActive ? 0.3 : 0.8) * 0.5 + 0.5;
      this.morphMesh.morphTargetInfluences[0] = flap;
    }
  }

  /** 程序化模式：旋转翅膀网格 */
  private animateProceduralWings(pitch: number, glideActive: boolean) {
    const flap = Math.sin(this.wingPhase) * (glideActive ? 0.2 : 0.8);
    this.leftWing.rotation.x = flap;
    this.rightWing.rotation.x = flap;
    this.body.rotation.z = this.bank * 0.3;
    void pitch;
  }

  /** 紧急闪避：瞬时侧移 */
  public dodge(direction: number) {
    this.tmpEulerYaw.set(0, this.yaw, 0, 'YXZ');
    this.tmpRight.set(1, 0, 0).applyEuler(this.tmpEulerYaw);
    this.position.addScaledVector(this.tmpRight, direction * 3.0);
    this.bank = -direction * 1.0;
  }
}
