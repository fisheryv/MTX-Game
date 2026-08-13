/**
 * 入口：装配 Game / HUD / PermissionModal，并绑定全局事件。
 * 首次启动会先展示序章背景介绍（bg2.png + 滚动文字），结束后进入主菜单。
 */
import * as THREE from 'three';
import { Game } from './core/Game';
import { HUD } from './ui/HUD';
import { PermissionModal } from './ui/PermissionModal';
import { IntroScreen } from './ui/IntroScreen';
import { MenuOverlays } from './ui/MenuOverlays';
import { AssetLoader } from './systems/AssetLoader';
import { AudioEngine } from './systems/AudioEngine';
import type { GameStateName } from './types';
import type { HudStats } from './core/Game';

const TUTORIAL_KEY = 'swift_tutorial_done_v1';
function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return false;
  }
}
function markTutorialSeen() {
  try {
    localStorage.setItem(TUTORIAL_KEY, '1');
  } catch {
    /* ignore */
  }
}

async function bootstrap() {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (!canvas) throw new Error('game-canvas not found');

  const hud = new HUD(() => game?.exit());

  // 共享 AudioEngine：初次进入即尝试自动播放背景音乐；
  // 若被浏览器自动播放策略拦截，则在首次用户交互时兜底启动。
  const audio = new AudioEngine();
  let bgmStarted = false;
  const startBgm = () => {
    if (bgmStarted) return;
    void audio.resume().then(() => {
      if (audio.isBgmPlaying()) {
        bgmStarted = true;
        window.removeEventListener('pointerdown', startBgm);
        window.removeEventListener('keydown', startBgm);
        window.removeEventListener('touchstart', startBgm);
      }
    });
  };
  // 立即尝试自动播放
  startBgm();
  // 兜底：首次用户交互时再次尝试
  window.addEventListener('pointerdown', startBgm);
  window.addEventListener('keydown', startBgm);
  window.addEventListener('touchstart', startBgm);

  // 主菜单顶部按钮（帮助 / 设置）
  const overlays = new MenuOverlays(audio);

  let game: Game | undefined;
  let lastStats: HudStats = {
    energy: 1,
    combo: 0,
    coins: 0,
    distanceKm: 0,
    elapsed: 0,
    glideActive: false,
    speed: 0,
    resonanceActive: false
  };

  const modal = new PermissionModal(
    () => {
      // 首次游玩走教学关卡《序章：初响与试翼》，之后直接进入无尽模式
      if (tutorialSeen()) void game?.start();
      else void game?.startTutorial();
    },
    () => void game?.restart()
  );

  // 预加载雨燕 GLB 模型（与序章滚动并行）
  const modelPromise = AssetLoader.loadSwift()
    .then((loaded) => ({
      scene: loaded.scene as THREE.Group | undefined,
      animations: loaded.animations as THREE.AnimationClip[] | undefined
    }))
    .catch((e) => {
      console.warn('雨燕模型加载失败，使用程序化模型', e);
      return { scene: undefined as THREE.Group | undefined, animations: undefined as THREE.AnimationClip[] | undefined };
    });

  /** 模型就绪后创建 Game 并展示主菜单 */
  const prepareMenu = async () => {
    const { scene, animations } = await modelPromise;
    game = new Game(
      canvas,
      {
        onStateChange: (s: GameStateName) => {
          switch (s) {
            case 'menu':
              hud.hide();
              modal.hideEndgame();
              modal.setStartReady('开启飞行', '准备就绪，点击起飞');
              modal.showStart();
              overlays.showTopbar();
              // 返回菜单后恢复背景音乐（若音乐开关开启）
              void audio.resume();
              break;
            case 'tutorial':
              // 教学关卡：隐藏菜单，显示 HUD（含阶段提示）
              modal.hideStart();
              modal.hideEndgame();
              overlays.hideTopbar();
              hud.show();
              break;
            case 'playing':
              modal.hideStart();
              modal.hideEndgame();
              overlays.hideTopbar();
              hud.show();
              // 能进入无尽模式说明教学已通过（或本就跳过），记录完成
              markTutorialSeen();
              break;
            case 'ending':
              // 保留 HUD，进入慢动作
              break;
            case 'gameover':
              hud.hide();
              overlays.hideTopbar();
              modal.showEndgame({
                distanceKm: lastStats.distanceKm,
                elapsed: lastStats.elapsed,
                coins: lastStats.coins
              });
              break;
            default:
              break;
          }
        },
        onStats: (s) => {
          lastStats = s;
          hud.update(s);
        },
        onComboFlash: (level) => hud.flash(level),
        onTutorialPrompt: (title, hint) => hud.setTutorialPrompt(title, hint),
        onEndgameStart: () => {
          /* 演出由 Game 内部慢动作驱动 */
        },
        onGameOver: (finalStats) => {
          modal.showEndgame(finalStats);
        }
      },
      scene,
      animations,
      audio
    );
    modal.showStart();
    modal.setStartReady('开启飞行', '准备就绪');
    overlays.showTopbar();
  };

  // 后台暂停音频
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      game?.onVisibilityHidden();
      audio.suspend();
    } else {
      game?.onVisibilityVisible();
      // 菜单/序章期间也恢复 BGM
      if (!game || game.currentState === 'menu' || game.currentState === 'boot') {
        void audio.resume();
      }
    }
  });

  // 阻止移动端双击缩放 / 长按菜单
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // 首次启动展示序章背景介绍；否则直接进入主菜单
  if (!IntroScreen.hasSeen()) {
    const intro = new IntroScreen(() => {
      void prepareMenu();
    });
    intro.show();
  } else {
    modal.showStart();
    modal.setStartLoading('加载中…', '正在准备极光羽翼');
    void prepareMenu();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void bootstrap());
} else {
  void bootstrap();
}
