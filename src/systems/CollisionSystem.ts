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
  /** 雨燕 vs 一组音符（球-球碰撞，使用各自的碰撞半径） */
  public checkNotes(swift: Swift, notes: NoteItem[], cb: (n: NoteItem) => void) {
    const sp = swift.position;
    const sr = swift.collideRadius;
    for (const n of notes) {
      if (!n.active) continue;
      const p = n.position;
      const r = sr + n.collideRadius;
      const dx = sp.x - p.x;
      const dy = sp.y - p.y;
      const dz = sp.z - p.z;
      if (dx * dx + dy * dy + dz * dz < r * r) cb(n);
    }
  }

  /** 雨燕 vs 一组金币（球-球碰撞，使用各自的碰撞半径） */
  public checkCoins(swift: Swift, coins: Coin[], cb: (c: Coin) => void) {
    const sp = swift.position;
    const sr = swift.collideRadius;
    for (const c of coins) {
      if (!c.active) continue;
      const p = c.position;
      const r = sr + c.collideRadius;
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
    const sr = swift.collideRadius;
    for (const o of obstacles) {
      if (!o.active) continue;
      const p = o.position;
      // thermal 是垂直光柱，做 xz 距离判定 + 任意 y
      if (o.kind === 'thermal') {
        const dx = sp.x - p.x;
        const dz = sp.z - p.z;
        const rad = sr + 2.0;
        if (dx * dx + dz * dz < rad * rad) {
          cb(o, false);
        }
        continue;
      }
      if (o.kind === 'turbulence') {
        const dx = sp.x - p.x;
        const dy = sp.y - p.y;
        const dz = sp.z - p.z;
        const rad = o.collideRadius + sr;
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
      const rad = o.collideRadius + sr;
      if (dx * dx + dy * dy + dz * dz < rad * rad) {
        cb(o, true);
      }
    }
  }
}
