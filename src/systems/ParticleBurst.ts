/**
 * 粒子爆裂系统：用于拾取（音符 / 金币）时的粒子反馈。
 *
 * 使用一个预分配的 THREE.Points 云，所有粒子共享一个材质。
 * 每个粒子拥有：位置、速度、生命、基础颜色。burst() 激活一组粒子。
 * 颜色随生命衰减以实现淡出效果。
 */
import * as THREE from 'three';

interface Particle {
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  life: number; // 剩余生命（秒），<=0 表示空闲
  maxLife: number;
  r: number; g: number; b: number; // 基础颜色
}

export class ParticleBurst {
  public readonly points: THREE.Points;
  private readonly geo: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly particles: Particle[];
  private cursor = 0;

  // 软圆光斑纹理（程序化生成）
  private static sprite: THREE.Texture;

  static {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    ParticleBurst.sprite = new THREE.CanvasTexture(c);
    ParticleBurst.sprite.needsUpdate = true;
  }

  constructor(private readonly capacity = 256) {
    this.particles = new Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.particles[i] = {
        px: 0, py: -9999, pz: 0,
        vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1,
        r: 0, g: 0, b: 0
      };
    }

    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    for (let i = 0; i < capacity; i++) {
      this.positions[i * 3 + 1] = -9999;
    }

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.6,
      map: ParticleBurst.sprite,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });

    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  /**
   * 在指定位置触发一次粒子爆裂。
   */
  public burst(
    x: number, y: number, z: number,
    color: THREE.ColorRepresentation,
    count = 18,
    speed = 4,
    life = 0.6
  ) {
    const col = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const p = this.particles[idx];

      // 随机方向（球面均匀分布近似）
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const s = speed * (0.5 + Math.random() * 0.7);

      p.px = x;
      p.py = y;
      p.pz = z;
      p.vx = Math.sin(phi) * Math.cos(theta) * s;
      p.vy = Math.cos(phi) * s;
      p.vz = Math.sin(phi) * Math.sin(theta) * s;
      p.life = life * (0.6 + Math.random() * 0.6);
      p.maxLife = p.life;
      p.r = col.r;
      p.g = col.g;
      p.b = col.b;

      // 立即写入位置与颜色
      this.positions[idx * 3] = x;
      this.positions[idx * 3 + 1] = y;
      this.positions[idx * 3 + 2] = z;
      this.colors[idx * 3] = col.r;
      this.colors[idx * 3 + 1] = col.g;
      this.colors[idx * 3 + 2] = col.b;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  /** 每帧推进所有活跃粒子 */
  public update(dt: number) {
    const gravity = -3.0;
    const drag = 0.92;
    let dirty = false;

    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (p.life <= 0) continue;
      dirty = true;

      // 物理积分
      p.vy += gravity * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.vz *= drag;
      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;
      p.life -= dt;

      const t = Math.max(0, p.life / p.maxLife);
      this.positions[i * 3] = p.px;
      this.positions[i * 3 + 1] = p.life > 0 ? p.py : -9999;
      this.positions[i * 3 + 2] = p.pz;
      // 颜色随生命衰减（淡出）
      this.colors[i * 3] = p.r * t;
      this.colors[i * 3 + 1] = p.g * t;
      this.colors[i * 3 + 2] = p.b * t;
    }

    if (dirty) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
  }

  public reset() {
    for (const p of this.particles) {
      p.life = 0;
    }
    for (let i = 0; i < this.capacity; i++) {
      this.positions[i * 3 + 1] = -9999;
      this.colors[i * 3] = 0;
      this.colors[i * 3 + 1] = 0;
      this.colors[i * 3 + 2] = 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
