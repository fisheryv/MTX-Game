/**
 * 游戏总控：状态机 + 系统编排。
 *
 * 状态：boot -> menu -> playing -> ending -> gameover
 *
 *  - boot:    等待用户首次手势（授权传感器 + 解锁 AudioContext）
 *  - menu:    显示启动遮罩
 *  - playing: 主循环运行
 *  - ending:  能量耗尽后的慢动作“落地”演出
 *  - gameover:结算界面
 */
import * as THREE from 'three';
import { SceneManager } from '../systems/SceneManager';
import { GyroController } from '../systems/GyroController';
import { AudioEngine } from '../systems/AudioEngine';
import { CollisionSystem } from '../systems/CollisionSystem';
import { LevelSpawner } from '../systems/LevelSpawner';
import { ParticleBurst } from '../systems/ParticleBurst';
import { Swift } from '../entities/Swift';
import { Loop } from './Loop';
import { clamp } from '../utils/MathUtils';
import type { GameStateName, PlayerStats } from '../types';

export interface HudStats {
  energy: number;
  combo: number;
  coins: number;
  distanceKm: number;
  elapsed: number;
  glideActive: boolean;
}

export interface GameCallbacks {
  onStateChange?: (s: GameStateName) => void;
  onStats?: (s: HudStats) => void;
  onComboFlash?: (level: 'resonance' | 'hit') => void;
  onEndgameStart?: () => void;
  onGameOver?: (finalStats: { distanceKm: number; elapsed: number; coins: number }) => void;
}

const MAX_ENERGY = 1.0;
const BASE_DECAY = 0.016; // 每秒
const NOTE_ENERGY = 0.08;
const GOLDEN_ENERGY = 0.22;
const ROCK_DAMAGE = 0.26;
const DODGE_COST = 0.03;
const COMBO_WINDOW = 2.2; // 秒
const RESONANCE_THRESHOLD = 8;
const RESONANCE_BONUS = 0.16;
const RESONANCE_BUFF_TIME = 3.0; // 共振期间衰减减半
const TAP_DODGE_INVINCIBLE = 0.45;
const ROCK_HIT_INVINCIBLE = 1.2;
const ENDING_DURATION = 5.5; // 慢动作演出时长

export class Game {
  private state: GameStateName = 'boot';
  private readonly scene: SceneManager;
  private readonly gyro: GyroController;
  private readonly audio: AudioEngine;
  private readonly collision: CollisionSystem;
  private readonly spawner: LevelSpawner;
  private readonly swift: Swift;
  private readonly particles: ParticleBurst;
  private readonly loop: Loop;

  private stats: PlayerStats = {
    energy: 1,
    combo: 0,
    coins: 0,
    distance: 0,
    elapsed: 0,
    glideActive: false,
    glideTimer: 0,
    invincibleTimer: 0
  };

  private comboTimer = 0;
  private resonanceTimer = 0; // 共振增益剩余秒
  private thermalBoost = 0; // 当前是否在上升气流中
  private turbulenceOffset = 0; // 逆风导致的控制偏移

  // 慢动作
  private endingTimer = 0;
  private slowmo = 1;

  // 复用临时
  private cb: GameCallbacks;

  constructor(
    canvas: HTMLCanvasElement,
    cb: GameCallbacks,
    swiftModel?: THREE.Group,
    swiftAnimations?: THREE.AnimationClip[]
  ) {
    this.cb = cb;
    this.scene = new SceneManager(canvas);
    this.gyro = new GyroController();
    this.audio = new AudioEngine();
    this.collision = new CollisionSystem();
    this.swift = new Swift(swiftModel, swiftAnimations);
    this.scene.scene.add(this.swift.group);
    this.scene.scene.add(this.swift.trailMesh);
    this.spawner = new LevelSpawner(this.scene.scene);
    this.particles = new ParticleBurst(256);
    this.scene.scene.add(this.particles.points);

    this.loop = new Loop(this.onFixedUpdate, this.onRender);
  }

  // ---------- 生命周期 ----------

  /** 用户点击“开启飞行”：授权 + 解锁音频 + 进入游戏 */
  public async start() {
    const ok = await this.gyro.requestPermission();
    if (ok) this.gyro.enable();
    await this.audio.resume();

    this.resetRun();
    this.setState('playing');
    this.loop.start();
  }

  public restart() {
    this.audio.stopAll();
    void this.audio.resume();
    this.resetRun();
    this.setState('playing');
    if (!this.loop.isRunning) this.loop.start();
  }

  /** 页面切到后台时暂停音频 */
  public onVisibilityHidden() {
    this.audio.suspend();
  }
  public onVisibilityVisible() {
    if (this.state === 'playing' || this.state === 'ending') {
      void this.audio.resume();
    }
  }

  private resetRun() {
    this.stats = {
      energy: MAX_ENERGY,
      combo: 0,
      coins: 0,
      distance: 0,
      elapsed: 0,
      glideActive: false,
      glideTimer: 0,
      invincibleTimer: 0
    };
    this.comboTimer = 0;
    this.resonanceTimer = 0;
    this.thermalBoost = 0;
    this.turbulenceOffset = 0;
    this.endingTimer = 0;
    this.slowmo = 1;
    this.swift.reset();
    this.spawner.reset(-80);
    this.particles.reset();
    this.emitStats();
  }

  private setState(s: GameStateName) {
    this.state = s;
    this.cb.onStateChange?.(s);
  }

  // ---------- 主循环 ----------

  private onFixedUpdate = (dt: number) => {
    if (this.state === 'playing') this.updatePlaying(dt);
    else if (this.state === 'ending') this.updateEnding(dt);
    // menu / gameover 不推进逻辑
  };

  private onRender = (_alpha: number, _frameDt: number) => {
    this.scene.render();
  };

  private updatePlaying(dt: number) {
    const input = this.gyro.update(dt);
    const s = this.stats;

    s.elapsed += dt;

    // 闪避
    if (input.tapPressed && s.energy > DODGE_COST) {
      s.energy -= DODGE_COST;
      s.invincibleTimer = TAP_DODGE_INVINCIBLE;
      this.swift.dodge(input.roll >= 0 ? 1 : -1);
    }

    // 滑翔
    s.glideActive = input.glideHeld;
    s.invincibleTimer = Math.max(0, s.invincibleTimer - dt);
    this.resonanceTimer = Math.max(0, this.resonanceTimer - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer === 0 && s.combo > 0) s.combo = 0;

    // 逆风控制偏移：在 turbulence 中叠加
    const effPitch = clamp(input.pitch + this.turbulenceOffset, -1, 1);
    this.turbulenceOffset *= 0.96; // 衰减

    // 更新雨燕
    this.swift.update(
      dt,
      effPitch,
      input.roll,
      s.glideActive,
      s.invincibleTimer > 0
    );

    // 关卡生成 / 回收
    this.spawner.update(this.swift.position.z, s.distance);
    this.spawner.tickAnimations(dt);

    // 碰撞
    this.collision.checkNotes(this.swift, this.spawner.activeNotes, (n) => {
      // 粒子爆裂反馈
      this.particles.burst(
        n.position.x, n.position.y, n.position.z,
        n.kind === 'golden' ? 0xffe27a : 0x9be8ff,
        n.kind === 'golden' ? 28 : 18,
        4.5,
        0.6
      );
      n.recycle();
      s.combo += 1;
      this.comboTimer = COMBO_WINDOW;
      s.energy = clamp(
        s.energy + (n.kind === 'golden' ? GOLDEN_ENERGY : NOTE_ENERGY),
        0,
        MAX_ENERGY
      );
      this.audio.playNote(n.kind);
      if (s.combo >= RESONANCE_THRESHOLD && s.combo % RESONANCE_THRESHOLD === 0) {
        this.resonanceTimer = RESONANCE_BUFF_TIME;
        s.energy = clamp(s.energy + RESONANCE_BONUS, 0, MAX_ENERGY);
        this.audio.playResonance();
        this.cb.onComboFlash?.('resonance');
      }
    });

    this.collision.checkCoins(this.swift, this.spawner.activeCoins, (c) => {
      // 粒子爆裂反馈
      this.particles.burst(
        c.position.x, c.position.y, c.position.z,
        0xffd75a,
        22,
        4.0,
        0.55
      );
      c.recycle();
      s.coins += 1;
      this.audio.playCoin();
    });

    this.collision.checkObstacles(
      this.swift,
      this.spawner.activeObstacles,
      s.invincibleTimer > 0,
      (o, isHit) => {
        if (o.kind === 'thermal') {
          this.thermalBoost = 0.05; // 每帧叠加一点，离开后由 update 衰减
          // 上升气流：向前加速 + 微量能量
          this.swift.speed += 12 * dt;
          s.energy = clamp(s.energy + 0.02 * dt, 0, MAX_ENERGY);
        } else if (o.kind === 'turbulence') {
          // 逆风：注入随机控制偏移
          this.turbulenceOffset += (Math.random() - 0.5) * 0.6 * dt;
        } else if (isHit && o.kind === 'rock') {
          // 撞击突石：扣能量、断 combo、短暂无敌
          s.energy = clamp(s.energy - ROCK_DAMAGE, 0, MAX_ENERGY);
          s.combo = 0;
          this.comboTimer = 0;
          s.invincibleTimer = ROCK_HIT_INVINCIBLE;
          this.audio.playHit();
          this.cb.onComboFlash?.('hit');
        }
      }
    );

    // 上升气流增益衰减
    this.thermalBoost = Math.max(0, this.thermalBoost - dt * 0.5);

    // 能量衰减（滑翔与共振期间降低；距离越远衰减越快）
    let decay = BASE_DECAY * (1 + s.distance * 0.04);
    if (s.glideActive) decay *= 0.3;
    if (this.resonanceTimer > 0) decay *= 0.5;
    s.energy = clamp(s.energy - decay * dt, 0, MAX_ENERGY);

    // 距离：基于速度积分（z 向后退即前进）
    // 前向速度近似为 swift.speed
    s.distance += (this.swift.speed * dt) / 1000; // km（1 单位 = 1 米）

    // 远景视差
    this.scene.parallax(this.swift.position.x);

    // 相机
    this.scene.updateChaseCamera(
      this.swift.position,
      this.swift.quaternion,
      dt,
      false
    );

    // 音频状态
    this.audio.updateEnergyState(s.energy, s.combo);

    // 粒子推进
    this.particles.update(dt);

    // HUD
    this.emitStats();

    // 能量耗尽 -> 终局
    if (s.energy <= 0) {
      this.beginEndgame();
    }
  }

  private beginEndgame() {
    this.setState('ending');
    this.endingTimer = 0;
    this.slowmo = 0.35;
    this.audio.playEndgame();
    this.cb.onEndgameStart?.();
  }

  private updateEnding(dt: number) {
    const s = this.stats;
    // 慢动作时间推进
    const sdt = dt * this.slowmo;
    this.endingTimer += dt;
    s.elapsed += sdt;

    // 雨燕缓缓滑翔盘旋下降
    const input = this.gyro.update(dt);
    // 强制柔和的盘旋：缓慢左转 + 下沉
    this.swift.update(sdt, 0.3, -0.25, true, false);
    void input;

    this.spawner.tickAnimations(sdt);
    this.particles.update(sdt);
    this.scene.parallax(this.swift.position.x);
    this.scene.updateChaseCamera(this.swift.position, this.swift.quaternion, dt, true);

    // 雨燕逐渐下落至地面（y 接近 0）时化为羽毛
    if (this.swift.position.y < 1.2 || this.endingTimer >= ENDING_DURATION) {
      this.finishEndgame();
    }

    this.emitStats();
  }

  private finishEndgame() {
    if (this.state !== 'ending') return;
    // 隐藏雨燕（化为光芒散去）
    this.swift.group.visible = false;
    this.swift.trailMesh.visible = false;
    this.audio.stopAll();
    this.setState('gameover');
    this.cb.onGameOver?.({
      distanceKm: this.stats.distance,
      elapsed: this.stats.elapsed,
      coins: this.stats.coins
    });
    // 停止逻辑循环（render 仍继续以保留画面）
    this.loop.stop();
    // 渲染最后一帧
    this.scene.render();
  }

  private emitStats() {
    this.cb.onStats?.({
      energy: this.stats.energy,
      combo: this.stats.combo,
      coins: this.stats.coins,
      distanceKm: this.stats.distance,
      elapsed: this.stats.elapsed,
      glideActive: this.stats.glideActive
    });
  }

  // 调试 / 外部
  public get currentState(): GameStateName {
    return this.state;
  }
}
