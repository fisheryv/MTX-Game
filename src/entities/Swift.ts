/**
 * 雨燕玩家实体：加载外部 GLB 模型（swift1.glb 俯视展开雨燕）+ 姿态控制 + 扇动动画。
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
  private modelGroup: THREE.Group | null = null; // GLB 模型引用（用于姿态）
  private modelLeftWing: THREE.Object3D | null = null; // 分离出的左翅（pivot group）
  private modelRightWing: THREE.Object3D | null = null; // 分离出的右翅（pivot group）
  private leftWingBaseX = 0; // 左翅 pivot 基础 X 位置
  private rightWingBaseX = 0; // 右翅 pivot 基础 X 位置

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
      // swift1.glb 缩放 1.8 后约 3.4×0.4×1.9，对角线半长约 2.0
      this.collideRadius = 2.0;
    } else {
      this.buildProceduralMesh();
      // 程序化雨燕约 1.1×0.8×2.4，包围球半径约 1.4
      this.collideRadius = 1.4;
    }
    this.buildTrail();
  }

  /** 使用外部 GLB 模型（swift1.glb：俯视展开的雨燕） */
  private setupModel(model: THREE.Group, _animations?: THREE.AnimationClip[]) {
    // swift1.glb 原始尺寸 1.91(X翼展) × 0.21(Y薄) × 1.04(Z前后)
    // 模型默认头朝 +Z，需旋转 180° 使喙朝 -Z（飞行方向）
    model.rotation.y = Math.PI;
    // 缩放至翼展约 3.4、身长约 1.9，与程序化版本尺度接近
    model.scale.setScalar(1.8);
    // Y 非常薄，模型中心已在原点，无需上移
    model.position.y = 0;
    this.group.add(model);
    this.modelGroup = model;

    // 替换模型所有网格的材质为金色（Lambert 不依赖环境贴图）
    const goldMat = new THREE.MeshLambertMaterial({
      color: 0xffc940,
      emissive: 0xff8800,
      emissiveIntensity: 0.5,
      side: THREE.DoubleSide, // 双面渲染，避免翅膀法线方向不一致导致单面不可见
    });
    model.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.material = goldMat;
      }
    });

    // swift1.glb 是单网格，翅膀与身体一体。
    // 按 X 坐标分离出左右翅膀，使其可独立旋转实现上下扇动。
    this.splitWings(model);
  }

  /** 将单网格雨燕按 X 坐标分离为左翅、身体、右翅三个网格
   *  身体与翅膀在根部区域重叠，避免扇动时连接处断开 */
  private splitWings(model: THREE.Group) {
    const threshold = 0.08; // 翅膀判定阈值，|avgX| > threshold 视为翅膀

    // 先收集所有网格，避免在遍历中修改场景树导致意外行为
    const meshes: THREE.Mesh[] = [];
    model.traverse((obj) => {
      if (obj instanceof THREE.Mesh) meshes.push(obj);
    });

    // 标记是否已找到包含完整左右翅膀的主网格，避免多网格模型重复分离
    let wingsSplit = false;

    for (const mesh of meshes) {
      const geo = mesh.geometry;
      const mat = mesh.material as THREE.Material;
      const pos = geo.getAttribute('position');
      const idx = geo.getIndex();

      if (!idx) continue; // 无索引几何体不处理

      // 按三角形中心 X 分类
      const leftTris: number[] = [];
      const rightTris: number[] = [];
      const bodyTris: number[] = [];
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i);
        const b = idx.getX(i + 1);
        const c = idx.getX(i + 2);
        const avgX = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
        if (avgX < -threshold) leftTris.push(a, b, c);
        else if (avgX > threshold) rightTris.push(a, b, c);
        else bodyTris.push(a, b, c);
      }

      // 若已分离过翅膀，且当前网格不是同时包含左右翅的主网格，则跳过（不修改几何体）
      if (wingsSplit && !(leftTris.length > 0 && rightTris.length > 0)) continue;

      // 仅当网格同时包含左右翅膀时才执行分离；仅有单侧或无翅膀的网格保持原样
      if (leftTris.length === 0 || rightTris.length === 0) continue;

      wingsSplit = true;

      // 计算翅膀根部 X：取最靠近身体的顶点 X 坐标（|x| 最小）
      let leftRoot = -threshold;
      let rightRoot = threshold;
      for (const t of leftTris) {
        const x = pos.getX(t);
        if (x > leftRoot) leftRoot = x;
      }
      for (const t of rightTris) {
        const x = pos.getX(t);
        if (x < rightRoot) rightRoot = x;
      }

      // 提取子几何体：使用 pivot Group，翅膀网格作为子节点偏移
      // 旋转 pivot Group 即可绕翅膀根部扇动，无需平移几何体顶点
      const buildSub = (tris: number[], pivotX: number): THREE.Group => {
        const subGeo = this.extractTriangles(geo, tris);
        subGeo.computeBoundingSphere();
        subGeo.computeBoundingBox();
        const subMesh = new THREE.Mesh(subGeo, mat);
        subMesh.frustumCulled = false; // 翅膀始终渲染，避免视锥剔除导致闪烁
        subMesh.position.set(-pivotX, 0, 0); // 网格反向偏移，使 pivot 位于原点
        const pivot = new THREE.Group();
        pivot.add(subMesh);
        pivot.position.set(pivotX, 0, 0); // pivot 在翅膀根部
        return pivot;
      };

      const leftWing = buildSub(leftTris, leftRoot);
      const rightWing = buildSub(rightTris, rightRoot);

      // 身体网格：保留原三角形 + 翅膀根部附近的三角形（重叠区域）
      // 这样翅膀旋转时，连接处仍被身体覆盖，不会露出裂缝
      const overlapLeft: number[] = [];
      const overlapRight: number[] = [];
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i);
        const b = idx.getX(i + 1);
        const c = idx.getX(i + 2);
        const avgX = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
        // 重叠区域：threshold < |avgX| < |root| + margin
        const margin = 0.00;
        if (avgX < -threshold && avgX > leftRoot - margin) overlapLeft.push(a, b, c);
        else if (avgX > threshold && avgX < rightRoot + margin) overlapRight.push(a, b, c);
      }
      const bodyGeo = this.extractTriangles(geo, [...bodyTris, ...overlapLeft, ...overlapRight]);
      mesh.geometry = bodyGeo;

      // 添加翅膀到同一父级
      const parent = mesh.parent || model;
      parent.add(leftWing);
      parent.add(rightWing);
      this.modelLeftWing = leftWing;
      this.modelRightWing = rightWing;
      // 保存基础 X 位置，扇动时在此基础上动态向身体方向偏移
      this.leftWingBaseX = leftWing.position.x;
      this.rightWingBaseX = rightWing.position.x;
    }
  }

  /** 从源几何体提取指定三角形索引子集，返回新的独立几何体 */
  private extractTriangles(src: THREE.BufferGeometry, tris: number[]): THREE.BufferGeometry {
    const srcPos = src.getAttribute('position');
    const srcNorm = src.getAttribute('normal');
    const srcUv = src.getAttribute('uv');
    const vertexMap = new Map<number, number>();
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    for (const oldIdx of tris) {
      if (!vertexMap.has(oldIdx)) {
        const ni = positions.length / 3;
        vertexMap.set(oldIdx, ni);
        positions.push(srcPos.getX(oldIdx), srcPos.getY(oldIdx), srcPos.getZ(oldIdx));
        if (srcNorm) normals.push(srcNorm.getX(oldIdx), srcNorm.getY(oldIdx), srcNorm.getZ(oldIdx));
        if (srcUv) uvs.push(srcUv.getX(oldIdx), srcUv.getY(oldIdx));
      }
    }

    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (normals.length) {
      out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    } else {
      // 源模型无 normal 属性，必须重新计算，否则光照计算错误导致全黑
      out.computeVertexNormals();
    }
    if (uvs.length) out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    out.setIndex(tris.map(i => vertexMap.get(i)!));
    return out;
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
    //   - swift1.glb 因 rotation.y=π 翻转了 X 轴(左右翅膀互换)，Z 旋转取 +roll
    //   - 程序化模型未翻转，Z 旋转取 -roll
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
      // swift1.glb 无骨骼动画，用整体俯仰模拟翅膀扇动
      this.animateModelFlap(pitch, glideActive);
    } else {
      this.animateProceduralWings(pitch, glideActive);
    }

    // 速度向量（用于碰撞与跟随）
    this.velocity.set(0, verticalVel * glideFactor, 0).addScaledVector(this.tmpForward, this.speed);

    // 拖尾：采样路径点 + 重建极光条带
    // 沿当前前向反方向偏移采样，保证转向时拖尾头部始终在雨燕正后方
    this.trailTimer += dt;
    if (this.trailTimer > 0.016) {
      this.trailTimer = 0;
      const back = 1.0;
      const i3 = this.trailCursor * 3;
      this.trailPositions[i3] = this.position.x - this.tmpForward.x * back;
      this.trailPositions[i3 + 1] = this.position.y - this.tmpForward.y * back;
      this.trailPositions[i3 + 2] = this.position.z - this.tmpForward.z * back;
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

  /** GLB 模型模式（swift）：分离的翅膀上下扇动 + 飞行姿态
   *  扇动角度越大，翅膀越向身体方向收拢，避免根部与身体断裂 */
  private animateModelFlap(pitch: number, glideActive: boolean) {
    // 身体姿态（俯仰 + 侧倾）
    if (this.modelGroup) {
      this.modelGroup.rotation.x = this.pitchVis * 0.5;
      this.modelGroup.rotation.z = this.bank * 0.3;
    }
    // 翅膀上下扇动：绕 Z 轴旋转，左右翅同步上抬/下压
    const flapAmp = glideActive ? 0.15 : 0.7;
    const flap = Math.sin(this.wingPhase) * flapAmp;
    // 扇动角度越大，翅膀向身体方向移动越多：inward = |sin(flap)| * factor
    // 用 |sin(flap)| 而非 |flap|，让水平位置（flap=0）时偏移为 0
    const inwardFactor = 0.08;
    const inward = Math.abs(Math.sin(flap)) * inwardFactor;
    if (this.modelLeftWing) {
      // 左翅在 -X 侧，绕 Z 正旋转 → 翼尖上抬
      this.modelLeftWing.rotation.z = flap;
      // 向身体方向移动 = +X 方向
      this.modelLeftWing.position.x = this.leftWingBaseX + inward;
    }
    if (this.modelRightWing) {
      // 右翅在 +X 侧，绕 Z 负旋转 → 翼尖上抬（与左翅同步）
      this.modelRightWing.rotation.z = -flap;
      // 向身体方向移动 = -X 方向
      this.modelRightWing.position.x = this.rightWingBaseX - inward;
    }
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
