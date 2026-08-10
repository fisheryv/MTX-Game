# 《雨燕：无尽旋律》（Swift：Endless Melody）技术设计文档 (Three.js 架构)

---

## 1. 架构总览 (System Architecture)

基于 **Vite + TypeScript + Three.js + Web Audio API + Capacitor** 的单页应用（SPA）架构，采用纯代码驱动模式（Code-First），适配 Vibe Coding (Cursor/Claude) 的全自动代码重构与快速热重载。

```
                   [ 核心游戏循环 (Game Loop / RequestAnimationFrame) ]
                                        │
      ┌──────────────────┬──────────────┼──────────────────┬──────────────────┐
      ▼                  ▼              ▼                  ▼                  ▼
[体感控制模块]     [3D 渲染引擎]  [动态音频引擎]     [关卡与生成器]      [物理与碰撞]
GyroController    Scene/Camera    WebAudioEngine     LevelSpawner       CollisionSystem
 (DeviceMotion)    (Three.js)      (AudioContext)    (Object Pooling)    (Bounding Volume)
      │                  │              │                  │                  │
      └──────────────────┴──────────────┼──────────────────┴──────────────────┘
                                        ▼
                               [游戏状态管理器 (GameState)]
                                (Energy / Combo / Distance)
                                        │
                                        ▼
                               [Capacitor 跨端容器]
                             (iOS / Android Native Shell)

```

### 核心技术选型表

| 模块 | 选用技术 / 库 | 选型理由 |
| --- | --- | --- |
| **构建工具** | Vite + TypeScript | 毫秒级 HMR 热重载，原生模块化，强类型提示极度契合 AI 生成代码。 |
| **3D 渲染引擎** | Three.js (r160+) | 绝对主控的 Web 3D 渲染库，极低的脚手架复杂度，AI 代码生成准确率最高。 |
| **音频引擎** | Web Audio API (Native) | 零外部依赖，原生支持音频节点（Node）链式调用、低通滤波及多轨道实时无缝淡入淡出（Crossfade）。 |
| **物理碰撞** | Three.js Bounding Volume / Raycaster | 避免引入大型物理引擎重量包；雨燕采用“球体/射线”算法满足轻量化需求。 |
| **跨端打包** | Capacitor 6.0 | 极轻量 Web 容器，完美桥接 iOS/Android 原生陀螺仪与触控震动（Haptics API）。 |

---

## 2. 核心系统设计 (Core Systems Design)

### 2.1 陀螺仪与体感控制器 (`GyroController.ts`)

#### 数据采集与平滑算法

直接读取 `DeviceOrientationEvent` 的 `beta`（pitch / 俯仰角）和 `gamma`（roll / 翻滚角）。为消除手机传感器的硬件高频抖动，使用一阶低通滤波算法（Low-pass Filter）和平滑插值（Lerp）：

$$S_t = \alpha \cdot X_t + (1 - \alpha) \cdot S_{t-1}$$

其中 $\alpha \in (0, 1)$ 为平滑系数（建议取值 $0.15 \sim 0.2$）。

#### 关键实现逻辑

```typescript
export class GyroController {
  private rawBeta = 0;
  private rawGamma = 0;
  public pitch = 0; // 平滑后的俯仰角 (-1 到 1)
  public roll = 0;  // 平滑后的翻滚角 (-1 到 1)
  private alpha = 0.18;

  constructor() {
    this.initSensor();
  }

  public async requestPermission(): Promise<boolean> {
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      const permission = await (DeviceOrientationEvent as any).requestPermission();
      return permission === 'granted';
    }
    return true; // Non-iOS devices
  }

  private initSensor() {
    window.addEventListener('deviceorientation', (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      this.rawBeta = Math.min(Math.max(e.beta, -45), 45) / 45;   // 映射为 -1 ~ 1
      this.rawGamma = Math.min(Math.max(e.gamma, -45), 45) / 45;
    });
  }

  public update() {
    // 低通滤波平滑处理
    this.pitch += (this.rawBeta - this.pitch) * this.alpha;
    this.roll += (this.rawGamma - this.roll) * this.alpha;
  }
}

```

---

### 2.2 3D 场景与相机跟随 (`SceneManager.ts` & `SwiftPlayer.ts`)

#### 镜头追随模型 (Chase Camera)

采用**刚性延迟拉簧算法**（Spring-Arm Chase Camera），相机并不直接作为雨燕的子节点，而是在 Update 循环中以延迟插值的方式跟随雨燕的坐标，营造强烈的飞行速率感与视角变向开阔感。

```typescript
// 相机跟随 Update 逻辑
const idealOffset = new THREE.Vector3(0, 2.5, 6.0); // 相对雨燕后上方的偏移
idealOffset.applyQuaternion(swift.quaternion);
const targetCameraPos = swift.position.clone().add(idealOffset);

// 使用 Vector3.lerp 实现平滑移动
camera.position.lerp(targetCameraPos, delta * 5.0);
camera.lookAt(swift.position.clone().add(new THREE.Vector3(0, 0, -5))); // 永远聚焦前方

```

---

### 2.3 动态音频引擎 (`AudioEngine.ts`)

为实现“低能量时声音闷哑，高连击/高能量时音乐高潮”的机制，构建基于 Web Audio API 的音频节点图（Node Graph）：

```
[Audio Source Buffer] ──> [BiquadFilterNode] ──> [GainNode] ──> [AudioContext.destination]
                             (低通滤波控制音色)   (控制音量与淡入淡出)

```

#### 音频节点架构与状态响应

```typescript
export class AudioEngine {
  private ctx: AudioContext;
  private filterNode: BiquadFilterNode;
  private masterGain: GainNode;

  constructor() {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.filterNode = this.ctx.createBiquadFilter();
    this.filterNode.type = 'lowpass';
    this.filterNode.frequency.value = 22000; // 初始全频段通透

    this.masterGain = this.ctx.createGain();
    this.filterNode.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
  }

  // 依据雨燕当前的能量比例 (0.0 ~ 1.0) 动态调节低通滤波频率
  public updateEnergyState(energyRatio: number) {
    // 能量低时，截止频率降至 400Hz (声音变得低沉闷哑)
    const minFreq = 400;
    const maxFreq = 20000;
    const targetFreq = minFreq + (maxFreq - minFreq) * Math.pow(energyRatio, 2);
    
    // 平滑过渡，防止音频咔哒声 (Clipping)
    this.filterNode.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.1);
  }
}

```

---

### 2.4 对象池与场景生成器 (`ObjectPool.ts` & `LevelSpawner.ts`)

为了在移动端维持稳定 60 FPS，禁止在飞行过程中动态 `new THREE.Mesh()`，所有音符（Notes）、金币（Coins）、云朵障碍物必须采用**对象池模式 (Object Pooling)** 与 **实例化网格 (InstancedMesh)**：

1. **预加载阶段**：初始化 50 个音符 Mesh 和 20 个云朵 Mesh 放入 `inactivePool`。
2. **运行阶段**：随着雨燕向前飞行，从 `inactivePool` 获取对象移至前方 $Z$ 轴远处；超出身后一定距离的对象立刻回收回池中。

---

## 3. 项目目录结构 (Vibe Coding 推荐)

针对 Cursor / Claude 等 AI 引擎优化，目录结构遵循“单职责、强类型、浅层嵌套”原则：

```text
swift-song/
├── index.html                   # HTML 模板 (包含移动端 Viewport 设置)
├── package.json                 # 项目依赖配置
├── vite.config.ts               # Vite 构建设置
├── capacitor.config.json        # Capacitor 打包配置文件
├── src/
│   ├── main.ts                  # 入口文件：初始化与主循环入口
│   ├── core/                    # 核心逻辑
│   │   ├── Game.ts              # 游戏状态总控 (State Machine)
│   │   └── Loop.ts              # RequestAnimationFrame 定时器
│   ├── entities/                # 场景实体
│   │   ├── Swift.ts             # 雨燕模型与网格变换控制
│   │   ├── NoteItem.ts          # 节奏音符实体
│   │   └── Obstacle.ts          # 气流/障碍物
│   ├── systems/                 # 系统模块
│   │   ├── GyroController.ts    # 陀螺仪/重力感应平滑接入
│   │   ├── SceneManager.ts      # Three.js 场景/灯光/相机设置
│   │   ├── AudioEngine.ts       # Web Audio 动态混音引擎
│   │   ├── CollisionSystem.ts   # 碰撞检查 (BoundingSphere)
│   │   └── LevelSpawner.ts      # 对象池与无限轨道生成
│   ├── ui/                      # 2D 悬浮 UI 覆盖层
│   │   ├── HUD.ts               # 能量条/分数/Combo 展示
│   │   └── PermissionModal.ts   # iOS 陀螺仪授权弹窗
│   └── utils/                   # 工具类
│       └── MathUtils.ts         # Lerp / 低通滤波 / 随机插值函数
└── public/
    ├── assets/                  # 模型 (.glb)、音频 (.mp3)、纹理
    └── icons/                   # App 图标与启动图

```

---

## 4. 性能优化与打包部署流程

### 4.1 性能优化策略 (Performance Optimization Checklist)

1. **Draw Call 压制**：远景背景云层和重复音符使用 `InstancedMesh`，将 Draw Call 控制在 **30 以下**。
2. **内存零 GC 抖动**：在 `update()` 循环中禁止声明临时 `new THREE.Vector3()` 或 `new THREE.Quaternion()`，统一复用静态预分配的临时变量（Temp Vector）。
3. **分辨率自适应**：在移动端设定 `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`，防止高分屏（3K/4K）导致 GPU 渲染过载。

### 4.2 Capacitor APP 封装工作流

```bash
# 1. 构建 Web 静态产物
npm run build

# 2. 首次集成 Capacitor (仅执行一次)
npm install @capacitor/core @capacitor/cli @capacitor/haptics
npx cap init "Song of the Swift" "com.swiftsong.game" --web-dir "dist"

# 3. 添加原生平台工程
npx cap add ios
npx cap add android

# 4. 同步 Web 编译产物至 Native 工程
npx cap sync

# 5. 打开 Xcode / Android Studio 进行 App 打包发布
npx cap open ios
npx cap open android

```