import type { Vec3 } from '../math';

/**
 * Maps are pure data. The client turns them into meshes, the server turns them
 * into colliders. Adding a map = adding one data file, no engine changes.
 */

export type SurfaceId =
  | 'concrete'
  | 'metal'
  | 'wood'
  | 'sand'
  | 'glass'
  | 'rubber'
  | 'grass';

export interface MaterialDef {
  /** Base colour, hex. */
  color: number;
  roughness: number;
  metalness: number;
  emissive?: number;
  emissiveIntensity?: number;
  opacity?: number;
  transparent?: boolean;
  surface: SurfaceId;
  /** Procedural texture generator key, see client texture factory. */
  texture?:
    | 'concrete'
    | 'metal'
    | 'wood'
    | 'crate'
    | 'grid'
    | 'sand'
    | 'hazard'
    | 'asphalt'
    | 'grass'
    | 'brick'
    | 'pavement';
  /** UV repeat applied to the procedural texture. */
  textureScale?: number;
}

export interface BoxBrush {
  kind: 'box';
  position: [number, number, number];
  /** Full size (not half-extents). */
  size: [number, number, number];
  /** Euler rotation in radians, YXZ order. */
  rotation?: [number, number, number];
  material: string;
  /** Skip collider generation (decorative only). */
  noCollide?: boolean;
  /** Skip the rendered mesh; collider still generated unless noCollide. */
  invisible?: boolean;
  /** Merge into the static instanced batch (default true). */
  static?: boolean;
}

export interface CylinderBrush {
  kind: 'cylinder';
  position: [number, number, number];
  radius: number;
  height: number;
  rotation?: [number, number, number];
  material: string;
  noCollide?: boolean;
  invisible?: boolean;
}

export interface RampBrush {
  kind: 'ramp';
  position: [number, number, number];
  size: [number, number, number];
  /** Rotation about Y in radians; the ramp rises along local +Z. */
  yaw?: number;
  /** Slope angle in degrees. */
  angle: number;
  material: string;
}

export type Brush = BoxBrush | CylinderBrush | RampBrush;

export type PropKind =
  | 'crate'
  | 'barrel'
  | 'explosive_barrel'
  | 'ball'
  | 'plank'
  | 'canister'
  | 'chair';

export interface PropDef {
  kind: PropKind;
  position: [number, number, number];
  rotation?: [number, number, number];
  /** Uniform scale multiplier. */
  scale?: number;
  /** Overrides the archetype mass. */
  mass?: number;
}

export interface DoorDef {
  id: string;
  position: [number, number, number];
  size: [number, number, number];
  /** Rotation about Y of the closed door, radians. */
  yaw?: number;
  /** 'slide' moves along local X, 'swing' rotates about the hinge edge. */
  mode: 'slide' | 'swing';
  /** Travel distance (slide) or angle in radians (swing). */
  travel: number;
  openMs: number;
  material: string;
  /** If set, the door only opens when this switch is on. */
  requiresSwitch?: string;
  startsOpen?: boolean;
}

export interface SwitchDef {
  id: string;
  position: [number, number, number];
  yaw?: number;
  /** Ids of doors/lights this switch drives. */
  targets: string[];
  /** Auto-revert after this many ms; 0 = latching toggle. */
  autoResetMs?: number;
  startsOn?: boolean;
}

export interface PickupDef {
  id: string;
  kind: 'weapon' | 'ammo' | 'health';
  /** Weapon id for weapon pickups, amount for ammo/health. */
  value: string;
  amount?: number;
  position: [number, number, number];
  respawnMs: number;
}

export interface LightDef {
  kind: 'point' | 'spot';
  position: [number, number, number];
  target?: [number, number, number];
  color: number;
  intensity: number;
  distance: number;
  castShadow?: boolean;
  /** Only rendered at HIGH quality and above. */
  quality?: 'low' | 'medium' | 'high';
  /** Toggled by a switch with this id. */
  switchId?: string;
}

export type SpawnRole = 'player' | 'npc' | 'vehicle' | 'prop';

export interface SpawnPointDef {
  position: [number, number, number];
  yaw: number;
  team?: number;
  /** Defaults to player so existing maps keep working. */
  role?: SpawnRole;
  id?: string;
}

/** Client-only GLB decoration. Collision is authored separately as brushes. */
export interface MapDecorDef {
  model: string;
  position: [number, number, number];
  yaw?: number;
  scale?: number;
}

export interface MapEnvironment {
  /** Sky top / horizon colours. */
  skyTop: number;
  skyBottom: number;
  sunColor: number;
  sunIntensity: number;
  /** Normalised sun direction. */
  sunDirection: [number, number, number];
  ambientColor: number;
  ambientIntensity: number;
  fogColor: number;
  /** Exponential fog density. */
  fogDensity: number;
  /** Ambience synth preset played on loop. */
  ambience: string;
}

export interface MapDefinition {
  id: string;
  name: string;
  description: string;
  author: string;
  /** Recommended player range. */
  players: [number, number];
  /** Half-extent of the playable area on XZ. */
  bounds: number;
  environment: MapEnvironment;
  materials: Record<string, MaterialDef>;
  brushes: Brush[];
  props: PropDef[];
  doors: DoorDef[];
  switches: SwitchDef[];
  pickups: PickupDef[];
  lights: LightDef[];
  spawnPoints: SpawnPointDef[];
  /** Kenney / GLB scenery. Client-only; ignored by the physics cook. */
  decor?: MapDecorDef[];
  /** Where players fall to if they leave the map. */
  killPlaneY: number;
}

export interface PropArchetype {
  kind: PropKind;
  /** Collider half-extents for boxes, radius for spheres/cylinders. */
  shape:
    | { type: 'box'; halfExtents: [number, number, number] }
    | { type: 'sphere'; radius: number }
    | { type: 'cylinder'; radius: number; halfHeight: number };
  mass: number;
  restitution: number;
  friction: number;
  linearDamping: number;
  angularDamping: number;
  /** Hit points; 0 = indestructible. */
  health: number;
  /** Explodes on destruction. */
  explosive: boolean;
  explosionDamage: number;
  explosionRadius: number;
  explosionImpulse: number;
  /** Can be picked up with the interact key. */
  carryable: boolean;
  material: MaterialDef;
}

export function vecOf(t: readonly [number, number, number]): Vec3 {
  return { x: t[0], y: t[1], z: t[2] };
}

export function spawnsOf(map: MapDefinition, role: SpawnRole): SpawnPointDef[] {
  return map.spawnPoints.filter((s) => (s.role ?? 'player') === role);
}

/** Player spawn list used by the server. Untagged points count as player. */
export function playerSpawns(map: MapDefinition): SpawnPointDef[] {
  const tagged = spawnsOf(map, 'player');
  return tagged.length > 0 ? tagged : map.spawnPoints;
}

export function npcSpawns(map: MapDefinition): SpawnPointDef[] {
  return spawnsOf(map, 'npc');
}

/** Parking stalls and street bays reserved for future vehicles. */
export function vehicleSpawns(map: MapDefinition): SpawnPointDef[] {
  return spawnsOf(map, 'vehicle');
}

export function propSpawns(map: MapDefinition): SpawnPointDef[] {
  return spawnsOf(map, 'prop');
}
