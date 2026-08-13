/**
 * 碰撞系统：雨燕使用椭球（按轴半长），其他物体使用球体。
 * 椭球 vs 球 = Minkowski 和（椭球膨胀球半径），归一化后比较距离平方。
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
  /** 雨燕（椭球）vs 一组音符（球）：归一化距离平方 < 1 */
  public checkNotes(swift: Swift, notes: NoteItem[], cb: (n: NoteItem) => void) {
    const sp = swift.position;
    const he = swift.collideHalfExtents;
    for (const n of notes) {
      if (!n.active) continue;
      const p = n.position;
      const r = n.collideRadius;
      const dx = (sp.x - p.x) / (he.x + r);
      const dy = (sp.y - p.y) / (he.y + r);
      const dz = (sp.z - p.z) / (he.z + r);
      if (dx * dx + dy * dy + dz * dz < 1) cb(n);
    }
  }

  /** 雨燕（椭球）vs 一组金币（球） */
  public checkCoins(swift: Swift, coins: Coin[], cb: (c: Coin) => void) {
    const sp = swift.position;
    const he = swift.collideHalfExtents;
    for (const c of coins) {
      if (!c.active) continue;
      const p = c.position;
      const r = c.collideRadius;
      const dx = (sp.x - p.x) / (he.x + r);
      const dy = (sp.y - p.y) / (he.y + r);
      const dz = (sp.z - p.z) / (he.z + r);
      if (dx * dx + dy * dy + dz * dz < 1) cb(c);
    }
  }

  public checkObstacles(
    swift: Swift,
    obstacles: Obstacle[],
    invincible: boolean,
    cb: (o: Obstacle, isHit: boolean) => void
  ) {
    const sp = swift.position;
    const he = swift.collideHalfExtents;
    for (const o of obstacles) {
      if (!o.active) continue;
      const p = o.position;
      // thermal 是垂直光柱，做 xz 距离判定 + 任意 y
      if (o.kind === 'thermal') {
        const r = 2.0;
        const dx = (sp.x - p.x) / (he.x + r);
        const dz = (sp.z - p.z) / (he.z + r);
        if (dx * dx + dz * dz < 1) {
          cb(o, false);
        }
        continue;
      }
      if (o.kind === 'turbulence') {
        const r = o.collideRadius;
        const dx = (sp.x - p.x) / (he.x + r);
        const dy = (sp.y - p.y) / (he.y + r);
        const dz = (sp.z - p.z) / (he.z + r);
        if (dx * dx + dy * dy + dz * dz < 1) {
          cb(o, false);
        }
        continue;
      }
      // rock：碰撞
      if (invincible) continue;
      const r = o.collideRadius;
      const dx = (sp.x - p.x) / (he.x + r);
      const dy = (sp.y - p.y) / (he.y + r);
      const dz = (sp.z - p.z) / (he.z + r);
      if (dx * dx + dy * dy + dz * dz < 1) {
        cb(o, true);
      }
    }
  }
}
