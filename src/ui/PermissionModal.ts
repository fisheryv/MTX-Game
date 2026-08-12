/**
 * 菜单与终局控制器。
 * 菜单态仅展示 menu-bg（bg.png）与"点击屏幕起飞"提示；
 * 点击屏幕任意位置即开始游戏。终局结算界面的显隐与本地高分记录由本类管理。
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
  private menuBg: HTMLElement;
  private endgame: HTMLElement;
  private restartBtn: HTMLElement;
  private endDistance: HTMLElement;
  private endTime: HTMLElement;
  private endCoins: HTMLElement;
  private endComment: HTMLElement;
  private endRecord: HTMLElement;
  private bestDistanceEl: HTMLElement;
  private bestCoinsEl: HTMLElement;
  private ready = false;
  private readonly onDocumentClick: (e: MouseEvent) => void;

  constructor(
    private readonly onStart: () => void,
    private readonly onRestart: () => void
  ) {
    this.menuBg = document.querySelector('.menu-bg') as HTMLElement;
    this.endgame = document.getElementById('endgame')!;
    this.restartBtn = document.getElementById('restart-btn')!;
    this.endDistance = document.getElementById('end-distance')!;
    this.endTime = document.getElementById('end-time')!;
    this.endCoins = document.getElementById('end-coins')!;
    this.endComment = document.getElementById('end-comment')!;
    this.endRecord = document.getElementById('end-record')!;
    this.bestDistanceEl = document.getElementById('best-distance')!;
    this.bestCoinsEl = document.getElementById('best-coins')!;

    // 菜单态下点击屏幕任意位置起飞
    this.onDocumentClick = (e: MouseEvent) => {
      if (!this.ready) return;
      // 终局结算界面可见时，不响应起飞点击
      if (!this.endgame.classList.contains('hidden')) return;
      // 忽略对结算界面内元素的点击
      if (this.endgame.contains(e.target as Node)) return;
      this.onStart();
    };
    document.addEventListener('click', this.onDocumentClick);

    this.restartBtn.addEventListener('click', () => {
      this.hideEndgame();
      this.onRestart();
    });
  }

  public showStart() {
    this.menuBg.classList.add('is-visible');
  }

  public hideStart() {
    this.menuBg.classList.remove('is-visible');
    this.ready = false;
  }

  /** 模型加载中：暂不可起飞 */
  public setStartLoading(_label: string, _hint: string) {
    this.ready = false;
  }

  /** 就绪可起飞：允许点击屏幕开始 */
  public setStartReady(_label?: string, _hint?: string) {
    this.ready = true;
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
