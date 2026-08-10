/**
 * 通用对象池：避免飞行过程中 new THREE.Mesh，维持 60FPS。
 * 对象必须实现 activate/onRecycle 接口；这里用泛型 + 工厂函数。
 */
export interface Poolable {
  active: boolean;
  recycle(): void;
}

export class ObjectPool<T extends Poolable> {
  private pool: T[] = [];
  private factory: () => T;

  constructor(factory: () => T, prefill = 0) {
    this.factory = factory;
    for (let i = 0; i < prefill; i++) {
      const o = factory();
      o.recycle();
      this.pool.push(o);
    }
  }

  /** 获取一个可用对象（无则新建） */
  public acquire(): T {
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i].active) return this.pool[i];
    }
    const o = this.factory();
    o.recycle();
    this.pool.push(o);
    return o;
  }

  /** 回收所有 active=false 的（一般在每帧由对象自身管理） */
  public sweep() {
    for (const o of this.pool) {
      if (o.active) {
        // 由 LevelSpawner 根据距离回收
      }
    }
  }

  public get all(): T[] {
    return this.pool;
  }

  public get count(): number {
    return this.pool.length;
  }

  public forEachActive(cb: (o: T) => void) {
    for (const o of this.pool) if (o.active) cb(o);
  }

  public recycleAll() {
    for (const o of this.pool) o.recycle();
  }
}
