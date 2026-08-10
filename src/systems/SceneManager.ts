/**
 * 3D 场景管理器：相机、灯光、雾、远景天穹、追逐相机。
 */
import * as THREE from 'three';

export class SceneManager {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly canvas: HTMLCanvasElement;

  // 复用临时向量，避免 GC
  private tmpOffset = new THREE.Vector3();
  private tmpTarget = new THREE.Vector3();
  private tmpLookAt = new THREE.Vector3();

  // 远景星点 / 云
  private starField!: THREE.Points;
  private cloudGroup!: THREE.Group;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();

    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 2000);
    this.camera.position.set(0, 4, 10);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x0a0e1a, 1);

    this.buildEnvironment();
    this.bindResize();
  }

  /** 灯光 / 雾 / 天穹 / 远景 */
  private buildEnvironment() {
    // 黄昏调色雾
    this.scene.fog = new THREE.FogExp2(0x1a2440, 0.012);

    const hemi = new THREE.HemisphereLight(0xffd9a0, 0x335577, 1.0);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xfff0d0, 1.2);
    dir.position.set(-30, 40, -20);
    this.scene.add(dir);

    // 天穹渐变色球
    const skyGeo = new THREE.SphereGeometry(800, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor: { value: new THREE.Color(0x0a1430) },
        midColor: { value: new THREE.Color(0x2a3a66) },
        botColor: { value: new THREE.Color(0xff9a6b) }
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main(){
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vPos;
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 botColor;
        void main(){
          float h = normalize(vPos).y;
          vec3 col;
          if(h > 0.0){
            col = mix(midColor, topColor, clamp(h*1.4,0.0,1.0));
          } else {
            col = mix(midColor, botColor, clamp(-h*2.0,0.0,1.0));
          }
          gl_FragColor = vec4(col,1.0);
        }
      `
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));

    // 星点
    const starCount = 600;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 400;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.5; // 上半球
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi) * 0.6 + 40;
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.6,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.85
    });
    this.starField = new THREE.Points(starGeo, starMat);
    this.scene.add(this.starField);

    // 远景云团（low-poly 球簇）
    this.cloudGroup = new THREE.Group();
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0x88a0c8,
      flatShading: true,
      transparent: true,
      opacity: 0.55
    });
    for (let i = 0; i < 18; i++) {
      const cloud = new THREE.Group();
      const n = 3 + Math.floor(Math.random() * 3);
      for (let j = 0; j < n; j++) {
        const r = 6 + Math.random() * 8;
        const g = new THREE.IcosahedronGeometry(r, 0);
        const m = new THREE.Mesh(g, cloudMat);
        m.position.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 16);
        cloud.add(m);
      }
      cloud.position.set(
        (Math.random() - 0.5) * 400,
        20 + Math.random() * 40,
        -100 - Math.random() * 400
      );
      this.cloudGroup.add(cloud);
    }
    this.scene.add(this.cloudGroup);
  }

  private bindResize() {
    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
  };

  /** 追逐相机：以弹簧延迟跟随目标 */
  public updateChaseCamera(
    targetPos: THREE.Vector3,
    targetQuat: THREE.Quaternion,
    dt: number,
    slowmo = false
  ) {
    const back = slowmo ? 9.0 : 6.0;
    const up = slowmo ? 3.2 : 2.5;

    this.tmpOffset.set(0, up, back).applyQuaternion(targetQuat);
    this.tmpTarget.copy(targetPos).add(this.tmpOffset);

    const lerpFactor = slowmo ? 1.5 : 5.0;
    this.camera.position.lerp(this.tmpTarget, Math.min(1, dt * lerpFactor));

    this.tmpLookAt.copy(targetPos);
    this.tmpLookAt.z -= 5; // 聚焦前方
    this.camera.lookAt(this.tmpLookAt);
  }

  public render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** 让远景随玩家做轻微视差移动 */
  public parallax(playerX: number) {
    this.starField.position.x = playerX * -0.2;
    this.cloudGroup.position.x = playerX * -0.4;
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}
