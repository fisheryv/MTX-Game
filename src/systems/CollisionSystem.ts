/**
 * 碰撞系统：基于球体（BoundingSphere）的轻量检测。
 * 避免引入物理引擎，满足“雨燕 + 球体”需求。
 */
import type { Swift } from '../entities/Swift';
import type { NoteItem } from '../entities/NoteItem';
import type { Coin } from '../entities/Coin';
import type { Obstacle } from '../entities/Obstacle';

export interface CollisionCallbacks {
  onNote?: (n: NoteItem) => void;
  onCoin?: (c: Coin) => void;
  onObstacle?: (o: Obstacle) => void;
  onThermal?: (o: Obstacle) => void;
  onTurbulence?: (o: Obstacle) => void;
}

export class CollisionSystem {
  /** 雨燕 vs 一组音符 */
  public checkNotes(swift: Swift, notes: NoteItem[], cb: (n: NoteItem) => void) {
    const sp = swift.position;
    const r = 1.5;
    for (const n of notes) {
      if (!n.active) continue;
      const p = n.position;
      const dx = sp.x - p.x;
      const dy = sp.y - p.y;
      const dz = sp.z - p.z;
      if (dx * dx + dy * dy + dz * dz < r * r) cb(n);
    }
  }

  public checkCoins(swift: Swift, coins: Coin[], cb: (c: Coin) => void) {
    const sp = swift.position;
    const r = 1.6;
    for (const c of coins) {
      if (!c.active) continue;
      const p = c.position;
      const dx = sp.x - p.x;
      const dy = sp.y - p.y;
      const dz = sp.z - p.z;
      if (dx * dx + dy * dy + dz * dz < r * r) cb(c);
    }
  }

  public checkObstacles(
    swift: Swift,
    obstacles: Obstacle[],
    invincible: boolean,
    cb: (o: Obstacle, isHit: boolean) => void
  ) {
    const sp = swift.position;
    for (const o of obstacles) {
      if (!o.active) continue;
      const p = o.position;
      // thermal 是垂直光柱，做 xz 距离判定 + 任意 y
      if (o.kind === 'thermal') {
        const dx = sp.x - p.x;
        const dz = sp.z - p.z;
        if (dx * dx + dz * dz < 2.0 * 2.0) {
          cb(o, false);
        }
        continue;
      }
      if (o.kind === 'turbulence') {
        const dx = sp.x - p.x;
        const dy = sp.y - p.y;
        const dz = sp.z - p.z;
        const rad = o.collideRadius + 1.2;
        if (dx * dx + dy * dy + dz * dz < rad * rad) {
          cb(o, false);
        }
        continue;
      }
      // rock：碰撞
      if (invincible) continue;
      const dx = sp.x - p.x;
      const dy = sp.y - p.y;
      const dz = sp.z - p.z;
      const rad = o.collideRadius + 1.0;
      if (dx * dx + dy * dy + dz * dz < rad * rad) {
        cb(o, true);
      }
    }
  }
}
