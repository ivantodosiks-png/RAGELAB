/**
 * Tunables that MUST stay identical on client and server.
 * Anything here is part of the simulation contract.
 */

// ── Simulation timing ────────────────────────────────────────────────────────
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
export const TICK_DT_MS = 1000 / TICK_RATE;

/** How often the server broadcasts snapshots. */
export const SNAPSHOT_RATE = 20;
export const SNAPSHOT_INTERVAL_MS = 1000 / SNAPSHOT_RATE;

/** Client renders remote entities this far in the past to hide jitter. */
export const INTERPOLATION_DELAY_MS = 100;

/** Max input commands the client may batch into a single packet. */
export const MAX_INPUTS_PER_PACKET = 12;

/** Client keeps this many unacknowledged inputs for replay. */
export const MAX_PENDING_INPUTS = 180;

/** Server keeps this many ticks of position history for lag compensation. */
export const LAG_COMP_HISTORY_TICKS = 64;
/** Hard cap on how far back a client may ask the server to rewind. */
export const LAG_COMP_MAX_REWIND_MS = 250;

// ── Rooms ───────────────────────────────────────────────────────────────────
export const MIN_PLAYERS_PER_ROOM = 2;
export const DEFAULT_MAX_PLAYERS_PER_ROOM = 16;
/** Architectural ceiling; raise together with the u8 player count in snapshots. */
export const ABSOLUTE_MAX_PLAYERS_PER_ROOM = 64;
export const ROOM_EMPTY_TTL_MS = 60_000;

// ── Networking ──────────────────────────────────────────────────────────────
export const HEARTBEAT_INTERVAL_MS = 2_000;
export const CONNECTION_TIMEOUT_MS = 12_000;
/** Grace period during which a dropped player keeps their slot for reconnect. */
export const RECONNECT_WINDOW_MS = 30_000;
export const MAX_PACKET_BYTES = 4_096;
export const MAX_CHAT_LENGTH = 160;

/** Only replicate entities within this radius (interest management). */
export const INTEREST_RADIUS = 140;
export const INTEREST_RADIUS_SQ = INTEREST_RADIUS * INTEREST_RADIUS;

// ── Quantization (network precision) ────────────────────────────────────────
export const POS_SCALE = 64; // 1.56 cm precision, +-512 m range
export const VEL_SCALE = 128; // 0.8 cm/s precision, +-256 m/s range
export const ANGLE_SCALE = 32767 / Math.PI;
export const QUAT_SCALE = 32767;

// ── Player dimensions ───────────────────────────────────────────────────────
export const PLAYER_RADIUS = 0.35;
export const PLAYER_HEIGHT_STAND = 1.8;
export const PLAYER_HEIGHT_CROUCH = 1.15;
/** Half-height of the *cylinder* part of the capsule (Rapier convention). */
export const PLAYER_HALF_HEIGHT_STAND = PLAYER_HEIGHT_STAND / 2 - PLAYER_RADIUS;
export const PLAYER_HALF_HEIGHT_CROUCH = PLAYER_HEIGHT_CROUCH / 2 - PLAYER_RADIUS;
export const EYE_HEIGHT_STAND = 1.62;
export const EYE_HEIGHT_CROUCH = 0.95;
/** Vertical offset from capsule centre to the top of the head hitbox. */
export const HEAD_HITBOX_RADIUS = 0.16;

// ── Movement ────────────────────────────────────────────────────────────────
export const GRAVITY = -22;
export const SPEED_WALK = 5.2;
export const SPEED_SPRINT = 8.0;
export const SPEED_CROUCH = 2.5;
export const SPEED_AIR_CONTROL = 0.55;
export const ACCEL_GROUND = 62;
export const ACCEL_AIR = 14;
export const FRICTION_GROUND = 11;
export const JUMP_VELOCITY = 6.4;
export const MAX_FALL_SPEED = -60;
export const COYOTE_TIME_MS = 90;
export const JUMP_COOLDOWN_MS = 120;
export const STEP_HEIGHT = 0.4;
export const MAX_SLOPE_CLIMB_DEG = 50;
export const FALL_DAMAGE_MIN_SPEED = 14;
export const FALL_DAMAGE_PER_SPEED = 5.5;

// ── Combat ──────────────────────────────────────────────────────────────────
export const MAX_HEALTH = 100;
export const RESPAWN_DELAY_MS = 3_000;
export const SPAWN_PROTECTION_MS = 1_500;
export const HEADSHOT_MULTIPLIER = 2.0;
export const LEGSHOT_MULTIPLIER = 0.8;

// ── Sandbox interaction ─────────────────────────────────────────────────────
export const INTERACT_RANGE = 3.0;
export const CARRY_DISTANCE = 2.1;
export const CARRY_MAX_MASS = 60;
export const THROW_IMPULSE = 18;
export const PROP_SLEEP_LINEAR_THRESHOLD = 0.05;

// ── Anti-cheat tolerances ───────────────────────────────────────────────────
/** Extra speed above the theoretical max we tolerate before flagging. */
export const ANTICHEAT_SPEED_TOLERANCE = 1.6;
export const ANTICHEAT_MAX_POSITION_DESYNC = 2.5;
export const ANTICHEAT_MAX_DT_MS = 50;
export const ANTICHEAT_MIN_DT_MS = 1;
/** Inputs per second a client may send before being throttled. */
export const ANTICHEAT_MAX_INPUT_RATE = 90;
export const ANTICHEAT_MAX_MESSAGE_RATE = 140;
export const ANTICHEAT_FIRE_RATE_GRACE_MS = 25;
export const ANTICHEAT_VIOLATION_KICK_THRESHOLD = 40;

// ── World bounds (used for sanity checks) ───────────────────────────────────
export const WORLD_BOUNDS_XZ = 200;
export const WORLD_FLOOR_Y = -30;
export const WORLD_CEILING_Y = 200;
