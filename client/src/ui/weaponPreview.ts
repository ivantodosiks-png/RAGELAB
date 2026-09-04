import * as THREE from 'three';
import { getWeapon, isWeaponId, type WeaponId } from '@ragelab/shared';
import { createWeaponVisual, loadWeaponModel, weaponPhysics } from '../weapons/weaponAssets';

/** Small rotating weapon canvas for the loadout screen. One model at a time. */
export class WeaponPreview {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1.4, 0.05, 8);
  private readonly pivot = new THREE.Group();
  private raf = 0;
  private running = false;
  private current: THREE.Object3D | null = null;
  private token = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mm-preview-canvas';
    this.canvas.width = 420;
    this.canvas.height = 300;
    this.scene.background = new THREE.Color(0x080b09);
    this.scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x2a241c, 1.15));
    const key = new THREE.DirectionalLight(0xfff4e2, 1.7);
    key.position.set(1.2, 1.8, 1.4);
    this.scene.add(key);
    const fill = new THREE.PointLight(0xd6ff3d, 0.35, 4, 2);
    fill.position.set(-0.6, 0.4, 0.8);
    this.scene.add(fill);
    this.scene.add(this.pivot);
    this.camera.position.set(0.18, 0.16, 0.72);
    this.camera.lookAt(0, 0.02, 0);
  }

  mount(host: HTMLElement): void {
    host.append(this.canvas);
    if (this.running) return;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'low-power',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.canvas.clientWidth || 420, this.canvas.clientHeight || 300, false);
    this.running = true;
    this.tick();
  }

  show(id: WeaponId): void {
    const mine = ++this.token;
    this.swap(id);
    void loadWeaponModel(id).then(() => {
      if (mine !== this.token) return;
      this.swap(id);
    });
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.clearModel();
    this.renderer?.dispose();
    this.renderer?.getContext()?.getExtension('WEBGL_lose_context')?.loseContext();
    this.renderer = null;
    this.canvas.remove();
  }

  private swap(id: WeaponId): void {
    if (!isWeaponId(id)) return;
    this.clearModel();
    const def = getWeapon(id);
    const visual = createWeaponVisual(id, weaponPhysics(id).length || def.visual.size[2], {
      lod: false,
      shadows: false,
    });
    if (!visual) return;
    visual.rotation.y = 0.35;
    this.current = visual;
    this.pivot.add(visual);
  }

  private clearModel(): void {
    if (!this.current) return;
    this.pivot.remove(this.current);
    this.current.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) mat.dispose();
    });
    this.current = null;
  }

  private tick = (): void => {
    if (!this.running || !this.renderer) return;
    this.raf = requestAnimationFrame(this.tick);
    this.pivot.rotation.y += 0.006;
    this.pivot.rotation.x = Math.sin(this.pivot.rotation.y * 0.5) * 0.04;
    this.renderer.render(this.scene, this.camera);
  };
}
