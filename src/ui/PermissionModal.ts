/**
 * 启动 / 授权弹窗控制器。
 * 负责显示初始遮罩与"开启飞行"按钮回调，以及终局结算界面的显隐。
 * 同时管理本地存储的高分记录。
 */

const STORAGE_KEY = 'sem-best-v1';

interface BestStats {
  distance: number;
  coins: number;
}

interface EndStats {
  distanceKm: number;
  elapsed: number;
  coins: number;
}

export class PermissionModal {
  private modal: HTMLElement;
  private startBtn: HTMLButtonElement;
  private startLabel: HTMLElement;
  private startHint: HTMLElement;
  private auroraBg: HTMLElement;
  private endgame: HTMLElement;
  private restartBtn: HTMLElement;
  private endDistance: HTMLElement;
  private endTime: HTMLElement;
  private endCoins: HTMLElement;
  private endComment: HTMLElement;
  private endRecord: HTMLElement;
  private bestDistanceEl: HTMLElement;
  private bestCoinsEl: HTMLElement;

  constructor(
    private readonly onStart: () => void,
    private readonly onRestart: () => void
  ) {
    this.modal = document.getElementById('permission-modal')!;
    this.startBtn = document.getElementById('start-btn') as HTMLButtonElement;
    this.startLabel = document.getElementById('start-label')!;
    this.startHint = document.getElementById('start-hint')!;
    this.auroraBg = document.querySelector('.aurora-bg') as HTMLElement;
    this.endgame = document.getElementById('endgame')!;
    this.restartBtn = document.getElementById('restart-btn')!;
    this.endDistance = document.getElementById('end-distance')!;
    this.endTime = document.getElementById('end-time')!;
    this.endCoins = document.getElementById('end-coins')!;
    this.endComment = document.getElementById('end-comment')!;
    this.endRecord = document.getElementById('end-record')!;
    this.bestDistanceEl = document.getElementById('best-distance')!;
    this.bestCoinsEl = document.getElementById('best-coins')!;

    this.startBtn.addEventListener('click', () => {
      if (this.startBtn.disabled) return;
      this.onStart();
    });
    this.restartBtn.addEventListener('click', () => {
      this.hideEndgame();
      this.onRestart();
    });
  }

  public showStart() {
    this.modal.classList.remove('hidden');
    this.auroraBg.classList.remove('is-hidden');
  }
  public hideStart() {
    this.modal.classList.add('hidden');
    this.auroraBg.classList.add('is-hidden');
  }

  /** 启动按钮进入加载态 */
  public setStartLoading(label: string, hint: string) {
    this.startBtn.disabled = true;
    this.startBtn.classList.add('is-loading');
    this.startLabel.textContent = label;
    this.startHint.textContent = hint;
  }

  /** 启动按钮就绪可点击 */
  public setStartReady(label = '开启飞行', hint = '准备就绪，点击起飞') {
    this.startBtn.disabled = false;
    this.startBtn.classList.remove('is-loading');
    this.startLabel.textContent = label;
    this.startHint.textContent = hint;
  }

  public showEndgame(stats: EndStats) {
    this.endDistance.textContent = stats.distanceKm.toFixed(2);
    this.endTime.textContent = Math.round(stats.elapsed).toString();
    this.endCoins.textContent = String(stats.coins);

    // 高分对比
    const best = this.loadBest();
    const newBestDistance = stats.distanceKm > best.distance;
    const newBestCoins = stats.coins > best.coins;
    const isNewRecord = newBestDistance || newBestCoins;

    // 显示历史最佳（仅在已存在记录时）
    if (best.distance > 0) {
      this.bestDistanceEl.classList.remove('hidden');
      this.bestDistanceEl.textContent = `最佳 ${best.distance.toFixed(2)} km`;
    } else {
      this.bestDistanceEl.classList.add('hidden');
    }
    if (best.coins > 0) {
      this.bestCoinsEl.classList.remove('hidden');
      this.bestCoinsEl.textContent = `最佳 ${best.coins}`;
    } else {
      this.bestCoinsEl.classList.add('hidden');
    }

    // 新纪录提示
    this.endRecord.classList.toggle('hidden', !isNewRecord);

    // 评语
    this.endComment.textContent = this.evaluatePlay(stats, isNewRecord);

    // 保存新高分
    if (isNewRecord) {
      this.saveBest({
        distance: Math.max(best.distance, stats.distanceKm),
        coins: Math.max(best.coins, stats.coins)
      });
    }

    this.endgame.classList.remove('hidden');
  }

  public hideEndgame() {
    this.endgame.classList.add('hidden');
  }

  private evaluatePlay(stats: EndStats, isNewRecord: boolean): string {
    if (isNewRecord) return '突破极限，新的纪录诞生';
    if (stats.distanceKm >= 3) return '长途迁徙，旋律悠扬';
    if (stats.distanceKm >= 1.5) return '飞行稳健，乐章流畅';
    if (stats.distanceKm >= 0.5) return '初试羽翼，渐入佳境';
    return '羽翼暂歇，旋律未止';
  }

  private loadBest(): BestStats {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { distance: 0, coins: 0 };
      const parsed = JSON.parse(raw);
      return {
        distance: Number(parsed.distance) || 0,
        coins: Number(parsed.coins) || 0
      };
    } catch {
      return { distance: 0, coins: 0 };
    }
  }

  private saveBest(stats: BestStats) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    } catch {
      // 存储不可用时静默忽略
    }
  }
}
