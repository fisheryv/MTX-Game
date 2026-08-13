# 雨燕：无尽旋律（Swift: Endless Melody）

> “这世界上有一种鸟是没有脚的，它只能一直飞呀飞，飞累了就在风里睡觉。这种鸟一辈子只能落地一次，那一次就是它死亡的时候……”
> ——《阿飞正传》

这是我在 MTX 青少年音乐科技培养项目期间 vibe coding 的个人课余项目，是一款以“雨燕一生永不落地”的民俗传说为情感锚点的 **3D 无限飞行 / 节奏收集** 休闲游戏。玩家扮演一只刚破壳的新生雨燕，在生命尽头到来前飞过清晨、黄昏、夜空与雷暴，把散落在大气层中的断裂乐节缝合为一首完整的《天空绝响》。

---

## 目录

- [核心概念](#核心概念)
- [核心玩法](#核心玩法)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [打包与部署（iOS / Android）](#打包与部署ios--android)
- [文档](#文档)

---

## 核心概念

| 维度 | 说明 |
| --- | --- |
| **游戏类型** | 3D 无限飞行 / 节奏收集 / 休闲体验（3D Endless Flier / Rhythm Runner） |
| **核心意象** | 以“飞翔即生存”表达自由、宿命与极致的节奏美感 |
| **操控模式** | 移动端原生传感器（陀螺仪 + 重力感应），无需虚拟摇杆 |
| **目标平台** | iOS / Android（Web 端亦可运行） |
| **视觉调性** | 低多边形 / 写意渲染风格 + 空灵清澈的动态音效 |

---

## 核心玩法

### 操控与体感
- **左右倾斜**：控制雨燕横向平移与翻滚（Roll）。
- **俯冲与拉升**：向前倾斜俯冲加速（增加动能），向后倾斜拉升仰角（提高操作精度）。
- **点击 / 长按**：辅助交互，用于紧急避险与滑翔。

### 能量系统
- 能量槽随时间持续衰减，衰减速率随飞行距离逐步提升；归零即触发“落地”终局（Game Over）。
- **吃音符**是主要能量来源，音符随背景音乐节奏在空中呈弧线 / 螺旋排布。
- **连击共振**：连续按节奏吃满一串音符，回复额外能量并短时降低衰减速度。

### 动态音乐
- **层叠式音乐**：低能量时音乐低沉闷哑（低通滤波），高能量 / 高连击时逐步叠加打击乐与管弦乐，走向高潮。
- 玩家的飞行轨迹即是在“演奏”这首曲子——每一个被收集的音符都是主旋律的构成音符。

### 环境与障碍
- **上升气流（Thermal Updrafts）**：进入后无需消耗能量并被风场托举上升、自动加速前进。
- **逆风与雷暴（Turbulence）**：使体感控制产生偏移或阻力。
- **环境障碍**：悬崖突石、枯木、高空云层雷电，碰撞会导致大量能量流失并打断连击。

### 教学关卡：《序章：初响与试翼》
遵循“零冗余文字、情境化体感校准、音效即反馈”原则，让玩家在约 90 秒内自然掌握体感操控与节奏感知，并无缝过渡至无尽模式。

---

## 技术栈

基于 **Vite + TypeScript + Three.js + Web Audio API + Capacitor** 的单页应用（SPA）架构，采用纯代码驱动模式。

本项目用到的素材全部由AI生成：

- 图片：GPT Image 2
- 音乐：Suno
- 3D模型：meshy.ai

| 模块 | 选用技术 | 说明 |
| --- | --- | --- |
| 构建工具 | Vite + TypeScript | 毫秒级 HMR 热重载，原生模块化，强类型提示 |
| 3D 渲染 | Three.js (r160) | Web 3D 主控渲染库 |
| 音频引擎 | Web Audio API | 原生音频节点链式调用、低通滤波、多轨实时淡入淡出 |
| 物理碰撞 | Three.js Bounding Volume / Raycaster | 轻量化“球体 / 射线”碰撞算法 |
| 跨端打包 | Capacitor 6 | 轻量 Web 容器，桥接原生陀螺仪与触控震动（Haptics） |

**性能优化要点**：使用 `InstancedMesh` 压制 Draw Call、`update()` 循环内复用预分配临时变量避免 GC 抖动、`setPixelRatio(Math.min(devicePixelRatio, 2))` 分辨率自适应。

---

## 项目结构

```text
swift-endless-melody/
├── index.html                # HTML 模板（含移动端 Viewport 设置）
├── package.json              # 项目依赖与脚本
├── vite.config.ts            # Vite 构建设置
├── capacitor.config.json     # Capacitor 打包配置
├── src/
│   ├── main.ts               # 入口文件：初始化与主循环接线
│   ├── styles.css            # 全局样式与 UI 覆盖层样式
│   ├── types.ts              # 全局类型定义
│   ├── core/                 # 核心逻辑
│   │   ├── Game.ts           # 游戏状态总控（State Machine）
│   │   └── Loop.ts           # RequestAnimationFrame 主循环
│   ├── entities/             # 场景实体
│   │   ├── Swift.ts          # 雨燕模型与网格变换
│   │   ├── NoteItem.ts       # 节奏音符
│   │   ├── Coin.ts           # 星芒金币
│   │   ├── Ring.ts           # 引导光环
│   │   └── Obstacle.ts       # 气流 / 障碍物
│   ├── systems/              # 系统模块
│   │   ├── GyroController.ts # 陀螺仪 / 重力感应平滑接入
│   │   ├── SceneManager.ts   # Three.js 场景 / 灯光 / 相机
│   │   ├── AudioEngine.ts    # Web Audio 动态混音引擎
│   │   ├── CollisionSystem.ts# 碰撞检测（BoundingSphere）
│   │   ├── LevelSpawner.ts   # 无限轨道生成
│   │   ├── ObjectPool.ts     # 对象池
│   │   ├── AssetLoader.ts    # 资源加载（.glb 模型等）
│   │   ├── ParticleBurst.ts  # 粒子特效
│   │   └── TutorialDirector.ts # 教学关卡编排
│   ├── ui/                   # 2D 悬浮 UI 覆盖层
│   │   ├── HUD.ts            # 能量条 / 分数 / Combo
│   │   ├── IntroScreen.ts    # 序章 / 启动界面
│   │   ├── MenuOverlays.ts   # 主菜单帮助 / 设置面板
│   │   └── PermissionModal.ts# 陀螺仪授权弹窗
│   └── utils/
│       └── MathUtils.ts      # Lerp / 低通滤波 / 随机插值
├── android/                  # Capacitor Android 原生工程
└── ios/                      # Capacitor iOS 原生工程
```

---

## 快速开始

### 环境要求
- Node.js 18+
- npm

### 安装依赖

```bash
npm install
```

### 本地开发（热重载）

```bash
npm run dev
```

启动后按终端提示在浏览器打开本地地址。开发服务器已启用 `host: true`，可在同一局域网内用手机访问，体验真机陀螺仪体感操控。

### 类型检查

```bash
npm run typecheck
```

### 生产构建

```bash
npm run build
```

构建产物输出到 `dist/`。可用 `npm run preview` 本地预览生产包。

---

## 打包与部署（iOS / Android）

项目已集成 Capacitor 6，`android/` 与 `ios/` 原生工程已生成。

### 常用脚本

```bash
# 构建 Web 产物并同步到全部原生平台
npm run cap:sync

# 构建 + 同步 + 打开 Android Studio
npm run cap:android

# 构建 + 同步 + 打开 Xcode
npm run cap:ios
```

### 手动工作流

```bash
# 1. 构建 Web 静态产物
npm run build

# 2. 同步 Web 编译产物至原生工程
npx cap sync

# 3. 打开原生 IDE 进行打包发布
npx cap open android   # Android Studio
npx cap open ios       # Xcode
```

打开原生 IDE 后，即可用其自身工具链完成签名、构建安装包与发布。

> Capacitor 应用配置见 [capacitor.config.json](capacitor.config.json)：`appId` = `com.fisheryv.swift`，`webDir` = `dist`，已启用 Haptics 触控震动插件。

---

## License

见 [LICENSE](LICENSE)。
