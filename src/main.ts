/**
 * 入口：装配 Game / HUD / PermissionModal，并绑定全局事件。
 * 首次启动会先展示序章背景介绍（bg2.png + 滚动文字），结束后进入主菜单。
 */
import * as THREE from 'three';
import { Game } from './core/Game';
import { HUD } from './ui/HUD';
import { PermissionModal } from './ui/PermissionModal';
import { IntroScreen } from './ui/IntroScreen';
import { AssetLoader } from './systems/AssetLoader';
import type { GameStateName } from './types';
import type { HudStats } from './core/Game';

async function bootstrap() {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (!canvas) throw new Error('game-canvas not found');

  const hud = new HUD(() => game?.exit());

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
    () => void game?.start(),
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
              break;
            case 'playing':
              modal.hideStart();
              modal.hideEndgame();
              hud.show();
              break;
            case 'ending':
              // 保留 HUD，进入慢动作
              break;
            case 'gameover':
              hud.hide();
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
        onEndgameStart: () => {
          /* 演出由 Game 内部慢动作驱动 */
        },
        onGameOver: (finalStats) => {
          modal.showEndgame(finalStats);
        }
      },
      scene,
      animations
    );
    modal.showStart();
    modal.setStartReady('开启飞行', '准备就绪');
  };

  // 后台暂停音频
  document.addEventListener('visibilitychange', () => {
    if (!game) return;
    if (document.hidden) game.onVisibilityHidden();
    else game.onVisibilityVisible();
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
