/** Buttons packed into the 16-bit `buttons` field of an input command. */
export const Button = {
  Jump: 1 << 0,
  Sprint: 1 << 1,
  Crouch: 1 << 2,
  Fire: 1 << 3,
  Aim: 1 << 4,
  Reload: 1 << 5,
  Interact: 1 << 6,
  Throw: 1 << 7,
  Drop: 1 << 8,
} as const;

export type ButtonKey = keyof typeof Button;

/**
 * One simulation step of player intent. Produced by the client at the
 * simulation tick rate and replayed verbatim by the server.
 */
export interface InputCommand {
  /** Monotonic per-connection sequence number. */
  seq: number;
  /** Delta time of this command in milliseconds (clamped server-side). */
  dtMs: number;
  /** Strafe intent, -1..1. */
  moveX: number;
  /** Forward intent, -1..1 (positive = forward). */
  moveZ: number;
  yaw: number;
  pitch: number;
  buttons: number;
  /** Slot the client wants to be holding, 0-based. */
  weaponSlot: number;
}

export interface InputPacket {
  /** Latest snapshot tick the client has received - used for lag compensation. */
  ackSnapshotTick: number;
  commands: InputCommand[];
}

export function buttonDown(buttons: number, button: number): boolean {
  return (buttons & button) !== 0;
}

/** True on the frame a button transitions from up to down. */
export function buttonPressed(current: number, previous: number, button: number): boolean {
  return (current & button) !== 0 && (previous & button) === 0;
}

export function emptyInput(seq = 0): InputCommand {
  return {
    seq,
    dtMs: 16,
    moveX: 0,
    moveZ: 0,
    yaw: 0,
    pitch: 0,
    buttons: 0,
    weaponSlot: 0,
  };
}
