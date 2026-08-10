/**
 * 主循环：基于 requestAnimationFrame 的固定步长更新器。
 *
 * 使用累加器实现“固定逻辑步长 + 可变渲染”，保证物理稳定。
 */
export class Loop {
  private rafId = 0;
  private last = 0;
  private acc = 0;
  private running = false;

  private readonly fixedDt = 1 / 60; // 60Hz 逻辑步长
  private readonly maxFrame = 0.1; // 防止切后台后超大步长

  constructor(
    private readonly onFixedUpdate: (dt: number) => void,
    private readonly onRender: (alpha: number, frameDt: number) => void
  ) {}

  public start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  public stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  public get isRunning(): boolean {
    return this.running;
  }

  private tick = (now: number) => {
    if (!this.running) return;
    let frame = (now - this.last) / 1000;
    this.last = now;
    if (frame > this.maxFrame) frame = this.maxFrame;
    this.acc += frame;

    let steps = 0;
    while (this.acc >= this.fixedDt && steps < 5) {
      this.onFixedUpdate(this.fixedDt);
      this.acc -= this.fixedDt;
      steps++;
    }
    // 剩余累加作为插值 alpha
    const alpha = this.acc / this.fixedDt;
    this.onRender(alpha, frame);
    this.rafId = requestAnimationFrame(this.tick);
  };
}
