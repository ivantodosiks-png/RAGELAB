import type { NavGrid, NavPoint } from './navGrid';

export type NpcBehavior = 'idle' | 'wander' | 'follow' | 'alert' | 'search' | 'flee' | 'attack' | 'dead';

export interface NpcPersonality {
  walkSpeed: number;
  runSpeed: number;
  waitMin: number;
  waitMax: number;
  bravery: number;
  alertRadius: number;
  hearRadius: number;
  fleeHealth: number;
}

export interface BrainWorld {
  player: { x: number; z: number };
  playerAlive: boolean;
  noises: Array<{ x: number; z: number; at: number }>;
  others: Array<{ x: number; z: number; id: number }>;
  now: number;
  dt: number;
}

export interface MoveCommand {
  yaw: number;
  speed: number;
  clip: 'idle' | 'walk' | 'run';
}

export function randomPersonality(rng: () => number): NpcPersonality {
  return {
    walkSpeed: 1.25 + rng() * 0.55,
    runSpeed: 3.4 + rng() * 0.9,
    waitMin: 0.4 + rng() * 1.1,
    waitMax: 1.6 + rng() * 2.4,
    bravery: rng(),
    alertRadius: 10 + rng() * 8,
    hearRadius: 18 + rng() * 14,
    fleeHealth: 22 + rng() * 28,
  };
}

/**
 * Lightweight FSM. Pathfinding is cached and only rebuilt when the goal moves
 * or the NPC gets stuck — not every frame.
 */
export class NpcBrain {
  behavior: NpcBehavior = 'wander';
  readonly personality: NpcPersonality;
  private path: NavPoint[] = [];
  private waypoint = 0;
  private goal: NavPoint | null = null;
  private wait = 0;
  private repathAt = 0;
  private stuck = 0;
  private lastPos = { x: 0, z: 0 };
  private lastKnown = { x: 0, z: 0 };
  private searchUntil = 0;
  private alertUntil = 0;
  private heardAt = 0;

  constructor(rng: () => number) {
    this.personality = randomPersonality(rng);
    this.wait = this.personality.waitMin;
  }

  reset(x: number, z: number): void {
    this.behavior = 'wander';
    this.path = [];
    this.waypoint = 0;
    this.goal = null;
    this.wait = this.personality.waitMin + Math.random() * 0.4;
    this.stuck = 0;
    this.lastPos = { x, z };
    this.lastKnown = { x, z };
    this.repathAt = 0;
  }

  markDead(): void {
    this.behavior = 'dead';
    this.path = [];
    this.goal = null;
  }

  noticeShot(x: number, z: number, npcX: number, npcZ: number, now: number): void {
    if (this.behavior === 'dead') return;
    const d = Math.hypot(x - npcX, z - npcZ);
    if (d > this.personality.hearRadius) return;
    this.lastKnown = { x, z };
    this.heardAt = now;
    if (this.personality.bravery < 0.35) {
      this.behavior = 'flee';
      this.repathAt = 0;
      return;
    }
    this.behavior = 'alert';
    this.alertUntil = now + 0.7 + Math.random() * 0.5;
  }

  tick(nav: NavGrid, x: number, z: number, health: number, world: BrainWorld): MoveCommand {
    if (this.behavior === 'dead') return { yaw: 0, speed: 0, clip: 'idle' };

    const p = this.personality;
    const moved = Math.hypot(x - this.lastPos.x, z - this.lastPos.z);
    this.stuck = moved < 0.08 ? this.stuck + world.dt : 0;
    this.lastPos = { x, z };

    this.considerPlayer(x, z, health, world);
    this.considerNoise(x, z, world);

    if (this.stuck > 0.7) {
      this.path = [];
      this.goal = null;
      this.repathAt = 0;
      this.stuck = 0;
      if (this.behavior === 'wander') this.behavior = 'idle';
    }

    switch (this.behavior) {
      case 'idle':
        this.wait -= world.dt;
        if (this.wait <= 0) this.behavior = 'wander';
        return { yaw: Math.atan2(-(this.lastKnown.x - x), -(this.lastKnown.z - z)), speed: 0, clip: 'idle' };
      case 'alert':
        if (world.now >= this.alertUntil) {
          this.behavior = p.bravery > 0.55 ? 'search' : 'wander';
          this.searchUntil = world.now + 4 + Math.random() * 3;
          this.repathAt = 0;
        }
        return { yaw: Math.atan2(-(this.lastKnown.x - x), -(this.lastKnown.z - z)), speed: 0, clip: 'idle' };
      case 'flee':
        return this.followPath(nav, x, z, world, true, this.fleeGoal(nav, x, z, world));
      case 'follow':
      case 'attack':
        this.lastKnown = { x: world.player.x, z: world.player.z };
        return this.followPath(nav, x, z, world, true, this.lastKnown);
      case 'search':
        if (world.now > this.searchUntil) {
          this.behavior = 'wander';
          this.repathAt = 0;
        }
        return this.followPath(nav, x, z, world, false, this.lastKnown);
      default:
        return this.wander(nav, x, z, world);
    }
  }

  private considerPlayer(x: number, z: number, health: number, world: BrainWorld): void {
    if (!world.playerAlive) {
      if (this.behavior === 'follow' || this.behavior === 'attack') this.behavior = 'wander';
      return;
    }
    const d = Math.hypot(world.player.x - x, world.player.z - z);
    if (health <= this.personality.fleeHealth && d < this.personality.alertRadius + 4) {
      this.behavior = 'flee';
      this.lastKnown = { x: world.player.x, z: world.player.z };
      this.repathAt = 0;
      return;
    }
    if (d < this.personality.alertRadius * 0.55 && this.personality.bravery > 0.4) {
      this.behavior = this.personality.bravery > 0.7 ? 'attack' : 'follow';
      this.lastKnown = { x: world.player.x, z: world.player.z };
    }
  }

  private considerNoise(x: number, z: number, world: BrainWorld): void {
    for (const n of world.noises) {
      if (n.at <= this.heardAt) continue;
      this.noticeShot(n.x, n.z, x, z, world.now);
    }
  }

  private wander(nav: NavGrid, x: number, z: number, world: BrainWorld): MoveCommand {
    if (this.goal && this.arrived(x, z, this.goal, 1.15)) {
      this.wait = this.personality.waitMin + Math.random() * (this.personality.waitMax - this.personality.waitMin);
      this.behavior = 'idle';
      this.goal = null;
      this.path = [];
      return { yaw: 0, speed: 0, clip: 'idle' };
    }
    if (world.now >= this.repathAt || this.path.length === 0 || !this.goal) {
      const dest =
        nav.randomWalkable(Math.random) ??
        nav.closestWalkable(x + (Math.random() - 0.5) * 24, z + (Math.random() - 0.5) * 24);
      this.goal = dest;
      this.path = nav.findPath({ x, z }, dest);
      this.waypoint = 0;
      this.repathAt = world.now + 1.6 + Math.random() * 1.4;
    }
    return this.steer(x, z, false);
  }

  private followPath(
    nav: NavGrid,
    x: number,
    z: number,
    world: BrainWorld,
    run: boolean,
    dest: NavPoint,
  ): MoveCommand {
    if (world.now >= this.repathAt || this.path.length === 0 || !this.goal || Math.hypot(dest.x - this.goal.x, dest.z - this.goal.z) > 2.4) {
      this.goal = nav.closestWalkable(dest.x, dest.z);
      this.path = nav.findPath({ x, z }, this.goal);
      this.waypoint = 0;
      this.repathAt = world.now + 0.45 + Math.random() * 0.35;
    }
    return this.steer(x, z, run);
  }

  private fleeGoal(nav: NavGrid, x: number, z: number, world: BrainWorld): NavPoint {
    const dx = x - world.player.x;
    const dz = z - world.player.z;
    const len = Math.hypot(dx, dz) || 1;
    return nav.closestWalkable(x + (dx / len) * 14, z + (dz / len) * 14);
  }

  private steer(x: number, z: number, run: boolean): MoveCommand {
    while (this.waypoint < this.path.length - 1) {
      const p = this.path[this.waypoint]!;
      if (Math.hypot(p.x - x, p.z - z) > 0.85) break;
      this.waypoint += 1;
    }
    const target = this.path[this.waypoint] ?? this.goal;
    if (!target) return { yaw: 0, speed: 0, clip: 'idle' };
    const yaw = Math.atan2(-(target.x - x), -(target.z - z));
    const speed = run ? this.personality.runSpeed : this.personality.walkSpeed;
    const dist = Math.hypot(target.x - x, target.z - z);
    if (dist < 0.4) return { yaw, speed: 0, clip: 'idle' };
    return { yaw, speed, clip: run ? 'run' : 'walk' };
  }

  private arrived(x: number, z: number, p: NavPoint, r: number): boolean {
    return Math.hypot(p.x - x, p.z - z) < r;
  }
}
