/** 游戏全局共享类型定义 */

export type GameStateName = 'boot' | 'menu' | 'tutorial' | 'playing' | 'ending' | 'gameover';

/** 教学关卡阶段（《序章：初响与试翼》） */
export type TutorialStage =
  | 'calibration' // 唤醒与校准：保持水平
  | 'steering' // 离巢与横向转向：穿过光环
  | 'notes' // 音符收集与能量感知
  | 'pitch' // 俯冲与拉升
  | 'thermal' // 上升气流突破
  | 'done'; // 完成，过渡到无尽模式

/** 玩家姿态输入（来自陀螺仪） */
export interface ControlInput {
  /** 俯仰 -1(后仰/拉升) ~ 1(前倾/俯冲) */
  pitch: number;
  /** 翻滚 -1(左倾) ~ 1(右倾) */
  roll: number;
  /** 单击（短按）触发 dodge */
  tapPressed: boolean;
  /** 长按中（glide） */
  glideHeld: boolean;
}

/** 玩家运行时状态 */
export interface PlayerStats {
  energy: number; // 0 ~ 1
  combo: number;
  coins: number;
  distance: number; // 公里
  elapsed: number; // 秒
  glideActive: boolean;
  glideTimer: number; // 滑翔翼剩余秒
  invincibleTimer: number; // 闪避无敌
}

/** 音符节拍类型 */
export type NoteKind = 'normal' | 'golden';

/** 由关卡生成器创建的轨道单元 */
export interface SpawnResult {
  notes: number;
  coins: number;
  obstacles: number;
}
