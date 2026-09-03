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

/** Filter used by bullet raycasts: geometry only, players are tested analytically. */
export const BULLET_FILTER_GROUPS = groups(
  Group.World | Group.Prop | Group.Door,
  Group.World | Group.Prop | Group.Door,
);

/** Filter used by interaction raycasts (props, doors, switches are all geometry). */
export const INTERACT_FILTER_GROUPS = BULLET_FILTER_GROUPS;
