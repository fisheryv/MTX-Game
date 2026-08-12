/**
 * 陀螺仪 / 重力感应控制器
 *
 * 直接读取 DeviceOrientationEvent 的 beta(pitch) / gamma(roll)，
 * 使用一阶低通滤波消除硬件抖动，并归一化到 -1 ~ 1。
 *
 * 桌面端无传感器时降级为键盘方向键控制（开发/调试用）：
 *  - 方向键 ←/→ 模拟屏幕左右倾斜
 *  - 方向键 ↑/↓ 向上飞 / 向下飞
 */
import { clamp, lowPass, smoothAxis } from '../utils/MathUtils';
import type { ControlInput } from '../types';

export class GyroController {
  private rawBeta = 0;
  private rawGamma = 0;
  public pitch = 0; // -1(拉升) ~ 1(俯冲)
  public roll = 0; // -1(左) ~ 1(右)

  private alpha = 0.18;
  private deadzone = 0.03;

  private tapPressed = false;
  private glideHeld = false;
  private pointerDownAt = 0;
  private pointerHolding = false;
  private readonly glideThresholdMs = 180;

  // 键盘控制（PC 开发调试用）：方向键模拟屏幕倾斜
  private keys = new Set<string>();
  private usingKeyboard = false;
  private kbPitch = 0;
  private kbRoll = 0;

  private enabled = false;
  private listening = false;

  /** 请求 iOS 13+ 的传感器授权 */
  public async requestPermission(): Promise<boolean> {
    const DOE: any = (window as any).DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const r = await DOE.requestPermission();
        return r === 'granted';
      } catch {
        return false;
      }
    }
    return true;
  }

  /** 启用传感器 / 输入监听 */
  public enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
      window.addEventListener('deviceorientation', this.onOrient, true);
      // 注意：此处不设置 listening=true。
      // listening 仅在 onOrient 收到真实 beta/gamma 数据后才置真，
      // 否则 PC 浏览器（API 存在但无传感器）会误判为已连接传感器，
      // 导致键盘 / 鼠标降级输入被忽略。
    }

    // 触控：单击 dodge，长按 glide
    window.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);

    // 桌面降级：键盘方向键（模拟屏幕倾斜，便于 PC 调试）
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  public disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    window.removeEventListener('deviceorientation', this.onOrient, true);
    window.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  private onOrient = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return;
    this.listening = true;
    // beta: 前倾为正(俯冲)；gamma: 右倾为正
    this.rawBeta = clamp(e.beta, -45, 45) / 45;
    this.rawGamma = clamp(e.gamma, -45, 45) / 45;
  };

  private onDown = () => {
    this.pointerDownAt = performance.now();
    this.pointerHolding = true;
  };

  private onUp = () => {
    const held = performance.now() - this.pointerDownAt;
    if (held < this.glideThresholdMs) {
      // 短按 -> dodge（tap）
      this.tapPressed = true;
    }
    this.pointerHolding = false;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    // 仅处理方向键，避免阻止其他按键的默认行为
    switch (e.code) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        e.preventDefault();
        this.keys.add(e.code);
        this.usingKeyboard = true;
        break;
      default:
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    switch (e.code) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        e.preventDefault();
        this.keys.delete(e.code);
        break;
      default:
        break;
    }
  };

  /** 每帧调用：消费一次性输入并平滑 */
  public update(dt: number): ControlInput {
    if (this.listening) {
      // 真实陀螺仪优先
      this.pitch = smoothAxis(this.pitch, this.rawBeta, this.alpha, this.deadzone);
      this.roll = smoothAxis(this.roll, this.rawGamma, this.alpha, this.deadzone);
    } else if (this.usingKeyboard) {
      // 键盘方向键：左/右模拟左右倾斜，上/下向上飞/向下飞
      // 松开所有键时 target=0，平滑回正保持直线飞行
      let targetPitch = 0;
      let targetRoll = 0;
      if (this.keys.has('ArrowLeft')) targetRoll += 1;
      if (this.keys.has('ArrowRight')) targetRoll -= 1;
      if (this.keys.has('ArrowUp')) targetPitch -= 1; // 上键 -> 拉升(向上飞)
      if (this.keys.has('ArrowDown')) targetPitch += 1; // 下键 -> 俯冲(向下飞)
      this.kbPitch = lowPass(this.kbPitch, targetPitch, this.alpha);
      this.kbRoll = lowPass(this.kbRoll, targetRoll, this.alpha);
      this.pitch = this.kbPitch;
      this.roll = this.kbRoll;
    } else {
      this.pitch = smoothAxis(this.pitch, this.rawBeta, this.alpha, this.deadzone);
      this.roll = smoothAxis(this.roll, this.rawGamma, this.alpha, this.deadzone);
    }

    // 长按判定：按下持续超过阈值才视为 glide
    this.glideHeld =
      this.pointerHolding &&
      performance.now() - this.pointerDownAt >= this.glideThresholdMs;

    const tap = this.tapPressed;
    this.tapPressed = false;

    // dt 仅用于后续可能的时长判定，目前保留接口
    void dt;

    return {
      pitch: this.pitch,
      roll: this.roll,
      tapPressed: tap,
      glideHeld: this.glideHeld
    };
  }
}
