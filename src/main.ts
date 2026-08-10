/**
 * 入口：装配 Game / HUD / PermissionModal，并绑定全局事件。
 */
import * as THREE from 'three';
import { Game } from './core/Game';
import { HUD } from './ui/HUD';
import { PermissionModal } from './ui/PermissionModal';
import { AssetLoader } from './systems/AssetLoader';
import type { GameStateName } from './types';

interface LastStats {
  energy: number;
  combo: number;
  coins: number;
  distanceKm: number;
  elapsed: number;
  glideActive: boolean;
}

async function bootstrap() {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (!canvas) throw new Error('game-canvas not found');

  const hud = new HUD();

  let game: Game;
  let lastStats: LastStats = {
    energy: 1,
    combo: 0,
    coins: 0,
    distanceKm: 0,
    elapsed: 0,
    glideActive: false
  };

  const modal = new PermissionModal(
    () => void game.start(),
    () => void game.restart()
  );

  // 先显示启动遮罩，按钮进入加载状态
  modal.showStart();
  const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  startBtn.textContent = '加载中…';
  startBtn.disabled = true;

  // 预加载雨燕 GLB 模型
  let swiftModel: THREE.Group | undefined;
  try {
    const loaded = await AssetLoader.loadSwift();
    swiftModel = loaded.scene;
  } catch (e) {
    console.warn('雨燕模型加载失败，使用程序化模型', e);
  }

  game = new Game(canvas, {
    onStateChange: (s: GameStateName) => {
      switch (s) {
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
  }, swiftModel);

  // 模型就绪，启用开始按钮
  startBtn.textContent = '开启飞行';
  startBtn.disabled = false;

  // 后台暂停音频
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.onVisibilityHidden();
    else game.onVisibilityVisible();
  });

  // 阻止移动端双击缩放 / 长按菜单
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void bootstrap());
} else {
  void bootstrap();
}
