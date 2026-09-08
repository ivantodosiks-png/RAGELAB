import * as THREE from 'three';
import { assetManager } from '../assets/assetManager';
import { cityModelScale, cityModelUrl } from '../maps/mapCatalog';

const SET_PIECES: Array<{
  id: string;
  pos: [number, number, number];
  yaw: number;
  bob?: number;
  scale?: number;
}> = [
  { id: 'tree-large', pos: [-10, 0, -6], yaw: 0.4, bob: 0.025, scale: 1.15 },
  { id: 'tree-large', pos: [12, 0, -10], yaw: -0.55, bob: 0.03, scale: 1.3 },
  { id: 'tree-large', pos: [-18, 0, -16], yaw: 0.9, bob: 0.02, scale: 1.05 },
  { id: 'tree-large', pos: [8, 0, -22], yaw: -0.2, bob: 0.028, scale: 1.4 },
  { id: 'tree-large', pos: [-4, 0, -28], yaw: 1.2, bob: 0.022, scale: 1.2 },
  { id: 'tree-small', pos: [4, 0, -4], yaw: 0.7, bob: 0.04, scale: 1.1 },
  { id: 'tree-small', pos: [-7, 0, 2], yaw: -0.8, bob: 0.045 },
  { id: 'tree-small', pos: [16, 0, -2], yaw: 0.3, bob: 0.038, scale: 0.95 },
  { id: 'tree-small', pos: [-14, 0, 4], yaw: 1.4, bob: 0.05 },
  { id: 'tree-small', pos: [2, 0, -14], yaw: -1.1, bob: 0.035, scale: 1.15 },
  { id: 'lamp', pos: [-2.4, 0, 5.5], yaw: 0.15 },
  { id: 'lamp', pos: [6.2, 0, 3.2], yaw: -0.35 },
  { id: 'barrier', pos: [0.8, 0, 7.4], yaw: 1.1 },
  { id: 'cone', pos: [-0.6, 0, 6.8], yaw: 0.4 },
  { id: 'fence', pos: [11, 0, 4], yaw: 1.35, scale: 0.9 },
];

/**
 * Cinematic forest backdrop on the game canvas while the main menu is open.
 * Disposed before GameSession takes the same canvas.
 */
export class MenuBackdrop {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.2, 140);
  private readonly clock = new THREE.Clock();
  private raf = 0;
  private running = false;
  private disposed = false;
  private readonly particles: THREE.Points;
  private readonly embers: THREE.Points;
  private readonly sun: THREE.DirectionalLight;
  private readonly lamp: THREE.PointLight;
  private readonly lampB: THREE.PointLight;
  private readonly rim: THREE.DirectionalLight;
  private readonly bobbers: Array<{ obj: THREE.Object3D; baseY: number; amp: number; phase: number }> = [];
  private readonly haze: THREE.Mesh;
  private readonly blurPlane: THREE.Mesh;
  private flickerPhase = Math.random() * 100;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.scene.background = new THREE.Color(0x070a06);
    this.scene.fog = new THREE.FogExp2(0x0a1008, 0.038);

    this.scene.add(new THREE.HemisphereLight(0x6a7a58, 0x10140e, 0.38));

    this.sun = new THREE.DirectionalLight(0xc8b090, 0.85);
    this.sun.position.set(8, 14, 6);
    this.scene.add(this.sun);

    this.rim = new THREE.DirectionalLight(0x3a4a28, 0.28);
    this.rim.position.set(-10, 5, -8);
    this.scene.add(this.rim);

    this.lamp = new THREE.PointLight(0xffb24a, 1.1, 28, 2);
    this.lamp.position.set(-2.4, 4.4, 5.5);
    this.scene.add(this.lamp);

    this.lampB = new THREE.PointLight(0xff8a30, 0.45, 18, 2);
    this.lampB.position.set(6.2, 4.0, 3.2);
    this.scene.add(this.lampB);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(56, 64),
      new THREE.MeshStandardMaterial({ color: 0x12180f, roughness: 0.96, metalness: 0.02 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    this.haze = new THREE.Mesh(
      new THREE.PlaneGeometry(70, 22),
      new THREE.MeshBasicMaterial({
        color: 0x8aa060,
        transparent: true,
        opacity: 0.03,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.haze.position.set(0, 5, -10);
    this.haze.rotation.y = 0.15;
    this.scene.add(this.haze);

    this.blurPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 50),
      new THREE.MeshBasicMaterial({
        color: 0x050805,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    this.blurPlane.position.set(0, 4, 4);
    this.scene.add(this.blurPlane);

    this.particles = makeDust(120, 0xb8c090, 0.04, 0.18);
    this.embers = makeDust(36, 0xff9a40, 0.055, 0.2);
    this.scene.add(this.particles, this.embers);
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'low-power',
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.82;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.15));
    this.resize();
    this.running = true;
    this.clock.start();
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    void this.dressSet();
    this.tick();
  }

  stop(): void {
    if (!this.running && !this.renderer) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.renderer?.dispose();
    this.renderer = null;
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) mat?.dispose();
      }
      const pts = obj as THREE.Points;
      if (pts.isPoints) {
        pts.geometry?.dispose();
        (pts.material as THREE.Material)?.dispose();
      }
    });
  }

  private readonly onResize = (): void => this.resize();

  private readonly onVisibility = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      return;
    }
    if (this.running) this.tick();
  };

  private resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer?.setSize(w, h, false);
  }

  private async dressSet(): Promise<void> {
    for (const piece of SET_PIECES) {
      if (this.disposed || !this.running) return;
      let clone: THREE.Object3D | null = null;
      try {
        const url = cityModelUrl(piece.id);
        clone = await assetManager.cloneSceneWhenReady(url);
      } catch {
        continue;
      }
      if (!clone || this.disposed || !this.running) continue;
      const scale = cityModelScale(piece.id) * 0.42 * (piece.scale ?? 1);
      clone.scale.setScalar(scale);
      clone.position.set(...piece.pos);
      clone.rotation.y = piece.yaw;
      clone.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = false;
          mesh.receiveShadow = false;
        }
      });
      this.scene.add(clone);
      if (piece.bob) {
        this.bobbers.push({
          obj: clone,
          baseY: piece.pos[1],
          amp: piece.bob,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
  }

  private tick = (): void => {
    if (!this.running || !this.renderer) return;
    this.raf = requestAnimationFrame(this.tick);
    if (document.hidden) return;
    const t = this.clock.getElapsedTime();

    const radius = 16.5 + Math.sin(t * 0.07) * 0.7;
    const yaw = t * 0.018;
    const elev = 5.2 + Math.sin(t * 0.1) * 0.35;
    this.camera.position.set(Math.sin(yaw) * radius, elev, Math.cos(yaw) * radius * 0.92);
    this.camera.lookAt(
      Math.sin(t * 0.05) * 0.5,
      2.0 + Math.sin(t * 0.09) * 0.1,
      Math.cos(t * 0.04) * 0.35,
    );

    this.sun.intensity = 0.78 + Math.sin(t * 0.28) * 0.08;
    // Irregular bulb flicker — like a dying street lamp in fog.
    const flicker =
      0.55 +
      0.45 * Math.max(0, Math.sin(t * 17.3 + this.flickerPhase)) *
        Math.max(0, Math.sin(t * 31.1 + 1.7)) *
        (0.65 + 0.35 * Math.sin(t * 2.4));
    const dip = Math.sin(t * 0.9 + this.flickerPhase) > 0.92 ? 0.15 : 1;
    this.lamp.intensity = 0.35 + 1.35 * flicker * dip;
    this.lampB.intensity = 0.18 + 0.55 * flicker * (0.7 + 0.3 * dip);
    this.rim.intensity = 0.18 + Math.sin(t * 0.45) * 0.05;
    if (this.haze.material instanceof THREE.MeshBasicMaterial) {
      this.haze.material.opacity = 0.024 + Math.sin(t * 0.35) * 0.01;
    }
    this.haze.rotation.z = Math.sin(t * 0.07) * 0.04;
    if (this.blurPlane.material instanceof THREE.MeshBasicMaterial) {
      this.blurPlane.material.opacity = 0.24 + Math.sin(t * 0.22) * 0.05;
    }
    this.blurPlane.lookAt(this.camera.position);

    driftParticles(this.particles, 0.0045);
    driftParticles(this.embers, 0.0028, true);

    for (const b of this.bobbers) {
      b.obj.position.y = b.baseY + Math.sin(t * 0.55 + b.phase) * b.amp;
      b.obj.rotation.y += 0.00025;
    }

    this.renderer.render(this.scene, this.camera);
  };
}

function driftParticles(points: THREE.Points, speed: number, swirl = false): void {
  const pos = points.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let y = pos.getY(i) + speed + (i % 7) * 0.00025;
    if (y > 10) y = 0.15;
    pos.setY(i, y);
    if (swirl) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setX(i, x + Math.sin(y + i) * 0.002);
      pos.setZ(i, z + Math.cos(y + i * 0.3) * 0.002);
    }
  }
  pos.needsUpdate = true;
}

function makeDust(count: number, color: number, size: number, opacity: number): THREE.Points {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 44;
    positions[i * 3 + 1] = Math.random() * 10;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 44;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color,
    size,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}
