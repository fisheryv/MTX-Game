/**
 * 启动 / 授权弹窗控制器。
 * 负责显示初始遮罩与“开启飞行”按钮回调，以及终局结算界面的显隐。
 */
export class PermissionModal {
  private modal: HTMLElement;
  private startBtn: HTMLElement;
  private endgame: HTMLElement;
  private restartBtn: HTMLElement;
  private endDistance: HTMLElement;
  private endTime: HTMLElement;
  private endCoins: HTMLElement;

  constructor(
    private readonly onStart: () => void,
    private readonly onRestart: () => void
  ) {
    this.modal = document.getElementById('permission-modal')!;
    this.startBtn = document.getElementById('start-btn')!;
    this.endgame = document.getElementById('endgame')!;
    this.restartBtn = document.getElementById('restart-btn')!;
    this.endDistance = document.getElementById('end-distance')!;
    this.endTime = document.getElementById('end-time')!;
    this.endCoins = document.getElementById('end-coins')!;

    this.startBtn.addEventListener('click', () => this.onStart());
    this.restartBtn.addEventListener('click', () => {
      this.hideEndgame();
      this.onRestart();
    });
  }

  public showStart() {
    this.modal.classList.remove('hidden');
  }
  public hideStart() {
    this.modal.classList.add('hidden');
  }

  public showEndgame(stats: { distanceKm: number; elapsed: number; coins: number }) {
    this.endDistance.textContent = stats.distanceKm.toFixed(2);
    this.endTime.textContent = Math.round(stats.elapsed).toString();
    this.endCoins.textContent = String(stats.coins);
    this.endgame.classList.remove('hidden');
  }
  public hideEndgame() {
    this.endgame.classList.add('hidden');
  }
}
