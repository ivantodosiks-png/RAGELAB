import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { QualityLevel, type GraphicsSettings, type MapDefinition } from '@ragelab/shared';
import { LAYER_WORLD } from './layers';

/**
 * Owns the WebGL renderer, scene, camera and environment. Quality settings are
 * applied here and nowhere else, so switching preset is a single call.
 */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Separate camera+scene for the weapon view model so it never clips walls. */
  readonly viewModelScene = new THREE.Scene();
  readonly viewModelCamera: THREE.PerspectiveCamera;

  private readonly sun: THREE.DirectionalLight;
  private readonly ambient: THREE.HemisphereLight;
  private readonly sky: THREE.Mesh;
  private readonly dynamicLights: THREE.PointLight[] = [];
  private readonly lightsBySwitch = new Map<string, THREE.PointLight[]>();

  private settings: GraphicsSettings;
  private targetPixelRatio = 1;

  constructor(canvas: HTMLCanvasElement, settings: GraphicsSettings) {
    this.settings = settings;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: settings.antialias,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;

    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.08, settings.renderDistance);
    this.camera.layers.set(LAYER_WORLD);
    this.viewModelCamera = new THREE.PerspectiveCamera(65, 1, 0.005, 6);

    this.ambient = new THREE.HemisphereLight(0xb8cce0, 0x6a6458, 0.62);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff1d4, 2.15);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(settings.shadowResolution, settings.shadowResolution);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 220;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    const shadowExtent = 70;
    this.sun.shadow.camera.left = -shadowExtent;
    this.sun.shadow.camera.right = shadowExtent;
    this.sun.shadow.camera.top = shadowExtent;
    this.sun.shadow.camera.bottom = -shadowExtent;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // The view model needs its own light or it renders black.
    const viewModelLight = new THREE.DirectionalLight(0xfff8ee, 4.2);
    viewModelLight.position.set(0.4, 1.35, 1.1);
    this.viewModelScene.add(viewModelLight);
    const fill = new THREE.DirectionalLight(0xc5dcff, 1.65);
    fill.position.set(-0.7, 0.35, 0.55);
    this.viewModelScene.add(fill);
    const rim = new THREE.DirectionalLight(0xffe7c4, 1.1);
    rim.position.set(0.1, 0.4, -0.8);
    this.viewModelScene.add(rim);
    this.viewModelScene.add(new THREE.AmbientLight(0xe8eef6, 1.85));

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    const envMap = pmrem.fromScene(room, 0.03).texture;
    room.dispose();
    this.scene.environment = envMap;
    this.scene.environmentIntensity = 0.38;
    this.viewModelScene.environment = envMap;
    this.viewModelScene.environmentIntensity = 0.7;
    pmrem.dispose();

    this.sky = this.createSky();
    this.scene.add(this.sky);

    this.applySettings(settings);
  }

  private createSky(): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(1, 24, 16);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x5a8ec8) },
        bottomColor: { value: new THREE.Color(0xf0d9a8) },
        sunDirection: { value: new THREE.Vector3(0.4, 0.8, 0.45) },
        sunColor: { value: new THREE.Color(0xffe9c4) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform vec3 sunDirection;
        uniform vec3 sunColor;
        varying vec3 vDirection;
        void main() {
          float h = clamp(vDirection.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 sky = mix(bottomColor, topColor, pow(h, 0.85));
          float sun = max(dot(normalize(vDirection), normalize(sunDirection)), 0.0);
          sky += sunColor * pow(sun, 220.0) * 2.4;
          sky += sunColor * pow(sun, 8.0) * 0.12;
          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    return mesh;
  }

  applyEnvironment(map: MapDefinition): void {
    const env = map.environment;
    const uniforms = (this.sky.material as THREE.ShaderMaterial).uniforms;
    uniforms.topColor!.value.setHex(env.skyTop);
    uniforms.bottomColor!.value.setHex(env.skyBottom);
    uniforms.sunColor!.value.setHex(env.sunColor);
    uniforms.sunDirection!.value.set(...env.sunDirection).normalize();

    this.sun.color.setHex(env.sunColor);
    this.sun.intensity = env.sunIntensity;
    this.sun.position.set(...env.sunDirection).normalize().multiplyScalar(110);
    const ext = Math.min(96, Math.max(56, map.bounds + 12));
    this.sun.shadow.camera.left = -ext;
    this.sun.shadow.camera.right = ext;
    this.sun.shadow.camera.top = ext;
    this.sun.shadow.camera.bottom = -ext;
    this.sun.shadow.camera.updateProjectionMatrix();

    this.ambient.color.setHex(env.ambientColor);
    this.ambient.groundColor.setHex(env.fogColor);
    this.ambient.intensity = env.ambientIntensity;

    const fogColor = new THREE.Color(env.fogColor).lerp(new THREE.Color(env.skyBottom), 0.4);
    this.scene.fog = new THREE.FogExp2(fogColor, env.fogDensity * 0.42);

    // Rebuild the map's dynamic lights at the current quality level.
    for (const light of this.dynamicLights) {
      light.parent?.remove(light);
      light.dispose();
    }
    this.dynamicLights.length = 0;
    this.lightsBySwitch.clear();

    const budget = this.lightBudget();
    let added = 0;
    for (const def of map.lights) {
      if (added >= budget) break;
      if (!this.lightPassesQuality(def.quality)) continue;
      const light = new THREE.PointLight(def.color, def.intensity, def.distance, 2);
      light.position.set(...def.position);
      light.castShadow = false;
      this.scene.add(light);
      this.dynamicLights.push(light);
      added += 1;
      if (def.switchId) {
        const list = this.lightsBySwitch.get(def.switchId) ?? [];
        list.push(light);
        this.lightsBySwitch.set(def.switchId, list);
      }
    }
  }

  private lightBudget(): number {
    switch (this.settings.quality) {
      case QualityLevel.Low:
        return 0;
      case QualityLevel.Medium:
        return 4;
      case QualityLevel.High:
        return 8;
      default:
        return 16;
    }
  }

  private lightPassesQuality(required: 'low' | 'medium' | 'high' | undefined): boolean {
    const order = { low: 0, medium: 1, high: 2, ultra: 3 } as const;
    const current = order[this.settings.quality];
    if (!required) return current >= order.medium;
    return current >= order[required];
  }

  setSwitchLights(switchId: string, on: boolean): void {
    for (const light of this.lightsBySwitch.get(switchId) ?? []) {
      light.visible = on;
    }
  }

  applySettings(settings: GraphicsSettings): void {
    const shadowResChanged = settings.shadowResolution !== this.settings.shadowResolution;
    this.settings = settings;

    this.renderer.shadowMap.enabled = settings.shadows;
    if (shadowResChanged) {
      this.sun.shadow.mapSize.set(settings.shadowResolution, settings.shadowResolution);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.sun.castShadow = settings.shadows;

    this.camera.fov = settings.fov;
    this.camera.far = settings.renderDistance;
    this.camera.updateProjectionMatrix();

    this.targetPixelRatio = Math.min(
      window.devicePixelRatio || 1,
      Math.max(0.5, settings.resolutionScale) * (window.devicePixelRatio || 1),
      settings.quality === QualityLevel.Low ? 1 : 2,
    );
    this.resize();
  }

  /** Keep the shadow frustum centred on the player so shadows stay crisp. */
  updateShadowFocus(x: number, z: number): void {
    if (!this.settings.shadows) return;
    this.sun.target.position.set(x, 0, z);
    const dir = this.sun.position.clone().normalize().multiplyScalar(110);
    this.sun.position.set(x + dir.x, dir.y, z + dir.z);
    this.sun.target.updateMatrixWorld();
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.targetPixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.viewModelCamera.aspect = width / height;
    this.viewModelCamera.updateProjectionMatrix();
  }

  render(): void {
    this.sky.position.copy(this.camera.position);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    // View model on top, depth-cleared so it is never occluded by geometry.
    this.renderer.clearDepth();
    this.renderer.render(this.viewModelScene, this.viewModelCamera);
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  get triangles(): number {
    return this.renderer.info.render.triangles;
  }

  dispose(): void {
    for (const light of this.dynamicLights) light.dispose();
    this.dynamicLights.length = 0;
    const gl = this.renderer.getContext();
    this.renderer.dispose();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
