/**
 * 序章背景介绍：首次启动时以 bg2.png 为背景，文字由屏幕下方向上滚动。
 * 滚动结束或用户点击"跳过"后回调 onCompleted。
 * 使用 localStorage 记录是否已展示过。
 */

const INTRO_STORAGE_KEY = 'sem-intro-seen-v1';
// 滚动速度（像素 / 秒），与内容长度共同决定总时长
const SCROLL_SPEED = 55;

interface IntroChapter {
  title?: string;
  paragraphs: string[];
  quote?: boolean;
}

const CHAPTERS: IntroChapter[] = [
  {
    paragraphs: ['雨燕：无尽旋律'],
    quote: false
  },
  {
    paragraphs: [
      '"这世界上有一种鸟是没有脚的，它只能一直飞呀飞，飞累了就在风里睡觉。',
      '这种鸟一辈子只能落地一次，那一次就是它死亡的时候……"',
      '——《阿飞正传》'
    ],
    quote: true
  },
  {
    title: '',
    paragraphs: [
      '万米之上，流光织谱，',
      '天穹是一座无言的琴腹——',
      '云是铺展的帛，雷是低沉的鼓，',
      '风不流浪，它吟诵亘古的赋。'
    ]
  },
  {
    title: '',
    paragraphs: [
      '雨燕生而无足，只余共鸣之核，',
      '翅尖划开哑默的风道，',
      '像针穿过锦缎，缝补高空的干涸，',
      '每一道弧线，都是未落笔的音符。'
    ]
  },
  {
    title: '',
    paragraphs: [
      '云海之下，万物缄口，',
      '寂静堆积成无光的渊薮。',
      '坠落，不是终结，是归还——',
      '一身积攒的星辰，碎作大地上的萤火。'
    ]
  },
  {
    title: '',
    paragraphs: [
      '你破壳于天籁之巅，初生的羽翼轻颤，',
      '不为苟活，只为在晨昏与雷暴之间，',
      '拾起断裂的乐节，如拾起散落的骨，',
      '拼合成一首《天空绝响》，',
      '那是你飞行的全部语言。'
    ]
  },
  {
    title: '',
    paragraphs: [
      '此刻，张开双翼，',
      '让音符之河载你穿过极光的长夜——',
      '你飞得越远，身后的大地越明亮，',
      '你唱得越沉，归去的星光越缠绵。'
    ]
  },
  {
    title: '',
    paragraphs: [
      '去吧，雨燕，',
      '在坠落之前，把天空写完。',
      '每一寸飞翔，都是绝笔，',
      '每一缕余音，都是火焰。'
    ]
  }
];

export class IntroScreen {
  private root: HTMLElement;
  private contentEl: HTMLElement;
  private skipBtn: HTMLElement;
  private rafId = 0;
  private startTime = 0;
  private scrollDistance = 0;
  private completed = false;

  constructor(private readonly onCompleted: () => void) {
    this.root = document.getElementById('intro-screen')!;
    this.contentEl = this.root.querySelector('.intro-content')!;
    this.skipBtn = this.root.querySelector('.intro-skip')!;

    this.renderContent();
    this.skipBtn.addEventListener('click', () => this.finish());
  }

  /** 是否已经展示过序章 */
  public static hasSeen(): boolean {
    try {
      return localStorage.getItem(INTRO_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  /** 标记为已展示 */
  public static markSeen() {
    try {
      localStorage.setItem(INTRO_STORAGE_KEY, '1');
    } catch {
      // 存储不可用时静默忽略
    }
  }

  public show() {
    this.root.classList.remove('hidden');
    // 进入即开始滚动（等下一帧让浏览器布局完成后再计算高度）
    requestAnimationFrame(() => this.startScroll());
  }

  public hide() {
    this.root.classList.add('hidden');
    cancelAnimationFrame(this.rafId);
  }

  private renderContent() {
    const frag = document.createDocumentFragment();
    for (const ch of CHAPTERS) {
      const section = document.createElement('div');
      section.className = 'intro-section' + (ch.quote ? ' intro-section--quote' : '');
      if (ch.title) {
        const h2 = document.createElement('h2');
        h2.className = 'intro-heading';
        h2.textContent = ch.title;
        section.appendChild(h2);
      }
      for (const p of ch.paragraphs) {
        const el = document.createElement('p');
        el.className = 'intro-paragraph';
        el.textContent = p;
        section.appendChild(el);
      }
      frag.appendChild(section);
    }
    this.contentEl.appendChild(frag);
  }

  private startScroll() {
    const contentHeight = this.contentEl.offsetHeight;
    // 起始：内容顶部对齐屏幕垂直中部（CSS top:50% 已实现）
    // 结束：内容底部对齐屏幕垂直中部（向上滚动 contentHeight 像素）
    this.scrollDistance = contentHeight;
    const duration = (this.scrollDistance / SCROLL_SPEED) * 1000;

    this.contentEl.style.transform = `translate(-50%, 0px)`;
    this.startTime = performance.now();

    const step = (now: number) => {
      if (this.completed) return;
      const elapsed = now - this.startTime;
      const progress = Math.min(elapsed / duration, 1);
      const y = -this.scrollDistance * progress;
      this.contentEl.style.transform = `translate(-50%, ${y}px)`;

      if (progress < 1) {
        this.rafId = requestAnimationFrame(step);
      } else {
        this.finish();
      }
    };
    this.rafId = requestAnimationFrame(step);
  }

  private finish() {
    if (this.completed) return;
    this.completed = true;
    cancelAnimationFrame(this.rafId);
    IntroScreen.markSeen();
    // 淡出后通知外部
    this.root.classList.add('is-fading');
    let called = false;
    const onTransitionEnd = () => {
      if (called) return;
      called = true;
      this.root.removeEventListener('transitionend', onTransitionEnd);
      this.hide();
      this.root.classList.remove('is-fading');
      this.completed = false;
      this.onCompleted();
    };
    this.root.addEventListener('transitionend', onTransitionEnd);
    // 兜底：万一 transitionend 未触发
    setTimeout(onTransitionEnd, 700);
  }
}
