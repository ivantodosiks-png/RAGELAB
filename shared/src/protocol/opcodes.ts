/**
 * First byte of every packet. Binary opcodes are on the hot path; JSON opcodes
 * carry a UTF-8 JSON body after the opcode byte.
 */
export const Op = {
  // ── client -> server ──
  /** JSON: { token?, username?, roomId?, password?, mapId?, roomName? } */
  Hello: 1,
  /** Binary: batched input commands. */
  Input: 2,
  /** JSON: { slot } */
  SwitchWeapon: 3,
  /** JSON: { text } */
  Chat: 4,
  /** Binary: u32 clientTimeMs - latency probe. */
  Ping: 5,
  /** JSON: {} - ask to respawn after the death timer. */
  RespawnRequest: 6,
  /** JSON: {} - list rooms (used by the server browser over the same socket). */
  ListRooms: 7,
  /** JSON: { config } - create a room. */
  CreateRoom: 8,
  /** JSON: {} - leave the current room but stay connected. */
  LeaveRoom: 9,
  /** JSON: {} - host/admin starts the match from the waiting lobby. */
  StartMatch: 10,

  // ── server -> client ──
  /** JSON: WelcomePayload */
  Welcome: 20,
  /** Binary: delta-compressed world snapshot. */
  Snapshot: 21,
  /** JSON: GameEvent[] */
  Events: 22,
  /** Binary: u32 echoed clientTimeMs + u32 serverTimeMs. */
  Pong: 23,
  /** JSON: RosterPayload - identities + scores changed. */
  Roster: 24,
  /** JSON: { code, message, fatal } */
  Error: 25,
  /** JSON: { rooms: RoomSummary[] } */
  RoomList: 26,
  /** JSON: { reason } */
  Kicked: 27,
  /** JSON: LobbyStatePayload - waiting-room roster and phase. */
  LobbyState: 28,
} as const;

export type OpCode = (typeof Op)[keyof typeof Op];

export const ErrorCode = {
  BadPacket: 'bad_packet',
  Unauthorized: 'unauthorized',
  RoomFull: 'room_full',
  RoomNotFound: 'room_not_found',
  BadPassword: 'bad_password',
  RateLimited: 'rate_limited',
  Banned: 'banned',
  AlreadyInRoom: 'already_in_room',
  NotInRoom: 'not_in_room',
  ServerFull: 'server_full',
  Internal: 'internal',
  NotAdmin: 'not_admin',
  RoomClosed: 'room_closed',
} as const;
export type ErrorCodeId = (typeof ErrorCode)[keyof typeof ErrorCode];
