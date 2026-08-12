/**
 * 雨燕玩家实体：加载外部 GLB 模型（火烈鸟）+ 姿态控制 + 翅膀扇动动画。
 * 若模型未就绪则回退到 low-poly 程序化鸟形。
 */
import * as THREE from 'three';
import { clamp, lerp, smooth01 } from '../utils/MathUtils';

export class Swift {
  public readonly group: THREE.Group;
  public readonly position: THREE.Vector3;
  public readonly quaternion: THREE.Quaternion;
  public readonly velocity: THREE.Vector3;
  /** 碰撞半径（包裹整个雨燕的包围球） */
  public readonly collideRadius: number;

  // 模型模式（GLB）vs 程序化模式
  private useModel = false;
  private mixer: THREE.AnimationMixer | null = null; // GLB 模型飞行动画
  private flapAction: THREE.AnimationAction | null = null;

  // 程序化模式专用
  private body!: THREE.Mesh;
  private leftWing!: THREE.Mesh;
  private rightWing!: THREE.Mesh;

  private trail!: THREE.Mesh;

  // 控制状态
  private yaw = 0; // 转向累积
  private bank = 0; // 视觉侧倾
  private pitchVis = 0; // 视觉俯仰
  private wingPhase = 0;
  private baseSpeed = 26; // m/s 前向
  public speed = 26;

  // 拖尾：流动极光帘幕（多垂直分段，呈现真正极光帘幕形态）
  private trailPositions: Float32Array; // 路径点环形缓冲
  private trailCount = 96;
  private acrossCount = 6; // 帘幕垂直分段（>2 才能呈现波动边缘与射线感）
  private trailCursor = 0;
  private trailWritten = 0;
  private trailTimer = 0;
  private ribbonVerts: Float32Array;
  private ribbonUvs: Float32Array;
  private ribbonIndices: Uint16Array;
  private ribbonUniforms: { uTime: { value: number } };

  // 临时变量复用（避免 update 中 new，消除 GC 抖动）
  private tmpEuler = new THREE.Euler();
  private tmpEulerYaw = new THREE.Euler();
  private tmpQuat = new THREE.Quaternion();
  private tmpRight = new THREE.Vector3();
  private tmpForward = new THREE.Vector3(0, 0, -1);

  constructor(model?: THREE.Group, animations?: THREE.AnimationClip[]) {
    this.group = new THREE.Group();
    this.position = this.group.position;
    this.quaternion = this.group.quaternion;
    this.velocity = new THREE.Vector3(0, 0, -this.baseSpeed);
    this.trailPositions = new Float32Array(this.trailCount * 3);
    this.ribbonVerts = new Float32Array(this.trailCount * this.acrossCount * 3);
    this.ribbonUvs = new Float32Array(this.trailCount * this.acrossCount * 2);
    this.ribbonIndices = new Uint16Array((this.trailCount - 1) * (this.acrossCount - 1) * 6);
    this.ribbonUniforms = { uTime: { value: 0 } };

    if (model) {
      this.setupModel(model, animations);
      this.useModel = true;
      // GLB 火烈鸟模型缩放 0.025 后约 1.3×2.2×4.4，包围球半径约 2.5
      this.collideRadius = 2.5;
    } else {
      this.buildProceduralMesh();
      // 程序化雨燕约 1.1×0.8×2.4，包围球半径约 1.4
      this.collideRadius = 1.4;
    }
    this.buildTrail();
  }

  /** 使用外部 GLB 模型 */
  private setupModel(model: THREE.Group, animations?: THREE.AnimationClip[]) {
    // 火烈鸟模型默认朝 +Z，需旋转 180° 使喙朝 -Z（飞行方向）
    model.rotation.y = Math.PI;
    // 原始模型边界约 52×89×177，缩放至约 1.3×2.2×4.4
    model.scale.setScalar(0.025);
    // 模型几何中心偏下，上移使身体中心对齐原点
    model.position.y = 0.85;
    this.group.add(model);

    // 播放模型内置的飞行动画（通过 morphTarget 权重驱动翅膀扇动）
    if (animations && animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(model);
      this.flapAction = this.mixer.clipAction(animations[0]);
      this.flapAction.play();
    }

    // 光晕已移除
  }

  /** GLB 模型模式：通过 morphTarget 驱动翅膀 */
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

    // 光晕已移除
  }

  private buildTrail() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.ribbonVerts, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.ribbonUvs, 2));
    // 预构建帘幕网格索引（静态），通过 drawRange 控制有效段数
    // 每个长度段内，acrossCount-1 个四边 → 每段 (acrossCount-1)*6 个索引
    const A = this.acrossCount;
    for (let i = 0; i < this.trailCount - 1; i++) {
      for (let j = 0; j < A - 1; j++) {
        const a = i * A + j;
        const b = i * A + j + 1;
        const c = (i + 1) * A + j;
        const d = (i + 1) * A + j + 1;
        const idx = (i * (A - 1) + j) * 6;
        this.ribbonIndices[idx] = a;
        this.ribbonIndices[idx + 1] = b;
        this.ribbonIndices[idx + 2] = c;
        this.ribbonIndices[idx + 3] = b;
        this.ribbonIndices[idx + 4] = d;
        this.ribbonIndices[idx + 5] = c;
      }
    }
    geo.setIndex(new THREE.BufferAttribute(this.ribbonIndices, 1));
    geo.setDrawRange(0, 0);

    // 极光着色器：帘幕波动 + 垂直射线 + 多层流动色 + 边缘柔化
    const mat = new THREE.ShaderMaterial({
      uniforms: this.ribbonUniforms,
      vertexShader: /* glsl */`
        varying vec2 vUv;
        uniform float uTime;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
          return v;
        }

        void main() {
          vUv = uv;
          vec3 pos = position;
          // 水平条带上下起伏：左右边缘振幅大，中部稳定，营造极光飘动
          float across = uv.y;
          float edgeFactor = abs(across - 0.5) * 2.0; // 0=中 1=边
          float wave = sin(uv.x * 14.0 + uTime * 1.4 + across * 6.0) * 0.10;
          wave += sin(uv.x * 7.0 - uTime * 0.9 + across * 3.0) * 0.12;
          wave += (fbm(vec2(uv.x * 8.0 + uTime * 0.4, across * 4.0)) - 0.5) * 0.28;
          pos.y += wave * (0.4 + edgeFactor * 0.6);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        uniform float uTime;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
          return v;
        }

        void main() {
          float along = vUv.x;   // 0=尾(旧) 1=头(新)
          float across = vUv.y;  // 0=左 1=右

          // 条带横向形态：中部最亮，左右边缘淡出
          float vert = 1.0 - abs(across - 0.5) * 2.0;

          // 边缘波动 mask：让左右边缘呈现不规则波浪状
          float edgeWave = fbm(vec2(along * 10.0 + uTime * 0.6, across * 4.0 + uTime * 0.3));
          float edgeMask = smoothstep(0.0, 0.28 + edgeWave * 0.22, vert);

          // 多层流动噪声：起伏 + 细节
          float n1 = fbm(vec2(along * 5.0 + uTime * 0.3, across * 3.0 + uTime * 0.2));
          float n2 = fbm(vec2(along * 14.0 - uTime * 0.5, across * 2.0 - uTime * 0.15));

          // 沿长度方向的流动亮纹（极光射线感）
          float rays = 0.5 + 0.5 * sin(along * 26.0 - uTime * 2.2 + n2 * 6.0 + across * 2.0);
          rays = pow(rays, 5.0) * 0.5;

          // 极光配色：绿 → 青 → 紫 → 品红，沿长度流动
          float phase = along * 1.8 - uTime * 0.15 + n1 * 0.6;
          float t = fract(phase);
          vec3 col1 = vec3(0.20, 1.00, 0.60); // 翠绿
          vec3 col2 = vec3(0.30, 0.85, 1.00); // 青
          vec3 col3 = vec3(0.65, 0.40, 1.00); // 紫
          vec3 col4 = vec3(1.00, 0.45, 0.75); // 品红
          vec3 color;
          if (t < 0.333) color = mix(col1, col2, t / 0.333);
          else if (t < 0.666) color = mix(col2, col3, (t - 0.333) / 0.333);
          else color = mix(col3, col4, (t - 0.666) / 0.334);

          color *= 1.3 + n2 * 0.5 + rays;

          // 头部接缝柔化 + 尾部淡出
          float fade = smoothstep(0.0, 0.18, along) * smoothstep(1.0, 0.92, along);

          float alpha = edgeMask * fade * (0.45 + n1 * 0.55 + rays * 0.5);
          alpha = clamp(alpha, 0.0, 1.0);
          if (alpha < 0.005) discard;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });

    this.trail = new THREE.Mesh(geo, mat);
    this.trail.frustumCulled = false;
    // trail 由 Game 单独加入 scene
  }

  /** 重建极光条带几何（水平展开，每点生成 acrossCount 个左右分段顶点） */
  private rebuildRibbon() {
    const N = this.trailCount;
    const A = this.acrossCount;
    const valid = Math.min(this.trailWritten, N);
    if (valid < 2) return;
    // 与雨燕身体（不含翅膀）宽度相当，半宽 ~0.5 → 全宽 ~1.0
    const maxWidth = 0.5;

    for (let i = 0; i < valid; i++) {
      // 按年龄顺序取路径点：oldest → newest
      const pi = this.trailWritten < N ? i : (this.trailCursor + i) % N;
      const px = this.trailPositions[pi * 3];
      const py = this.trailPositions[pi * 3 + 1];
      const pz = this.trailPositions[pi * 3 + 2];

      // 切线（中心差分，端点用单侧差分）
      let tx: number, ty: number, tz: number;
      const ni = (pi + 1) % N;
      const pim = (pi - 1 + N) % N;
      if (i === 0) {
        tx = this.trailPositions[ni * 3] - px;
        ty = this.trailPositions[ni * 3 + 1] - py;
        tz = this.trailPositions[ni * 3 + 2] - pz;
      } else if (i === valid - 1) {
        tx = px - this.trailPositions[pim * 3];
        ty = py - this.trailPositions[pim * 3 + 1];
        tz = pz - this.trailPositions[pim * 3 + 2];
      } else {
        tx = this.trailPositions[ni * 3] - this.trailPositions[pim * 3];
        ty = this.trailPositions[ni * 3 + 1] - this.trailPositions[pim * 3 + 1];
        tz = this.trailPositions[ni * 3 + 2] - this.trailPositions[pim * 3 + 2];
      }
      const tlen = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tlen > 1e-4) { tx /= tlen; ty /= tlen; tz /= tlen; }
      else { tx = 0; ty = 0; tz = -1; }

      // 偏移方向：水平面内垂直于飞行方向（tangent × worldUp，取水平分量）
      // cross(tangent, up=(0,1,0)) = (-tz, 0, tx)
      let ox = -tz;
      let oy = 0;
      let oz = tx;
      const olen = Math.sqrt(ox * ox + oz * oz);
      if (olen > 1e-4) { ox /= olen; oz /= olen; }
      else { ox = 1; oz = 0; } // 垂直俯冲退化方向

      // 沿长度宽度渐变：尾部细 → 中部宽 → 头部略收，避免接缝硬边
      const along = valid > 1 ? i / (valid - 1) : 0;
      const taper = smooth01(0.0, 0.18, along) * (0.75 + 0.25 * smooth01(1.0, 0.7, along));
      const halfWidth = maxWidth * taper;

      // 每个 across 分段顶点
      for (let j = 0; j < A; j++) {
        const acrossFrac = j / (A - 1);          // 0..1
        const acrossCoord = acrossFrac * 2 - 1;   // -1..1
        const w = acrossCoord * halfWidth;
        const vi = (i * A + j) * 3;
        this.ribbonVerts[vi] = px + ox * w;
        this.ribbonVerts[vi + 1] = py + oy * w;
        this.ribbonVerts[vi + 2] = pz + oz * w;
        const ui = (i * A + j) * 2;
        this.ribbonUvs[ui] = along;
        this.ribbonUvs[ui + 1] = acrossFrac;
      }
    }

    const geo = this.trail.geometry;
    geo.setDrawRange(0, (valid - 1) * (A - 1) * 6);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.uv.needsUpdate = true;
  }

  get trailMesh(): THREE.Mesh {
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
    for (let i = 0; i < this.ribbonVerts.length; i++) this.ribbonVerts[i] = 0;
    this.trailCursor = 0;
    this.trailWritten = 0;
    this.trailTimer = 0;
    this.trail.geometry.setDrawRange(0, 0);
    this.trail.visible = true;
  }

  /** 更新姿态与位置 */
  public update(
    dt: number,
    pitch: number, // -1 拉升 ~ 1 俯冲
    roll: number, // -1 左 ~ 1 右
    glideActive: boolean,
    invincible: boolean
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
    const verticalVel = -pitch * 18 - Math.abs(roll) * 2.0;
    // 滑翔时大幅降低下坠
    const glideFactor = glideActive ? 0.35 : 1.0;

    // 构造朝向
    // pitch: 正=俯冲(下键) → 机头下压；负=拉升(上键) → 机头上抬
    // roll:  正=右飞 → 右倾；负=左飞 → 左倾
    //   - 程序化模型：翅膀与坐标轴一致，Z 旋转取 -roll
    //   - GLB 模型：local rotation.y=π 翻转了 X 轴(左右翅膀互换)，Z 旋转取 +roll
    const rollSign = this.useModel ? 1 : -1;
    this.tmpEuler.set(-pitch * 0.5, this.yaw, rollSign * roll * 0.6, 'YXZ');
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
    this.pitchVis = lerp(this.pitchVis, -pitch * 0.5, Math.min(1, dt * 6));

    // 翅膀扇动
    this.wingPhase += dt * this.flapSpeed(pitch, glideActive);

    if (this.useModel) {
      // 推进 GLB 模型内置飞行动画（morphTarget 权重关键帧）
      this.mixer?.update(dt);
      // 滑翔时减慢扇动频率以呈现滑翔姿态
      if (this.flapAction) {
        this.flapAction.timeScale = glideActive ? 0.3 : 1.0;
      }
    } else {
      this.animateProceduralWings(pitch, glideActive);
    }

    // 速度向量（用于碰撞与跟随）
    this.velocity.set(0, verticalVel * glideFactor, 0).addScaledVector(this.tmpForward, this.speed);

    // 拖尾：采样路径点 + 重建极光条带
    this.trailTimer += dt;
    if (this.trailTimer > 0.016) {
      this.trailTimer = 0;
      const i3 = this.trailCursor * 3;
      this.trailPositions[i3] = this.position.x;
      this.trailPositions[i3 + 1] = this.position.y;
      this.trailPositions[i3 + 2] = this.position.z + 1.0;
      this.trailCursor = (this.trailCursor + 1) % this.trailCount;
      if (this.trailWritten < this.trailCount) this.trailWritten++;
      this.rebuildRibbon();
    }
    this.ribbonUniforms.uTime.value += dt;

    // 闪避无敌时闪烁
    this.group.visible = invincible ? Math.floor(this.wingPhase * 6) % 2 !== 0 : true;
  }

  private flapSpeed(pitch: number, glideActive: boolean): number {
    const flapSpeed = 6 + Math.max(0, -pitch) * 8 + (glideActive ? -4 : 0);
    return Math.max(2, flapSpeed);
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
