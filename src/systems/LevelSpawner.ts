/**
 * 关卡与场景生成器（无限轨道）
 *
 * 设计：
 *  - 雨燕沿 -Z 飞行，生成器持续在玩家前方 ~200 单位处铺设内容。
 *  - 内容分“段落(chunk)”：每段 40 单位长，按节奏模板生成音符轨迹（弧线 / 螺旋 / 直线），
 *    并穿插金币与障碍（突石 / 上升气流 / 逆风）。
 *  - 所有对象来自对象池，超出身后 25 单位即回收。
 *  - 难度随距离递增：障碍密度上升、音符间距变大。
 */
import * as THREE from 'three';
import { ObjectPool } from './ObjectPool';
import { NoteItem } from '../entities/NoteItem';
import { Coin } from '../entities/Coin';
import { Obstacle, ObstacleKind } from '../entities/Obstacle';
import { chance, pick, randRange } from '../utils/MathUtils';

type Pattern = 'arc' | 'spiral' | 'line' | 'zigzag';

interface Chunk {
  zStart: number; // 段落起始 z（更负）
  zEnd: number;
  pattern: Pattern;
  hasThermal: boolean;
  hasTurbulence: boolean;
  rockCount: number;
  coinRing: boolean;
}

export class LevelSpawner {
  private notesPool: ObjectPool<NoteItem>;
  private coinsPool: ObjectPool<Coin>;
  private obstaclesPool: ObjectPool<Obstacle>;

  private nextChunkZ = -80; // 下一段落起点（z 越负越远）
  private chunkLen = 40;
  private difficulty = 0; // 0~1

  constructor(scene: THREE.Scene) {
    this.notesPool = new ObjectPool<NoteItem>(
      () => {
        const n = new NoteItem();
        scene.add(n.mesh);
        return n;
      },
      50
    );
    this.coinsPool = new ObjectPool<Coin>(
      () => {
        const c = new Coin();
        scene.add(c.mesh);
        return c;
      },
      20
    );
    this.obstaclesPool = new ObjectPool<Obstacle>(
      () => {
        const o = new Obstacle();
        scene.add(o.group);
        return o;
      },
      16
    );
  }

  public reset(startZ = -80) {
    this.notesPool.recycleAll();
    this.coinsPool.recycleAll();
    this.obstaclesPool.recycleAll();
    this.nextChunkZ = startZ;
    this.difficulty = 0;
  }

  /** 每帧：根据玩家 z 推进生成 / 回收 */
  public update(playerZ: number, distanceKm: number) {
    this.difficulty = Math.min(1, distanceKm / 6);

    // 生成：保证玩家前方有 ~200 单位的内容
    while (this.nextChunkZ > playerZ - 220) {
      this.spawnChunk(this.nextChunkZ);
      this.nextChunkZ -= this.chunkLen;
    }

    // 回收：在玩家身后 25 单位以外
    const recycleZ = playerZ + 25;
    this.notesPool.forEachActive((n) => {
      if (n.position.z > recycleZ) n.recycle();
    });
    this.coinsPool.forEachActive((c) => {
      if (c.position.z > recycleZ) c.recycle();
    });
    this.obstaclesPool.forEachActive((o) => {
      if (o.position.z > recycleZ) o.recycle();
    });
  }

  private spawnChunk(zStart: number) {
    const pattern = pick<Pattern>(['arc', 'spiral', 'line', 'zigzag']);
    const chunk: Chunk = {
      zStart,
      zEnd: zStart - this.chunkLen,
      pattern,
      hasThermal: chance(0.18),
      hasTurbulence: chance(0.12 + this.difficulty * 0.12),
      rockCount: Math.floor(randRange(0, 1 + this.difficulty * 2.5)),
      coinRing: chance(0.45)
    };

    this.spawnNotes(chunk);
    if (chunk.coinRing) this.spawnCoinRing(chunk);
    if (chunk.hasThermal) this.spawnObstacle(chunk.zStart - 20, 'thermal');
    if (chunk.hasTurbulence) this.spawnObstacle(chunk.zStart - 12, 'turbulence');
    for (let i = 0; i < chunk.rockCount; i++) {
      this.spawnObstacle(randRange(chunk.zEnd, chunk.zStart), 'rock');
    }
  }

  /** 按 pattern 生成一串音符（5~9 个） */
  private spawnNotes(chunk: Chunk) {
    const count = 5 + Math.floor(randRange(0, 4));
    const baseY = randRange(6, 16);
    const cx = randRange(-12, 12);
    const golden = chance(0.12);

    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const z = chunk.zStart - t * this.chunkLen * 0.9;
      let x = cx;
      let y = baseY;
      switch (chunk.pattern) {
        case 'arc': {
          // 抛物弧线
          x = cx + Math.sin(t * Math.PI) * 8;
          y = baseY + Math.sin(t * Math.PI) * 6;
          break;
        }
        case 'spiral': {
          const ang = t * Math.PI * 2;
          x = cx + Math.cos(ang) * 4;
          y = baseY + Math.sin(ang) * 4;
          break;
        }
        case 'line': {
          x = cx;
          y = baseY + t * 2;
          break;
        }
        case 'zigzag': {
          x = cx + (i % 2 === 0 ? -5 : 5);
          y = baseY + Math.sin(t * Math.PI * 2) * 3;
          break;
        }
      }
      const n = this.notesPool.acquire();
      n.spawn(x, y, z, i === Math.floor(count / 2) && golden ? 'golden' : 'normal');
    }
  }

  /** 金币环：8 个金币绕中心排成一圈，位置偏高挑战性 */
  private spawnCoinRing(chunk: Chunk) {
    const z = (chunk.zStart + chunk.zEnd) / 2;
    const cy = randRange(10, 22);
    const cx = randRange(-8, 8);
    const r = 4;
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const c = this.coinsPool.acquire();
      c.spawn(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, z);
    }
  }

  private spawnObstacle(z: number, kind: ObstacleKind) {
    const o = this.obstaclesPool.acquire();
    let x = randRange(-14, 14);
    let y = randRange(2, 24);
    if (kind === 'thermal') {
      x = randRange(-10, 10);
      y = 0;
    }
    o.spawn(x, y, z, kind);
  }

  /** 每帧推进所有活动对象的自转动画 */
  public tickAnimations(dt: number) {
    this.notesPool.forEachActive((n) => n.update(dt, 0));
    this.coinsPool.forEachActive((c) => c.update(dt));
    this.obstaclesPool.forEachActive((o) => o.update(dt));
  }

  /** 暴露给碰撞系统使用的活动对象集合 */
  public get activeNotes(): NoteItem[] {
    return this.notesPool.all;
  }
  public get activeCoins(): Coin[] {
    return this.coinsPool.all;
  }
  public get activeObstacles(): Obstacle[] {
    return this.obstaclesPool.all;
  }
}
