import * as THREE from 'three';
import { assetManager } from '../assets/assetManager';
import { cityModelScale, cityModelUrl } from '../maps/mapCatalog';

const SET_PIECES: Array<{
  id: string;
  pos: [number, number, number];
  yaw: number;
  bob?: number;
}> = [
  { id: 'building-h', pos: [-14, 0, -8], yaw: 0.2 },
  { id: 'building-a', pos: [-22, 0, -18], yaw: 0.55 },
  { id: 'house-c', pos: [12, 0, -10], yaw: -0.4 },
  { id: 'skyscraper-a', pos: [18, 0, -22], yaw: -0.15 },
  { id: 'tree-large', pos: [6, 0, 4], yaw: 0.8, bob: 0.035 },
  { id: 'tree-small', pos: [-8, 0, 9], yaw: 1.1, bob: 0.05 },
  { id: 'lamp', pos: [-3, 0, 6], yaw: 0 },
  { id: 'lamp', pos: [8.5, 0, -2], yaw: 0.4 },
  { id: 'barrier', pos: [1.6, 0, 8.2], yaw: 1.2 },
  { id: 'cone', pos: [-1.2, 0, 7.4], yaw: 0.3 },
];

/**
 * Lightweight cinematic world on the game canvas while the main menu is open.
 * Disposed before GameSession takes the same canvas.
 */
export class MenuBackdrop {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(46, 1, 0.2, 110);
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

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.scene.background = new THREE.Color(0x050708);
    this.scene.fog = new THREE.FogExp2(0x070a0c, 0.028);

    this.scene.add(new THREE.HemisphereLight(0xa8c0d4, 0x1a1612, 0.48));

    this.sun = new THREE.DirectionalLight(0xffd8b0, 1.45);
    this.sun.position.set(12, 18, 9);
    this.scene.add(this.sun);

    this.rim = new THREE.DirectionalLight(0xd6ff3d, 0.22);
    this.rim.position.set(-8, 6, -10);
    this.scene.add(this.rim);

    this.lamp = new THREE.PointLight(0xd6ff3d, 0.7, 22, 2);
    this.lamp.position.set(-3, 4.2, 6);
    this.scene.add(this.lamp);

    this.lampB = new THREE.PointLight(0xff8a4a, 0.35, 16, 2);
    this.lampB.position.set(8.5, 3.8, -2);
    this.scene.add(this.lampB);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(48, 64),
      new THREE.MeshStandardMaterial({ color: 0x101412, roughness: 0.94, metalness: 0.05 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(44, 32, 0x2f3d30, 0x141916);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.18;
    this.scene.add(grid);

    this.haze = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 18),
      new THREE.MeshBasicMaterial({
        color: 0xd6ff3d,
        transparent: true,
        opacity: 0.035,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.haze.position.set(0, 5, -8);
    this.haze.rotation.y = 0.15;
    this.scene.add(this.haze);

    this.particles = makeDust(120, 0xd6ff3d, 0.04, 0.26);
    this.embers = makeDust(40, 0xff7a45, 0.055, 0.18);
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
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.2));
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
    // Do NOT force-lose the WebGL context — the same #viewport canvas is reused
    // by GameSession. Losing it makes the next renderer fail to start.
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
      const scale = cityModelScale(piece.id) * 0.42;
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

    const radius = 17.8 + Math.sin(t * 0.09) * 0.7;
    const yaw = t * 0.028;
    const elev = 5.9 + Math.sin(t * 0.14) * 0.55;
    this.camera.position.set(
      Math.sin(yaw) * radius,
      elev,
      Math.cos(yaw) * radius * 0.88,
    );
    this.camera.lookAt(
      Math.sin(t * 0.07) * 0.6,
      2.0 + Math.sin(t * 0.11) * 0.15,
      Math.cos(t * 0.05) * 0.4,
    );

    this.sun.intensity = 1.28 + Math.sin(t * 0.35) * 0.14;
    this.lamp.intensity = 0.52 + Math.sin(t * 1.5) * 0.14;
    this.lampB.intensity = 0.28 + Math.sin(t * 1.1 + 1.2) * 0.1;
    this.rim.intensity = 0.16 + Math.sin(t * 0.6) * 0.06;
    this.haze.material instanceof THREE.MeshBasicMaterial &&
      (this.haze.material.opacity = 0.028 + Math.sin(t * 0.45) * 0.012);
    this.haze.rotation.z = Math.sin(t * 0.08) * 0.04;

    driftParticles(this.particles, 0.0055);
    driftParticles(this.embers, 0.0035, true);

    for (const b of this.bobbers) {
      b.obj.position.y = b.baseY + Math.sin(t * 0.7 + b.phase) * b.amp;
      b.obj.rotation.y += 0.00035;
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
    positions[i * 3] = (Math.random() - 0.5) * 40;
    positions[i * 3 + 1] = Math.random() * 9;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 40;
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
