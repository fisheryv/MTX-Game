/**
 * 动态音频引擎 (Web Audio API)
 *
 * 设计：
 *  - 节点图：OscillatorNode 主旋律合成 -> BiquadFilter(lowpass) -> GainNode(master) -> destination
 *  - 能量低时低通滤波降到 ~400Hz，声音闷哑；高能量/高 combo 时全频段通透并叠加打击层。
 *  - 收集音符时即时触发短促音符，按音阶递进，形成“玩家在演奏”的感受。
 *  - 终局时触发舒缓的离别残音。
 *
 * 说明：为避免外部音频文件依赖（项目无 assets），所有音色均由振荡器实时合成。
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private filterNode!: BiquadFilterNode;
  private masterGain!: GainNode;
  private musicGain!: GainNode; // 背景音乐层
  private sfxGain!: GainNode; // 音效层
  private padGain!: GainNode; // 持续 pad 层
  private padOscs: OscillatorNode[] = [];
  private started = false;

  // 背景音乐（流式播放 m4a）
  private bgmEl: HTMLAudioElement | null = null;
  private bgmPath = 'audio/Moss-Tarp Quiet by Fisher Yu_1.m4a';

  // 音乐 / 音效开关（持久化到 localStorage）
  private musicEnabled = true;
  private sfxEnabled = true;
  private static readonly MUSIC_KEY = 'sem-music-on-v1';
  private static readonly SFX_KEY = 'sem-sfx-on-v1';

  // 五声音阶（C 大调五声），用于“玩家演奏”旋律
  private readonly scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
  private noteCursor = 0;

  constructor() {
    try {
      this.musicEnabled = localStorage.getItem(AudioEngine.MUSIC_KEY) !== '0';
      this.sfxEnabled = localStorage.getItem(AudioEngine.SFX_KEY) !== '0';
    } catch {
      /* localStorage 不可用时使用默认开启 */
    }
  }

  public isMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  public isSfxEnabled(): boolean {
    return this.sfxEnabled;
  }

  /** 开关背景音乐：关闭时暂停 BGM，开启时（若已初始化）续播 */
  public setMusicEnabled(on: boolean) {
    this.musicEnabled = on;
    try {
      localStorage.setItem(AudioEngine.MUSIC_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (!this.bgmEl) return;
    if (on) {
      void this.bgmEl.play().catch(() => {});
    } else if (!this.bgmEl.paused) {
      this.bgmEl.pause();
    }
  }

  /** 开关音效 */
  public setSfxEnabled(on: boolean) {
    this.sfxEnabled = on;
    try {
      localStorage.setItem(AudioEngine.SFX_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  /** 必须在用户手势中调用 */
  public async resume(): Promise<void> {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC();
      this.buildGraph();
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        /* ignore */
      }
    }
    if (!this.started) {
      this.started = true;
      // 已改用真实 BGM 取代合成 pad 氛围层；保留 startPad 以备将来切换
      void this.startPad;
      await this.startBgm();
    } else if (this.bgmEl && this.bgmEl.paused) {
      // 已创建但被暂停（如 suspend 后恢复）：续播
      await this.bgmEl.play().catch(() => {
        /* ignore */
      });
    }
  }

  /** 背景音乐是否正在播放 */
  public isBgmPlaying(): boolean {
    return !!this.bgmEl && !this.bgmEl.paused;
  }

  private buildGraph() {
    const ctx = this.ctx!;
    this.filterNode = ctx.createBiquadFilter();
    this.filterNode.type = 'lowpass';
    this.filterNode.frequency.value = 22000;
    this.filterNode.Q.value = 0.7;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.6;

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.5;
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = 0.8;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.0; // pad 默认无声，随能量上升

    this.musicGain.connect(this.filterNode);
    this.sfxGain.connect(this.filterNode);
    this.padGain.connect(this.filterNode);
    this.filterNode.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);
  }

  /** 持续 pad 层：两个失谐正弦构成空灵背景 */
  private startPad() {
    const ctx = this.ctx!;
    const freqs = [130.81, 196.0, 261.63];
    for (const f of freqs) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.33;
      o.connect(g);
      g.connect(this.padGain);
      o.start();
      this.padOscs.push(o);
    }
  }

  /** 流式播放背景音乐（循环） */
  private async startBgm(): Promise<void> {
    // 音乐已关闭：不创建/不播放
    if (!this.musicEnabled) return;
    // 已存在元素：续播（stopAll/suspend 后恢复）
    if (this.bgmEl) {
      if (this.bgmEl.paused) {
        await this.bgmEl.play().catch(() => {
          /* ignore */
        });
      }
      return;
    }
    const el = new Audio(encodeURI(this.bgmPath));
    el.loop = true;
    el.preload = 'auto';
    // 直接用 HTMLAudioElement 播放，不接入 Web Audio 图
    // 避免经过 filterNode（低通滤波会随能量降低而衰减 BGM 高频）
    // 避免经过 musicGain/masterGain（多层增益导致音量过低）
    el.volume = 0.5; // BGM 独立音量
    this.bgmEl = el;
    await el.play().catch(() => {
      /* 自动播放被拦截，等待后续 resume 重试 */
    });
  }

  /** 依据能量(0~1)与 combo 调节音色 */
  public updateEnergyState(energyRatio: number, combo: number) {
    if (!this.ctx) return;
    const minFreq = 380;
    const maxFreq = 20000;
    const target = minFreq + (maxFreq - minFreq) * Math.pow(energyRatio, 1.8);
    const t = this.ctx.currentTime;
    this.filterNode.frequency.setTargetAtTime(target, t, 0.15);
    // pad 音量随能量
    this.padGain.gain.setTargetAtTime(0.05 + energyRatio * 0.25, t, 0.2);
    // combo 高时音乐层略增
    const musicTarget = 0.4 + Math.min(0.5, combo * 0.02);
    this.musicGain.gain.setTargetAtTime(musicTarget, t, 0.3);
  }

  /** 收集音符：播放一个音阶递进的音 */
  public playNote(kind: 'normal' | 'golden') {
    if (!this.ctx || !this.sfxEnabled) return;
    const ctx = this.ctx;
    const freq = this.scale[this.noteCursor % this.scale.length] * (kind === 'golden' ? 2 : 1);
    this.noteCursor++;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = kind === 'golden' ? 'triangle' : 'sine';
    o.frequency.value = freq;
    const g = ctx.createGain();
    const peak = kind === 'golden' ? 0.9 : 0.6;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    o.connect(g);
    g.connect(this.sfxGain);
    o.start(now);
    o.stop(now + 0.55);
  }

  /** Combo 共振：和弦上行短促闪光 */
  public playResonance() {
    if (!this.ctx || !this.sfxEnabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      const start = now + i * 0.05;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.8);
      o.connect(g);
      g.connect(this.sfxGain);
      o.start(start);
      o.stop(start + 0.85);
    });
  }

  /** 拾取金币：清脆的钟音 */
  public playCoin() {
    if (!this.ctx || !this.sfxEnabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 1318.51;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.4, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    o.connect(g);
    g.connect(this.sfxGain);
    o.start(now);
    o.stop(now + 0.45);
  }

  /** 碰撞受击：低频闷响 */
  public playHit() {
    if (!this.ctx || !this.sfxEnabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, now);
    o.frequency.exponentialRampToValueAtTime(50, now + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    o.connect(g);
    g.connect(this.sfxGain);
    o.start(now);
    o.stop(now + 0.35);
  }

  /** 终局：缓慢下行的离别残音 */
  public playEndgame() {
    if (!this.ctx || !this.musicEnabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const notes = [659.25, 587.33, 523.25, 440.0, 392.0, 329.63];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      const start = now + i * 0.6;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.18, start + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 1.4);
      o.connect(g);
      g.connect(this.musicGain);
      o.start(start);
      o.stop(start + 1.5);
    });
    // pad 渐弱
    this.padGain.gain.setTargetAtTime(0.0, now, 1.5);
  }

  public suspend() {
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
    if (this.bgmEl && !this.bgmEl.paused) this.bgmEl.pause();
  }

  public stopAll() {
    if (!this.ctx) return;
    this.padOscs.forEach((o) => {
      try {
        o.stop();
      } catch {
        /* ignore */
      }
    });
    this.padOscs = [];
    this.started = false;
    // 暂停背景音乐（保留元素，便于后续 resume 续播）
    if (this.bgmEl && !this.bgmEl.paused) this.bgmEl.pause();
  }
}
