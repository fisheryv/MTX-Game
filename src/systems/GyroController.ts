/**
 * 陀螺仪 / 重力感应控制器
 *
 * 直接读取 DeviceOrientationEvent 的 beta(pitch) / gamma(roll)，
 * 使用一阶低通滤波消除硬件抖动，并归一化到 -1 ~ 1。
 *
 * 桌面端无传感器时降级为鼠标控制（开发/调试用）。
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

  private usingMouse = false;
  private mousePitch = 0;
  private mouseRoll = 0;
  private mouseTargetPitch = 0;
  private mouseTargetRoll = 0;

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
      this.listening = true;
    }

    // 触控：单击 dodge，长按 glide
    window.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);

    // 桌面降级：鼠标
    window.addEventListener('mousemove', this.onMouseMove);
  }

  public disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    window.removeEventListener('deviceorientation', this.onOrient, true);
    window.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('mousemove', this.onMouseMove);
  }

  private onOrient = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return;
    this.listening = true;
    // beta: 前倾为正(俯冲)；gamma: 右倾为正
    this.rawBeta = clamp(e.beta, -45, 45) / 45;
    this.rawGamma = clamp(e.gamma, -45, 45) / 45;
    this.usingMouse = false;
  };

  private onMouseMove = (e: MouseEvent) => {
    if (this.listening) return; // 真实传感器已工作
    this.usingMouse = true;
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = (e.clientY / window.innerHeight) * 2 - 1;
    // 鼠标向上(负 y) -> 俯冲(前倾)；左右 -> roll
    this.mouseTargetPitch = clamp(ny, -1, 1);
    this.mouseTargetRoll = clamp(nx, -1, 1);
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

  /** 每帧调用：消费一次性输入并平滑 */
  public update(dt: number): ControlInput {
    if (this.usingMouse) {
      this.mousePitch = lowPass(this.mousePitch, this.mouseTargetPitch, this.alpha);
      this.mouseRoll = lowPass(this.mouseRoll, this.mouseTargetRoll, this.alpha);
      this.pitch = -this.mousePitch; // 鼠标上抬 -> 拉升
      this.roll = this.mouseRoll;
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
