/**
 * HUD 控制器：能量条 / 里程 / 连击 / 金币 / 速度 / 状态徽章 / Combo 闪光。
 * 仅操作 DOM，不直接依赖游戏逻辑。
 */
import type { HudStats } from '../core/Game';

export class HUD {
  private root: HTMLElement;
  private energyFill: HTMLElement;
  private energyPct: HTMLElement;
  private distanceEl: HTMLElement;
  private comboEl: HTMLElement;
  private coinsEl: HTMLElement;
  private speedEl: HTMLElement;
  private badgeGlide: HTMLElement;
  private badgeResonance: HTMLElement;
  private comboFlash: HTMLElement;
  private exitBtn: HTMLElement;

  private flashTimer: number | null = null;

  constructor(onExit?: () => void) {
    this.root = document.getElementById('hud')!;
    this.energyFill = document.getElementById('energy-fill')!;
    this.energyPct = document.getElementById('energy-pct')!;
    this.distanceEl = document.getElementById('distance')!;
    this.comboEl = document.getElementById('combo')!;
    this.coinsEl = document.getElementById('coins')!;
    this.speedEl = document.getElementById('speed-value')!;
    this.badgeGlide = document.getElementById('badge-glide')!;
    this.badgeResonance = document.getElementById('badge-resonance')!;
    this.comboFlash = document.getElementById('combo-flash')!;
    this.exitBtn = document.getElementById('exit-btn')!;

    if (onExit) {
      this.exitBtn.addEventListener('click', onExit);
    }
  }

  public show() {
    this.root.classList.remove('hidden');
  }
  public hide() {
    this.root.classList.add('hidden');
  }

  public update(s: HudStats) {
    const pct = Math.round(s.energy * 100);
    this.energyFill.style.width = `${pct}%`;
    this.energyPct.textContent = String(pct);

    // 能量状态切换
    this.energyFill.classList.toggle('low', s.energy < 0.25);
    this.energyFill.classList.toggle('glide', s.glideActive);
    this.energyFill.classList.toggle('resonance', s.resonanceActive);

    this.distanceEl.textContent = s.distanceKm.toFixed(2);
    this.comboEl.textContent = String(s.combo);
    this.coinsEl.textContent = String(s.coins);
    this.speedEl.textContent = String(Math.round(s.speed));

    // 状态徽章
    this.badgeGlide.classList.toggle('hidden', !s.glideActive);
    this.badgeResonance.classList.toggle('hidden', !s.resonanceActive);
  }

  public flash(level: 'resonance' | 'hit') {
    this.comboFlash.classList.remove('resonance', 'hit');
    // 强制重绘以重启动画
    void this.comboFlash.offsetWidth;
    this.comboFlash.classList.add(level, 'show');
    if (this.flashTimer) window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.comboFlash.classList.remove('show');
    }, 1000);
  }
}
