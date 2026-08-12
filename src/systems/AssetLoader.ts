/**
 * 资源加载器：使用 GLTFLoader 异步加载外部 GLB 模型。
 * 所有模型存放在 public/assets/models/，运行时通过相对路径请求。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface LoadedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

class AssetLoaderImpl {
  private gltf = new GLTFLoader();
  private cache = new Map<string, LoadedModel>();

  /** 加载 GLB 模型，返回克隆的 scene 与原始 animations */
  public async load(url: string): Promise<LoadedModel> {
    if (this.cache.has(url)) {
      const cached = this.cache.get(url)!;
      return {
        scene: cached.scene.clone(true),
        animations: cached.animations
      };
    }
    const gltf = await this.gltf.loadAsync(url);
    this.cache.set(url, { scene: gltf.scene, animations: gltf.animations });
    return {
      scene: gltf.scene.clone(true),
      animations: gltf.animations
    };
  }

  /** 加载雨燕模型 */
  public loadSwift(): Promise<LoadedModel> {
    return this.load('/assets/models/swift3.glb');
  }
}

export const AssetLoader = new AssetLoaderImpl();
