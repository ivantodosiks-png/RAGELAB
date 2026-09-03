/**
 * Rapier interaction groups. The upper 16 bits are the membership, the lower 16
 * bits the filter mask.
 *
 * Design note: players deliberately do NOT collide with each other. Remote
 * players only exist on the client as interpolated visuals, so giving them
 * colliders would make client prediction disagree with the server. Players do
 * collide with the static world and with sandbox props, which both sides can
 * reproduce exactly.
 */
export const Group = {
  World: 0x0001,
  Prop: 0x0002,
  Player: 0x0004,
  Door: 0x0008,
  /** Client-only ragdoll / sandbox NPCs. Never replicated. */
  Sandbox: 0x0010,
  /** Sensor/query group for NPC limb hitboxes (shots). Locator capsules omit this. */
  SandboxHit: 0x0020,
} as const;

export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export const WORLD_GROUPS = groups(
  Group.World,
  Group.World | Group.Prop | Group.Player | Group.Door | Group.Sandbox,
);
export const PROP_GROUPS = groups(
  Group.Prop,
  Group.World | Group.Prop | Group.Player | Group.Door | Group.Sandbox,
);
export const PLAYER_GROUPS = groups(Group.Player, Group.World | Group.Prop | Group.Door);
export const DOOR_GROUPS = groups(
  Group.Door,
  Group.World | Group.Prop | Group.Player | Group.Sandbox,
);
/** Ragdoll parts collide with the world, props, doors and other sandbox bodies — not the predicted player capsule. */
export const SANDBOX_GROUPS = groups(
  Group.Sandbox,
  Group.World | Group.Prop | Group.Door | Group.Sandbox,
);

/** Limb hitboxes: raycasts hit these; the walking locator capsule does not. */
export const SANDBOX_HITBOX_GROUPS = groups(
  Group.SandboxHit,
  Group.World | Group.Prop | Group.Door | Group.Sandbox | Group.SandboxHit,
);

/**
 * Ragdoll parts and spawned weapons: collide physically and remain shootable.
 * Membership includes SandboxHit so shots that ignore the locator still connect.
 */
export const SANDBOX_PHYSICAL_GROUPS = groups(
  Group.Sandbox | Group.SandboxHit,
  Group.World | Group.Prop | Group.Door | Group.Sandbox | Group.SandboxHit,
);

/** Client sandbox props that should also take hitscan shots. */
export const SANDBOX_PROP_GROUPS = groups(
  Group.Prop | Group.SandboxHit,
  Group.World | Group.Prop | Group.Player | Group.Door | Group.Sandbox | Group.SandboxHit,
);

/** Client sandbox bullets: limb sensors, ragdolls, spawned weapons and props. */
export const SANDBOX_SHOT_FILTER = groups(Group.SandboxHit, Group.SandboxHit);

/** Filter used by bullet raycasts: geometry only, players are tested analytically. */
export const BULLET_FILTER_GROUPS = groups(
  Group.World | Group.Prop | Group.Door,
  Group.World | Group.Prop | Group.Door,
);

/** Filter used by interaction raycasts (props, doors, switches are all geometry). */
export const INTERACT_FILTER_GROUPS = BULLET_FILTER_GROUPS;
