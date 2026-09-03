import * as THREE from 'three';

interface TracerSlot {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  width: number;
}

/**
 * Bullet tracers rendered as billboarded stretched quads.
 *
 * A pooled set of thin planes is cheaper than line geometry and, unlike
 * `THREE.Line`, honours width on every platform. Orientation is computed once
 * at spawn from the camera position - tracers only live ~70 ms, so the camera
 * cannot move far enough for the billboard to break.
 */
export class TracerPool {
  readonly root = new THREE.Group();

  private readonly slots: TracerSlot[] = [];
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private cursor = 0;

  private readonly from = new THREE.Vector3();
  private readonly mid = new THREE.Vector3();
  private readonly along = new THREE.Vector3();
  private readonly toCamera = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();

  constructor(capacity: number) {
    this.root.name = 'tracers';

    for (let i = 0; i < capacity; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffd8a0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      this.root.add(mesh);
      this.slots.push({ mesh, material, life: 0, maxLife: 1, width: 0.02 });
    }
  }

  spawn(
    origin: { x: number; y: number; z: number },
    direction: { x: number; y: number; z: number },
    length: number,
    width: number,
    color: number,
    cameraPosition: THREE.Vector3,
    lifeSec = 0.07,
  ): void {
    if (length < 0.35) return;
    const slot = this.slots[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.slots.length;

    this.from.set(origin.x, origin.y, origin.z);
    this.along.set(direction.x, direction.y, direction.z).normalize();
    this.mid.copy(this.from).addScaledVector(this.along, length * 0.5);

    // Quad plane contains the ray and faces the camera.
    this.toCamera.copy(cameraPosition).sub(this.mid).normalize();
    this.right.crossVectors(this.along, this.toCamera);
    if (this.right.lengthSq() < 1e-8) this.right.set(1, 0, 0);
    this.right.normalize();
    this.normal.crossVectors(this.right, this.along).normalize();

    this.basis.makeBasis(this.right, this.along, this.normal);
    slot.mesh.quaternion.setFromRotationMatrix(this.basis);
    slot.mesh.position.copy(this.mid);
    slot.mesh.scale.set(width, length, 1);
    slot.mesh.visible = true;
    slot.material.color.setHex(color);
    slot.material.opacity = 1;
    slot.life = lifeSec;
    slot.maxLife = lifeSec;
    slot.width = width;
  }

  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.mesh.visible) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.mesh.visible = false;
        slot.material.opacity = 0;
        continue;
      }
      const t = slot.life / slot.maxLife;
      slot.material.opacity = t * t;
      slot.mesh.scale.x = slot.width * (0.35 + 0.65 * t);
    }
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.mesh.visible = false;
      slot.life = 0;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const slot of this.slots) slot.material.dispose();
    this.slots.length = 0;
    this.root.clear();
  }
}
