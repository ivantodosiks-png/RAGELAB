import {
  RESPAWN_DELAY_MS,
  SPAWN_PROTECTION_MS,
  bloomSpread,
  damageAtDistance,
  effectiveSpread,
  eyeHeight,
  getWeapon,
  maxSpeedFor,
  muzzleOrigin,
  pelletDirections,
  playerCenter,
  raycastPlayer,
  zoneMultiplier,
  HitZone,
  type HitZoneId,
  type GameEvent,
  type Vec3,
  type WeaponId,
} from '@ragelab/shared';
import type { PlayerEntity } from './playerEntity';
import { weaponSession } from './playerEntity';
import type { LagCompensator, RewoundPose } from './lagCompensation';
import type { GameWorld, PendingExplosion } from './world';

export interface EventSink {
  broadcast(event: GameEvent): void;
  to(playerId: number, event: GameEvent): void;
}

export interface CombatContext {
  world: GameWorld;
  players: Map<number, PlayerEntity>;
  lagComp: LagCompensator;
  events: EventSink;
  nowMs: number;
  friendlyFire: boolean;
  onKill: (victim: PlayerEntity, killerId: number | null, cause: KillCause, headshot: boolean) => void;
}

export type KillCause = WeaponId | 'fall' | 'explosion' | 'void' | 'crush';

const NON_WEAPON_CAUSES = new Set(['fall', 'explosion', 'void', 'crush']);

function isWeaponCause(cause: KillCause): cause is WeaponId {
  return !NON_WEAPON_CAUSES.has(cause);
}

const scratchDirs: Vec3[] = [];
const scratchOrigin: Vec3 = { x: 0, y: 0, z: 0 };
const scratchPose: RewoundPose = {
  position: { x: 0, y: 0, z: 0 },
  crouching: false,
  alive: true,
};
const scratchCentre: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Resolve one trigger pull. The client only ever says "I pressed fire"; every
 * number below - cone, pellet directions, distances, occlusion, damage - is
 * computed here from server state.
 */
export function resolveShot(ctx: CombatContext, shooter: PlayerEntity): void {
  const def = getWeapon(shooter.weaponId);
  const state = shooter.weapon;
  const input = shooter.lastInput;

  state.ammoInMag -= 1;
  state.lastShotAt = ctx.nowMs;
  state.shotCounter = (state.shotCounter + 1) & 0xffff;
  if (def.fireMode === 'burst') {
    state.burstRemaining = state.burstRemaining > 0 ? state.burstRemaining - 1 : def.burstCount - 1;
  }

  const speed = Math.hypot(shooter.movement.velocity.x, shooter.movement.velocity.z);
  const maxSpeed = input
    ? maxSpeedFor(input, shooter.movement.crouching, def.moveSpeedMultiplier)
    : 1;
  const cone = effectiveSpread(state, def, {
    moving: speed > 0.35,
    speedRatio: maxSpeed > 0 ? speed / maxSpeed : 0,
    airborne: !shooter.movement.grounded,
    aiming: shooter.aiming,
    crouching: shooter.movement.crouching,
  });
  bloomSpread(state, def);

  muzzleOrigin(
    scratchOrigin,
    shooter.movement.position,
    shooter.yaw,
    shooter.pitch,
    shooter.movement.crouching,
  );
  const dirs = pelletDirections(
    scratchDirs,
    shooter.yaw,
    shooter.pitch,
    cone,
    shooter.id,
    state.shotCounter,
    def.pellets,
  );

  shooter.stats.shotsFired += 1;
  const ws = weaponSession(shooter.stats, def.id);
  ws.shotsFired += 1;

  const rewindMs = ctx.lagComp.rewindMsFor(shooter.pingMs);
  const rewindTime = ctx.nowMs - rewindMs;

  const lengths: number[] = [];
  const dirTuples: [number, number, number][] = [];
  let anyPlayerHit = false;
  let anyHeadshot = false;

  for (const dir of dirs) {
    dirTuples.push([dir.x, dir.y, dir.z]);

    const worldHit = ctx.world.raycast(scratchOrigin, dir, def.range);
    let bestT = worldHit ? worldHit.t : def.range;
    let victim: PlayerEntity | null = null;
    let victimZone: HitZoneId = HitZone.Body;
    let victimPoint: Vec3 | null = null;
    let victimNormal: Vec3 | null = null;

    for (const target of ctx.players.values()) {
      if (target.id === shooter.id || !target.alive) continue;
      if (target.spawnProtectedUntil > ctx.nowMs) continue;

      let pos = target.movement.position;
      let crouching = target.movement.crouching;
      if (rewindMs > 1 && ctx.lagComp.sample(target.id, rewindTime, scratchPose)) {
        if (!scratchPose.alive) continue;
        pos = scratchPose.position;
        crouching = scratchPose.crouching;
      }

      const hit = raycastPlayer(scratchOrigin, dir, pos, crouching, bestT);
      if (!hit || hit.t >= bestT) continue;
      bestT = hit.t;
      victim = target;
      victimZone = hit.zone;
      victimPoint = hit.point;
      victimNormal = hit.normal;
    }

    lengths.push(bestT);

    if (victim && victimPoint && victimNormal) {
      anyPlayerHit = true;
      const base = damageAtDistance(def, bestT);
      const damage = base * zoneMultiplier(victimZone);
      const headshot = victimZone === HitZone.Head;
      if (headshot) anyHeadshot = true;

      ctx.events.broadcast({
        t: 'blood',
        pos: [victimPoint.x, victimPoint.y, victimPoint.z],
        n: [victimNormal.x, victimNormal.y, victimNormal.z],
      });

      applyDamage(ctx, victim, damage, shooter, def.id, headshot, dir);
    } else if (worldHit && worldHit.t <= bestT) {
      ctx.events.broadcast({
        t: 'impact',
        pos: [worldHit.point.x, worldHit.point.y, worldHit.point.z],
        n: [worldHit.normal.x, worldHit.normal.y, worldHit.normal.z],
        s: worldHit.surface,
        f: Math.min(1, def.damage / 60),
      });

      if (worldHit.propId !== undefined) {
        ctx.world.pushProp(worldHit.propId, dir, def.impactImpulse, worldHit.point);
        ctx.world.damageProp(worldHit.propId, def.damage, ctx.nowMs, shooter.id);
      }
    }
  }

  if (anyPlayerHit) {
    shooter.stats.shotsHit += 1;
    ws.shotsHit += 1;
    if (anyHeadshot) {
      shooter.stats.headshots += 1;
      ws.headshots += 1;
    }
  }

  ctx.events.broadcast({
    t: 'shot',
    p: shooter.id,
    w: def.id,
    o: [scratchOrigin.x, scratchOrigin.y, scratchOrigin.z],
    d: dirTuples,
    l: lengths,
  });
}

export function applyDamage(
  ctx: CombatContext,
  victim: PlayerEntity,
  amount: number,
  attacker: PlayerEntity | null,
  cause: KillCause,
  headshot: boolean,
  fromDirection: Vec3 | null,
): void {
  if (!victim.alive || amount <= 0) return;
  if (victim.spawnProtectedUntil > ctx.nowMs) return;
  if (attacker && attacker.id !== victim.id && !ctx.friendlyFire && victim.identity.team !== 0) {
    if (attacker.identity.team === victim.identity.team) return;
  }

  const dealt = Math.min(amount, victim.health);
  victim.health -= amount;

  if (attacker) {
    attacker.stats.damageDealt += dealt;
    if (isWeaponCause(cause)) weaponSession(attacker.stats, cause).damage += dealt;
    ctx.events.to(attacker.id, {
      t: 'hit',
      target: victim.id,
      dmg: Math.round(dealt),
      head: headshot,
      lethal: victim.health <= 0,
    });
  }

  const dir = fromDirection ?? { x: 0, y: 0, z: 1 };
  ctx.events.to(victim.id, {
    t: 'damaged',
    amount: Math.round(dealt),
    from: [-dir.x, -dir.y, -dir.z],
    health: Math.max(0, Math.round(victim.health)),
  });

  if (victim.health <= 0) {
    killPlayer(ctx, victim, attacker ? attacker.id : null, cause, headshot);
  }
}

export function killPlayer(
  ctx: CombatContext,
  victim: PlayerEntity,
  killerId: number | null,
  cause: KillCause,
  headshot: boolean,
): void {
  if (!victim.alive) return;
  victim.alive = false;
  victim.health = 0;
  victim.respawnAt = ctx.nowMs + RESPAWN_DELAY_MS;
  victim.killedBy = killerId;
  victim.carrying = null;
  victim.stats.deaths += 1;
  victim.stats.killstreak = 0;

  const killer = killerId !== null ? ctx.players.get(killerId) : undefined;
  if (killer && killer.id !== victim.id) {
    killer.stats.kills += 1;
    killer.stats.score += headshot ? 150 : 100;
    killer.stats.killstreak += 1;
    killer.stats.bestKillstreak = Math.max(killer.stats.bestKillstreak, killer.stats.killstreak);
    if (isWeaponCause(cause)) weaponSession(killer.stats, cause).kills += 1;
  } else {
    victim.stats.score -= 50;
  }

  const pos = victim.movement.position;
  ctx.events.broadcast({
    t: 'kill',
    killer: killer && killer.id !== victim.id ? killer.id : null,
    victim: victim.id,
    w: cause,
    head: headshot,
  });
  ctx.events.broadcast({
    t: 'death',
    victim: victim.id,
    pos: [pos.x, pos.y, pos.z],
    respawnAt: victim.respawnAt,
  });

  ctx.onKill(victim, killerId, cause, headshot);
}

/** Area damage from explosive props, with a line-of-sight check per victim. */
export function resolveExplosion(ctx: CombatContext, blast: PendingExplosion): void {
  ctx.events.broadcast({
    t: 'explosion',
    pos: [blast.position.x, blast.position.y, blast.position.z],
    radius: blast.radius,
  });

  ctx.world.applyRadialImpulse(blast.position, blast.radius, blast.impulse, ctx.nowMs);

  const attacker = blast.sourcePlayer !== null ? ctx.players.get(blast.sourcePlayer) ?? null : null;

  for (const victim of ctx.players.values()) {
    if (!victim.alive) continue;
    playerCenter(scratchCentre, victim.movement.position, victim.movement.crouching);
    const dx = scratchCentre.x - blast.position.x;
    const dy = scratchCentre.y - blast.position.y;
    const dz = scratchCentre.z - blast.position.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > blast.radius) continue;
    if (!ctx.world.hasLineOfSight(blast.position, scratchCentre)) continue;

    const falloff = 1 - dist / blast.radius;
    const damage = blast.damage * falloff * falloff;
    const inv = dist > 1e-4 ? 1 / dist : 0;
    applyDamage(
      ctx,
      victim,
      damage,
      attacker,
      'explosion',
      false,
      { x: -dx * inv, y: -dy * inv, z: -dz * inv },
    );

    // Blast knockback on the character.
    if (victim.alive) {
      const push = 14 * falloff;
      victim.movement.velocity.x += dx * inv * push;
      victim.movement.velocity.y += Math.max(dy * inv, 0.35) * push;
      victim.movement.velocity.z += dz * inv * push;
      victim.movement.grounded = false;
    }
  }
}

export function grantSpawnProtection(player: PlayerEntity, nowMs: number): void {
  player.spawnProtectedUntil = nowMs + SPAWN_PROTECTION_MS;
}

/** Eye position, used for interaction rays and explosion visibility. */
export function eyePosition(out: Vec3, player: PlayerEntity): Vec3 {
  out.x = player.movement.position.x;
  out.y = player.movement.position.y + eyeHeight(player.movement.crouching);
  out.z = player.movement.position.z;
  return out;
}
