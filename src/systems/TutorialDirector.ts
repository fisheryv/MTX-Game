/**
 * 教学关卡导演（《序章：初响与试翼》）
 *
 * 依据 docs/background.md 的五阶段设计，脚本化地在雨燕前方铺设引导内容，
 * 检测每个阶段的完成条件后推进到下一阶段，全程通过回调驱动 HUD 提示、
 * 音效与粒子反馈。教学期间能量不衰减，营造安全的体感校准环境。
 *
 * 阶段：
 *  1. calibration 唤醒与校准：保持设备水平（roll 接近 0）持续一段时间
 *  2. steering    离巢与横向转向：依次穿过 3 道 S 形排布的光环
 *  3. notes       音符收集与能量感知：吃满一串 8 个音符（Do-Re-Mi 音阶）
 *  4. pitch       俯冲与拉升：先俯冲穿过低狭缝，再拉升掠过高处光环
 *  5. thermal     上升气流突破：飞入上升气流被托举突破云层
 */
import * as THREE from 'three';
import { NoteItem } from '../entities/NoteItem';
import { Obstacle } from '../entities/Obstacle';
import { Ring } from '../entities/Ring';
import type { Swift } from '../entities/Swift';
import type { TutorialStage } from '../types';

export interface TutorialCallbacks {
  /** 阶段切换：更新 HUD 顶部提示（title 主提示，hint 副提示） */
  onPrompt?: (title: string, hint: string) => void;
  /** 完成某个可反馈动作（穿环 / 吃音符），触发轻量提示音与粒子 */
  onProgress?: (kind: 'ring' | 'note' | 'stage') => void;
  /** 整个教学完成，请求切换到无尽模式 */
  onComplete?: () => void;
}

interface StageContext {
  scene: THREE.Scene;
  swift: Swift;
}

export class TutorialDirector {
  private scene: THREE.Scene;
  private cb: TutorialCallbacks;

  private stage: TutorialStage = 'calibration';
  private stageTimer = 0; // 当前阶段已进行时间
  private stageSetup = false; // 当前阶段内容是否已铺设

  // 自持有的教学内容对象（独立于随机 LevelSpawner）
  private notes: NoteItem[] = [];
  private rings: Ring[] = [];
  private obstacles: Obstacle[] = [];

  // 校准阶段：设备保持水平的累计时长
  private calibHold = 0;
  // 音符阶段：Do-Re-Mi 音阶索引
  private noteScaleIndex = 0;
  // 音符阶段：音符串末端 z（越过即推进）
  private notesEndZ = 0;

  constructor(scene: THREE.Scene, cb: TutorialCallbacks) {
    this.scene = scene;
    this.cb = cb;
  }

  public get currentStage(): TutorialStage {
    return this.stage;
  }

  /** 开始教学：重置到第一阶段 */
  public begin() {
    this.clearAll();
    this.stage = 'calibration';
    this.stageTimer = 0;
    this.stageSetup = false;
    this.calibHold = 0;
    this.noteScaleIndex = 0;
  }

  /** 结束教学：清理所有内容 */
  public end() {
    this.clearAll();
  }

  private clearAll() {
    for (const n of this.notes) this.disposeObj(n.mesh, () => n.recycle());
    for (const r of this.rings) this.disposeObj(r.group, () => r.recycle());
    for (const o of this.obstacles) this.disposeObj(o.group, () => o.recycle());
    this.notes = [];
    this.rings = [];
    this.obstacles = [];
  }

  private disposeObj(obj: THREE.Object3D, recycle: () => void) {
    recycle();
    if (obj.parent) obj.parent.remove(obj);
  }

  // ---------- 每帧更新 ----------

  /**
   * 推进教学逻辑。
   * @returns 是否已全部完成
   */
  public update(
    dt: number,
    ctx: StageContext,
    input: { pitch: number; roll: number },
    onNoteEat: (kind: 'normal' | 'golden') => void,
    onRingPass: () => void
  ): boolean {
    this.stageTimer += dt;

    // 动画推进所有活动对象
    for (const n of this.notes) if (n.active) n.update(dt, 0);
    for (const r of this.rings) if (r.active) r.update(dt);
    for (const o of this.obstacles) if (o.active) o.update(dt);

    switch (this.stage) {
      case 'calibration':
        this.updateCalibration(dt, input);
        break;
      case 'steering':
        this.updateSteering(ctx, onRingPass);
        break;
      case 'notes':
        this.updateNotes(ctx, onNoteEat);
        break;
      case 'pitch':
        this.updatePitch(ctx, onRingPass);
        break;
      case 'thermal':
        this.updateThermal(ctx);
        break;
      case 'done':
        return true;
    }
    return false;
  }

  // 阶段一：唤醒与校准 —— 保持水平 2.5 秒
  private updateCalibration(dt: number, input: { pitch: number; roll: number }) {
    if (!this.stageSetup) {
      this.stageSetup = true;
      this.cb.onPrompt?.('握紧设备，保持水平', '让雨燕平稳地滑翔于风中');
    }
    const level = Math.abs(input.roll) < 0.18 && Math.abs(input.pitch) < 0.25;
    if (level) {
      this.calibHold += dt;
    } else {
      this.calibHold = Math.max(0, this.calibHold - dt * 0.5);
    }
    if (this.calibHold >= 2.5) {
      this.advance('steering');
    }
  }

  // 阶段二：离巢与横向转向 —— 穿过 3 道 S 形光环
  private updateSteering(ctx: StageContext, onRingPass: () => void) {
    if (!this.stageSetup) {
      this.stageSetup = true;
      this.cb.onPrompt?.('倾斜设备，左右转向', '优雅地穿过晨光光环');
      const baseZ = ctx.swift.position.z - 45;
      // S 形：左、右、左，高度略有起伏
      const layout = [
        { x: -7, y: 9 },
        { x: 7, y: 11 },
        { x: -6, y: 8 }
      ];
      layout.forEach((p, i) => {
        const ring = new Ring();
        this.scene.add(ring.group);
        ring.spawn(p.x, p.y, baseZ - i * 26);
        this.rings.push(ring);
      });
    }
    // 穿环检测：以“雨燕 z 越过环面”为通过条件（教学宽容，不因未对齐而卡关）
    const sp = ctx.swift.position;
    let allPassed = true;
    for (const ring of this.rings) {
      if (!ring.active) continue;
      if (!ring.passed) {
        // 雨燕已越过环面 z（雨燕沿 -Z 前进，sp.z 小于环 z 即越过）
        if (sp.z <= ring.position.z) {
          const dx = sp.x - ring.position.x;
          const dy = sp.y - ring.position.y;
          const aligned = Math.hypot(dx, dy) < ring.innerRadius;
          ring.setPassed(true);
          onRingPass();
          this.cb.onProgress?.('ring');
          // aligned 时可扩展额外特效（此处统一反馈）
          void aligned;
        } else {
          allPassed = false;
        }
      }
    }
    if (this.rings.length > 0 && allPassed) {
      this.advance('notes');
    }
  }

  // 阶段三：音符收集与能量感知 —— 飞过一串 8 个音符（弧线）
  private updateNotes(ctx: StageContext, onNoteEat: (kind: 'normal' | 'golden') => void) {
    if (!this.stageSetup) {
      this.stageSetup = true;
      this.cb.onPrompt?.('收集音符，补充能量', '顺着弧线飞过整串音符');
      const baseZ = ctx.swift.position.z - 40;
      const cx = ctx.swift.position.x;
      const count = 8;
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const x = cx + Math.sin(t * Math.PI) * 6;
        const y = 9 + Math.sin(t * Math.PI) * 5;
        const z = baseZ - t * 34;
        const note = new NoteItem();
        this.scene.add(note.mesh);
        // 最后一个设为金色，作为音阶收尾
        note.spawn(x, y, z, i === count - 1 ? 'golden' : 'normal');
        this.notes.push(note);
      }
      // 记录音符串末端 z（最远处），越过即推进（教学宽容，不强制全部吃到）
      this.notesEndZ = baseZ - 34;
    }
    // 吃音符检测
    const sp = ctx.swift.position;
    const he = ctx.swift.collideHalfExtents;
    for (const note of this.notes) {
      if (!note.active) continue;
      const p = note.position;
      const r = note.collideRadius;
      const dx = (sp.x - p.x) / (he.x + r);
      const dy = (sp.y - p.y) / (he.y + r);
      const dz = (sp.z - p.z) / (he.z + r);
      if (dx * dx + dy * dy + dz * dz < 1) {
        const kind = note.kind;
        note.recycle();
        onNoteEat(kind);
        this.cb.onProgress?.('note');
        this.noteScaleIndex++;
      }
    }
    // 雨燕越过音符串末端 → 推进到下一阶段
    if (sp.z <= this.notesEndZ) {
      this.advance('pitch');
    }
  }

  // 阶段四：俯冲与拉升 —— 俯冲穿低环，再拉升穿高环
  private updatePitch(ctx: StageContext, onRingPass: () => void) {
    if (!this.stageSetup) {
      this.stageSetup = true;
      this.cb.onPrompt?.('向前俯冲，向后拉升', '俯冲穿过低处，再拉升掠过高处');
      const baseZ = ctx.swift.position.z - 42;
      const cx = ctx.swift.position.x;
      // 低环（俯冲）
      const low = new Ring();
      this.scene.add(low.group);
      low.spawn(cx, 2.5, baseZ);
      this.rings.push(low);
      // 高环（拉升）
      const high = new Ring();
      this.scene.add(high.group);
      high.spawn(cx, 20, baseZ - 30);
      this.rings.push(high);
    }
    const sp = ctx.swift.position;
    let allPassed = true;
    for (const ring of this.rings) {
      if (!ring.active) continue;
      if (!ring.passed) {
        if (sp.z <= ring.position.z) {
          ring.setPassed(true);
          onRingPass();
          this.cb.onProgress?.('ring');
        } else {
          allPassed = false;
        }
      }
    }
    if (this.rings.length > 0 && allPassed) {
      this.advance('thermal');
    }
  }

  // 阶段五：上升气流突破 —— 飞入 thermal，被托举后完成
  private updateThermal(ctx: StageContext) {
    if (!this.stageSetup) {
      this.stageSetup = true;
      this.cb.onPrompt?.('飞入上升气流，直冲九霄', '让风场托举你突破云层');
      const baseZ = ctx.swift.position.z - 40;
      const cx = ctx.swift.position.x;
      const thermal = new Obstacle();
      this.scene.add(thermal.group);
      thermal.spawn(cx, 0, baseZ, 'thermal');
      this.obstacles.push(thermal);
    }
    // 进入 thermal 光柱（xz 距离）后开始计时托举
    const sp = ctx.swift.position;
    for (const o of this.obstacles) {
      if (!o.active || o.kind !== 'thermal') continue;
      const dx = sp.x - o.position.x;
      const dz = sp.z - o.position.z;
      if (Math.hypot(dx, dz) < 4.0) {
        this.calibHold += 1; // 复用计数器：进入气流后累积帧数
        if (this.calibHold > 30) {
          this.advance('done');
          this.cb.onComplete?.();
        }
      }
    }
    // 超过一定时间未进入也放行，避免卡关
    if (this.stageTimer > 12) {
      this.advance('done');
      this.cb.onComplete?.();
    }
  }

  private advance(next: TutorialStage) {
    // 清理当前阶段内容
    this.clearAll();
    this.stage = next;
    this.stageTimer = 0;
    this.stageSetup = false;
    this.calibHold = 0;
    this.cb.onProgress?.('stage');
  }
}
