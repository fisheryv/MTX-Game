/**
 * HUD 控制器：能量条 / 里程 / 连击 / 金币 / Combo 闪光。
 * 仅操作 DOM，不直接依赖游戏逻辑。
 */
import type { HudStats } from '../core/Game';

export class HUD {
  private root: HTMLElement;
  private energyFill: HTMLElement;
  private distanceEl: HTMLElement;
  private comboEl: HTMLElement;
  private coinsEl: HTMLElement;
  private comboFlash: HTMLElement;

  private flashTimer: number | null = null;

  constructor() {
    this.root = document.getElementById('hud')!;
    this.energyFill = document.getElementById('energy-fill')!;
    this.distanceEl = document.getElementById('distance')!;
    this.comboEl = document.getElementById('combo')!;
    this.coinsEl = document.getElementById('coins')!;
    this.comboFlash = document.getElementById('combo-flash')!;
  }

  public show() {
    this.root.classList.remove('hidden');
  }
  public hide() {
    this.root.classList.add('hidden');
  }

  public update(s: HudStats) {
    this.energyFill.style.width = `${Math.round(s.energy * 100)}%`;
    // 能量低时变红
    if (s.energy < 0.25) this.energyFill.classList.add('low');
    else this.energyFill.classList.remove('low');
    if (s.glideActive) this.energyFill.classList.add('glide');
    else this.energyFill.classList.remove('glide');

    this.distanceEl.textContent = s.distanceKm.toFixed(2);
    this.comboEl.textContent = String(s.combo);
    this.coinsEl.textContent = String(s.coins);
  }

  public flash(level: 'resonance' | 'hit') {
    this.comboFlash.classList.remove('resonance', 'hit');
    // 强制重绘以重启动画
    void this.comboFlash.offsetWidth;
    this.comboFlash.classList.add(level, 'show');
    if (this.flashTimer) window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.comboFlash.classList.remove('show');
    }, 900);
  }
}
