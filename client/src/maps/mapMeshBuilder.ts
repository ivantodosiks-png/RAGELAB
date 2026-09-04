import * as THREE from 'three';
import type { MapDefinition, MaterialDef, PropKind } from '@ragelab/shared';
import { PROP_ARCHETYPES } from '@ragelab/shared';
import { proceduralPbr } from '../renderer/textures';

const DEG = Math.PI / 180;

/**
 * Turns a map definition into renderable meshes.
 *
 * Brushes that share a material are merged into a single InstancedMesh, which
 * takes Rage Yard from ~200 draw calls down to about a dozen.
 */
export class MapMeshBuilder {
  readonly root = new THREE.Group();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly switchMeshes = new Map<string, THREE.Mesh>();

  constructor(private readonly map: MapDefinition) {
    this.root.name = `map:${map.id}`;
  }

  build(): THREE.Group {
    for (const [name, def] of Object.entries(this.map.materials)) {
      this.materials.set(name, this.createMaterial(def));
    }

    this.buildBrushInstances();
    this.buildPickupMarkers();
    this.buildSwitchMarkers();
    return this.root;
  }

  material(name: string): THREE.MeshStandardMaterial {
    const existing = this.materials.get(name);
    if (existing) return existing;
    const fallback = this.createMaterial({
      color: 0x808080,
      roughness: 0.9,
      metalness: 0,
      surface: 'concrete',
    });
    this.materials.set(name, fallback);
    return fallback;
  }

  private createMaterial(def: MaterialDef): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(def.color),
      roughness: def.roughness,
      metalness: def.metalness,
      transparent: def.transparent ?? false,
      opacity: def.opacity ?? 1,
      side: def.transparent ? THREE.DoubleSide : THREE.FrontSide,
      envMapIntensity: 0.45,
    });
    if (def.emissive !== undefined) {
      material.emissive = new THREE.Color(def.emissive);
      material.emissiveIntensity = def.emissiveIntensity ?? 1;
    }
    if (def.texture) {
      const pbr = proceduralPbr(def.texture);
      const scale = def.textureScale ?? 1;
      const cloneMap = (src: THREE.Texture): THREE.Texture => {
        const cloned = src.clone();
        cloned.needsUpdate = true;
        cloned.repeat.set(scale, scale);
        cloned.wrapS = THREE.RepeatWrapping;
        cloned.wrapT = THREE.RepeatWrapping;
        this.disposables.push(cloned);
        return cloned;
      };
      material.map = cloneMap(pbr.map);
      material.roughnessMap = cloneMap(pbr.roughnessMap);
      material.normalMap = cloneMap(pbr.normalMap);
      material.aoMap = cloneMap(pbr.aoMap);
      material.aoMapIntensity = 1;
      material.normalScale = new THREE.Vector2(0.95, 0.95);
    }
    if (def.decal) {
      material.polygonOffset = true;
      material.polygonOffsetFactor = -4;
      material.polygonOffsetUnits = -4;
      material.depthWrite = false;
    }
    this.disposables.push(material);
    return material;
  }

  /**
   * Group brushes by (material, shape) and emit one InstancedMesh per group.
   * Boxes and ramps both use a unit cube scaled per instance.
   */
  private buildBrushInstances(): void {
    interface Group {
      kind: 'box' | 'cylinder';
      material: string;
      transforms: THREE.Matrix4[];
    }
    const groups = new Map<string, Group>();

    const push = (kind: 'box' | 'cylinder', material: string, matrix: THREE.Matrix4): void => {
      const key = `${kind}:${material}`;
      let group = groups.get(key);
      if (!group) {
        group = { kind, material, transforms: [] };
        groups.set(key, group);
      }
      group.transforms.push(matrix);
    };

    const euler = new THREE.Euler();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();

    for (const brush of this.map.brushes) {
      if ('invisible' in brush && brush.invisible) continue;
      const matrix = new THREE.Matrix4();
      switch (brush.kind) {
        case 'box': {
          const [rx, ry, rz] = brush.rotation ?? [0, 0, 0];
          euler.set(rx, ry, rz, 'YXZ');
          quaternion.setFromEuler(euler);
          position.set(...brush.position);
          scale.set(...brush.size);
          matrix.compose(position, quaternion, scale);
          push('box', brush.material, matrix);
          break;
        }
        case 'ramp': {
          const [rx, ry, rz] = [-(brush.angle * DEG), brush.yaw ?? 0, 0];
          euler.set(rx, ry, rz, 'YXZ');
          quaternion.setFromEuler(euler);
          position.set(...brush.position);
          scale.set(...brush.size);
          matrix.compose(position, quaternion, scale);
          push('box', brush.material, matrix);
          break;
        }
        case 'cylinder': {
          const [rx, ry, rz] = brush.rotation ?? [0, 0, 0];
          euler.set(rx, ry, rz, 'YXZ');
          quaternion.setFromEuler(euler);
          position.set(...brush.position);
          scale.set(brush.radius * 2, brush.height, brush.radius * 2);
          matrix.compose(position, quaternion, scale);
          push('cylinder', brush.material, matrix);
          break;
        }
      }
    }

    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const cylinderGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 18, 1);
    boxGeometry.setAttribute('uv2', boxGeometry.attributes.uv!.clone());
    cylinderGeometry.setAttribute('uv2', cylinderGeometry.attributes.uv!.clone());
    boxGeometry.computeTangents();
    cylinderGeometry.computeTangents();
    this.disposables.push(boxGeometry, cylinderGeometry);

    for (const group of groups.values()) {
      const geometry = group.kind === 'box' ? boxGeometry : cylinderGeometry;
      const material = this.material(group.material);
      const mesh = new THREE.InstancedMesh(geometry, material, group.transforms.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `brushes:${group.kind}:${group.material}`;
      for (let i = 0; i < group.transforms.length; i++) {
        mesh.setMatrixAt(i, group.transforms[i]!);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.root.add(mesh);
    }
  }

  /** Floating markers so pickups are visible from across the map. */
  private buildPickupMarkers(): void {
    if (this.map.pickups.length === 0) return;
    const group = new THREE.Group();
    group.name = 'pickups';
    this.root.add(group);

    const geometries: Record<string, THREE.BufferGeometry> = {
      weapon: new THREE.OctahedronGeometry(0.32, 0),
      ammo: new THREE.BoxGeometry(0.34, 0.24, 0.24),
      health: new THREE.BoxGeometry(0.32, 0.32, 0.32),
    };
    const colors: Record<string, number> = {
      weapon: 0xffb347,
      ammo: 0x8fd6ff,
      health: 0x67e08a,
    };

    for (const [kind, geometry] of Object.entries(geometries)) {
      this.disposables.push(geometry);
      const material = new THREE.MeshStandardMaterial({
        color: colors[kind],
        emissive: new THREE.Color(colors[kind]),
        emissiveIntensity: 0.85,
        roughness: 0.35,
        metalness: 0.2,
      });
      this.disposables.push(material);

      for (const pickup of this.map.pickups) {
        if (pickup.kind !== kind) continue;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...pickup.position);
        mesh.name = `pickup:${pickup.id}`;
        mesh.userData.pickupId = pickup.id;
        mesh.userData.baseY = pickup.position[1];
        mesh.castShadow = false;
        group.add(mesh);
      }
    }
  }

  private buildSwitchMarkers(): void {
    if (this.map.switches.length === 0) return;
    const geometry = new THREE.BoxGeometry(0.28, 0.42, 0.12);
    this.disposables.push(geometry);
    for (const def of this.map.switches) {
      const material = new THREE.MeshStandardMaterial({
        color: 0x2a3034,
        emissive: new THREE.Color(0x3dff6a),
        emissiveIntensity: def.startsOn ? 1.8 : 0.15,
        roughness: 0.4,
        metalness: 0.35,
      });
      this.disposables.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...def.position);
      mesh.rotation.y = def.yaw ?? 0;
      mesh.name = `switch:${def.id}`;
      mesh.castShadow = true;
      this.root.add(mesh);
      this.switchMeshes.set(def.id, mesh);
    }
  }

  setSwitchOn(id: string, on: boolean): void {
    const mesh = this.switchMeshes.get(id);
    if (!mesh) return;
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.emissiveIntensity = on ? 1.8 : 0.15;
  }

  /** Bob + spin the pickup markers. */
  static animatePickups(root: THREE.Group, timeSec: number): void {
    const group = root.getObjectByName('pickups');
    if (!group) return;
    for (const child of group.children) {
      child.rotation.y = timeSec * 1.4;
      const baseY = (child.userData.baseY as number) ?? child.position.y;
      child.position.y = baseY + Math.sin(timeSec * 2.2 + baseY) * 0.12;
    }
  }

  setPickupVisible(pickupId: string, visible: boolean): void {
    const mesh = this.root.getObjectByName(`pickup:${pickupId}`);
    if (mesh) mesh.visible = visible;
  }

  dispose(): void {
    this.root.traverse((child) => {
      if (child instanceof THREE.InstancedMesh || child instanceof THREE.Mesh) {
        child.geometry.dispose?.();
      }
    });
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
    this.root.clear();
  }
}

/** Geometry for a sandbox prop kind, matching its Rapier collider. */
export function propGeometry(kind: PropKind): THREE.BufferGeometry {
  const shape = PROP_ARCHETYPES[kind].shape;
  let geometry: THREE.BufferGeometry;
  switch (shape.type) {
    case 'box': {
      const [hx, hy, hz] = shape.halfExtents;
      geometry = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
      break;
    }
    case 'sphere':
      geometry = new THREE.SphereGeometry(shape.radius, 18, 12);
      break;
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(shape.radius, shape.radius, shape.halfHeight * 2, 18, 1);
      break;
    default:
      geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
      break;
  }
  if (geometry.attributes.uv) {
    geometry.setAttribute('uv2', geometry.attributes.uv.clone());
  }
  if (shape.type !== 'sphere') geometry.computeTangents();
  return geometry;
}

export function propMaterial(kind: PropKind): THREE.MeshStandardMaterial {
  const def = PROP_ARCHETYPES[kind].material;
  const material = new THREE.MeshStandardMaterial({
    color: def.color,
    roughness: def.roughness,
    metalness: def.metalness,
    envMapIntensity: 0.45,
  });
  if (def.emissive !== undefined) {
    material.emissive = new THREE.Color(def.emissive);
    material.emissiveIntensity = def.emissiveIntensity ?? 1;
  }
  if (def.texture) {
    const pbr = proceduralPbr(def.texture);
    const scale = def.textureScale ?? 1;
    const cloneMap = (src: THREE.Texture): THREE.Texture => {
      const cloned = src.clone();
      cloned.needsUpdate = true;
      cloned.repeat.set(scale, scale);
      cloned.wrapS = THREE.RepeatWrapping;
      cloned.wrapT = THREE.RepeatWrapping;
      return cloned;
    };
    material.map = cloneMap(pbr.map);
    material.roughnessMap = cloneMap(pbr.roughnessMap);
    material.normalMap = cloneMap(pbr.normalMap);
    material.aoMap = cloneMap(pbr.aoMap);
    material.aoMapIntensity = 1;
    material.normalScale = new THREE.Vector2(0.95, 0.95);
  }
  return material;
}
