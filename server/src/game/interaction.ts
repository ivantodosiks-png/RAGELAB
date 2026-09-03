import {
  CARRY_DISTANCE,
  CARRY_MAX_MASS,
  INTERACT_RANGE,
  MAX_HEALTH,
  THROW_IMPULSE,
  directionFromAngles,
  distanceSq,
  getWeapon,
  isWeaponId,
  type GameEvent,
  type Vec3,
} from '@ragelab/shared';
import type { EventSink } from './combat';
import { eyePosition } from './combat';
import type { PlayerEntity } from './playerEntity';
import type { GameWorld } from './world';

const eye: Vec3 = { x: 0, y: 0, z: 0 };
const aim: Vec3 = { x: 0, y: 0, z: 0 };
const target: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * One handler per interactable kind. New sandbox objects are added by pushing
 * another handler here - nothing else in the game loop needs to change.
 */
export interface InteractionHandler {
  /** Cheap ranked check: higher priority wins ties at the same distance. */
  readonly priority: number;
  /**
   * Try to handle the interaction. Return true when handled so the dispatcher
   * stops looking.
   */
  tryInteract(ctx: InteractionContext): boolean;
}

export interface InteractionContext {
  world: GameWorld;
  player: PlayerEntity;
  events: EventSink;
  nowMs: number;
  /** Eye position of the interacting player. */
  origin: Vec3;
  /** Normalised aim direction. */
  direction: Vec3;
}

/** Pick up carryable props. */
const carryHandler: InteractionHandler = {
  priority: 30,
  tryInteract(ctx) {
    const hit = ctx.world.raycast(ctx.origin, ctx.direction, INTERACT_RANGE);
    if (!hit || hit.propId === undefined) return false;
    const prop = ctx.world.props.get(hit.propId);
    if (!prop || prop.destroyed || !prop.archetype.carryable) return false;
    if (prop.carriedBy !== null && prop.carriedBy !== ctx.player.id) return false;
    if (prop.body.mass() > CARRY_MAX_MASS) return false;

    prop.carriedBy = ctx.player.id;
    ctx.player.carrying = prop.id;
    ctx.events.broadcast({ t: 'carry', p: ctx.player.id, prop: prop.id });
    return true;
  },
};

/** Flip switches, which in turn drive doors and lights. */
const switchHandler: InteractionHandler = {
  priority: 20,
  tryInteract(ctx) {
    let bestId: string | null = null;
    let bestDist = INTERACT_RANGE * INTERACT_RANGE;
    for (const sw of ctx.world.map.switches) {
      target.x = sw.position[0];
      target.y = sw.position[1];
      target.z = sw.position[2];
      const d2 = distanceSq(ctx.origin, target);
      if (d2 > bestDist) continue;
      // Must be roughly in front of the player.
      const dx = target.x - ctx.origin.x;
      const dy = target.y - ctx.origin.y;
      const dz = target.z - ctx.origin.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const facing = (dx * ctx.direction.x + dy * ctx.direction.y + dz * ctx.direction.z) / len;
      if (facing < 0.75) continue;
      bestDist = d2;
      bestId = sw.id;
    }
    if (!bestId) return false;

    const on = ctx.world.toggleSwitch(bestId, ctx.nowMs);
    if (on === null) return false;
    ctx.events.broadcast({ t: 'switch', id: bestId, on });
    for (const doorId of ctx.world.switches.get(bestId)?.targets ?? []) {
      const door = ctx.world.getDoor(doorId);
      if (door) ctx.events.broadcast({ t: 'door', id: doorId, open: door.target > 0.5 });
    }
    return true;
  },
};

/** Open/close doors that are not gated behind a switch. */
const doorHandler: InteractionHandler = {
  priority: 10,
  tryInteract(ctx) {
    const hit = ctx.world.raycast(ctx.origin, ctx.direction, INTERACT_RANGE);
    if (!hit || !hit.doorId) return false;
    const open = ctx.world.toggleDoor(hit.doorId);
    if (open === null) return false;
    ctx.events.broadcast({ t: 'door', id: hit.doorId, open });
    return true;
  },
};

const HANDLERS: InteractionHandler[] = [carryHandler, switchHandler, doorHandler].sort(
  (a, b) => b.priority - a.priority,
);

export function registerInteractionHandler(handler: InteractionHandler): void {
  HANDLERS.push(handler);
  HANDLERS.sort((a, b) => b.priority - a.priority);
}

/** Called on the rising edge of the interact button. */
export function handleInteract(
  world: GameWorld,
  player: PlayerEntity,
  events: EventSink,
  nowMs: number,
): void {
  if (!player.alive) return;

  // Already carrying something: interact drops it.
  if (player.carrying !== null) {
    dropCarried(world, player, events, false);
    return;
  }

  eyePosition(eye, player);
  directionFromAngles(aim, player.yaw, player.pitch);

  const ctx: InteractionContext = {
    world,
    player,
    events,
    nowMs,
    origin: eye,
    direction: aim,
  };
  for (const handler of HANDLERS) {
    if (handler.tryInteract(ctx)) return;
  }
}

export function dropCarried(
  world: GameWorld,
  player: PlayerEntity,
  events: EventSink,
  thrown: boolean,
): void {
  if (player.carrying === null) return;
  const prop = world.props.get(player.carrying);
  player.carrying = null;
  if (prop) {
    prop.carriedBy = null;
    if (thrown && !prop.destroyed) {
      directionFromAngles(aim, player.yaw, player.pitch);
      const mag = THROW_IMPULSE * prop.body.mass();
      prop.body.applyImpulse(
        { x: aim.x * mag, y: aim.y * mag + mag * 0.12, z: aim.z * mag },
        true,
      );
    }
  }
  events.broadcast({ t: 'carry', p: player.id, prop: null });
}

/**
 * Spring the carried prop toward the hold point in front of the player's eyes.
 * Runs every tick for every carrier.
 */
export function updateCarriedProp(world: GameWorld, player: PlayerEntity, dtSec: number): void {
  if (player.carrying === null) return;
  const prop = world.props.get(player.carrying);
  if (!prop || prop.destroyed) {
    player.carrying = null;
    return;
  }

  eyePosition(eye, player);
  directionFromAngles(aim, player.yaw, player.pitch);
  target.x = eye.x + aim.x * CARRY_DISTANCE;
  target.y = eye.y + aim.y * CARRY_DISTANCE;
  target.z = eye.z + aim.z * CARRY_DISTANCE;

  const pos = prop.body.translation();
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const dz = target.z - pos.z;
  const dist = Math.hypot(dx, dy, dz);

  // Snapped loose (shot out of the hands, blocked by a wall, ...).
  if (dist > CARRY_DISTANCE * 2.6) {
    prop.carriedBy = null;
    player.carrying = null;
    return;
  }

  const stiffness = 14;
  prop.body.setLinvel(
    { x: dx * stiffness, y: dy * stiffness, z: dz * stiffness },
    true,
  );
  const ang = prop.body.angvel();
  const damp = Math.max(0, 1 - 8 * dtSec);
  prop.body.setAngvel({ x: ang.x * damp, y: ang.y * damp, z: ang.z * damp }, true);
}

/** Walk-over pickups: weapons, ammo and health. */
export function updatePickups(
  world: GameWorld,
  players: Iterable<PlayerEntity>,
  events: EventSink,
  nowMs: number,
): void {
  const RADIUS_SQ = 1.6 * 1.6;
  for (const player of players) {
    if (!player.alive) continue;
    for (const [id, state] of world.pickups) {
      if (!state.available) continue;
      target.x = state.def.position[0];
      target.y = state.def.position[1];
      target.z = state.def.position[2];
      const dx = target.x - player.movement.position.x;
      const dy = target.y - (player.movement.position.y + 0.9);
      const dz = target.z - player.movement.position.z;
      if (dx * dx + dy * dy + dz * dz > RADIUS_SQ) continue;
      if (!applyPickup(player, state.def.kind, state.def.value, state.def.amount ?? 0, nowMs)) {
        continue;
      }
      const def = world.consumePickup(id, nowMs);
      if (!def) continue;
      const event: GameEvent = {
        t: 'pickup',
        id,
        p: player.id,
        kind: def.kind,
        value: def.value,
        respawnAt: nowMs + def.respawnMs,
      };
      events.broadcast(event);
    }
  }
}

function applyPickup(
  player: PlayerEntity,
  kind: string,
  value: string,
  amount: number,
  nowMs: number,
): boolean {
  switch (kind) {
    case 'health': {
      if (player.health >= MAX_HEALTH) return false;
      player.health = Math.min(MAX_HEALTH, player.health + (amount || 25));
      return true;
    }
    case 'ammo': {
      let topped = false;
      for (const [weaponId, state] of player.weapons) {
        const def = getWeapon(weaponId);
        if (state.ammoReserve >= def.reserveAmmo) continue;
        state.ammoReserve = Math.min(def.reserveAmmo, state.ammoReserve + (amount || 40));
        topped = true;
      }
      return topped;
    }
    case 'weapon': {
      if (!isWeaponId(value)) return false;
      const def = getWeapon(value);
      const existing = player.weapons.get(value);
      if (existing && existing.ammoReserve >= def.reserveAmmo) return false;
      if (!existing) {
        player.weapons.set(value, {
          weaponId: value,
          ammoInMag: def.magazineSize,
          ammoReserve: def.reserveAmmo,
          lastShotAt: -100000,
          reloadEndsAt: 0,
          equipEndsAt: nowMs,
          burstRemaining: 0,
          spread: def.spread.base,
          shotCounter: 0,
        });
      } else {
        existing.ammoReserve = def.reserveAmmo;
      }
      if (!player.loadout.includes(value)) player.loadout.push(value);
      return true;
    }
    default:
      return false;
  }
}
