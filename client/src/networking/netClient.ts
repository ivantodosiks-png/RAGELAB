import {
  ByteWriter,
  Op,
  PROTOCOL_VERSION,
  createEmptySnapshot,
  decodeJsonBody,
  decodePong,
  decodeSnapshot,
  encodeInputPacket,
  encodeJson,
  encodePing,
  type ChatPayload,
  type CreateRoomPayload,
  type ErrorPayload,
  type EventsPayload,
  type HelloPayload,
  type InputPacket,
  type KickedPayload,
  type LobbyStatePayload,
  type OpCode,
  type RoomConfig,
  type RoomListPayload,
  type RosterPayload,
  type StartMatchPayload,
  type SwitchWeaponPayload,
  type WelcomePayload,
  type WorldSnapshot,
} from '@ragelab/shared';

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'closed';

export interface NetClientHandlers {
  onState?: (state: ConnectionState, detail?: string) => void;
  onWelcome?: (payload: WelcomePayload) => void;
  onSnapshot?: (snapshot: WorldSnapshot) => void;
  onEvents?: (payload: EventsPayload) => void;
  onRoster?: (payload: RosterPayload) => void;
  onRoomList?: (payload: RoomListPayload) => void;
  onLobbyState?: (payload: LobbyStatePayload) => void;
  onError?: (payload: ErrorPayload) => void;
  onKicked?: (payload: KickedPayload) => void;
  onRtt?: (rttMs: number, clockOffsetMs: number) => void;
}

export interface ConnectOptions {
  url: string;
  token?: string;
  username?: string;
  roomId?: string;
  roomCode?: string;
  password?: string;
  mapId?: string;
  mode?: HelloPayload['mode'];
  create?: Partial<RoomConfig>;
}

const PING_INTERVAL_MS = 1000;
const RECONNECT_DELAYS_MS = [400, 900, 1800, 3200, 5000];

/**
 * WebSocket transport.
 *
 * Owns framing (opcode dispatch), the snapshot baseline chain, latency
 * estimation and automatic reconnect. Everything above this layer deals in
 * decoded payloads only.
 */
export class NetClient {
  private socket: WebSocket | null = null;
  private state: ConnectionState = 'idle';
  private options: ConnectOptions | null = null;
  private handlers: NetClientHandlers = {};

  /** Last decoded snapshot; the baseline the next delta applies to. */
  private baseline: WorldSnapshot = createEmptySnapshot();
  private lastSnapshotTick = 0;

  private readonly inputWriter = new ByteWriter(512);

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private intentionalClose = false;

  rttMs = 0;
  /** serverTime - clientTime, so serverNow ≈ performance.now() + offset. */
  clockOffsetMs = 0;
  bytesIn = 0;
  bytesOut = 0;
  snapshotsIn = 0;

  setHandlers(handlers: NetClientHandlers): void {
    this.handlers = handlers;
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(options: ConnectOptions): void {
    this.options = options;
    this.intentionalClose = false;
    this.reconnectAttempt = 0;
    this.openSocket();
  }

  /** Update the token used on the next (re)connect, e.g. after a refresh. */
  setToken(token: string | undefined): void {
    if (this.options) this.options.token = token;
  }

  private openSocket(): void {
    const options = this.options;
    if (!options) return;

    this.cleanupSocket();
    this.setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(options.url);
    } catch (error) {
      this.scheduleReconnect(String(error));
      return;
    }
    if (this.reconnectAttempt === 0) {
      console.info('[net] connecting', options.url);
    }
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onopen = () => {
      this.setState('authenticating');
      const hello: HelloPayload = {
        protocol: PROTOCOL_VERSION,
        token: options.token,
        username: options.username,
        roomId: options.roomId,
        roomCode: options.roomCode,
        password: options.password,
        mapId: options.mapId,
        mode: options.mode,
        create: options.create,
      };
      this.sendJson(Op.Hello, hello);
    };

    socket.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(event.data);
      this.bytesIn += bytes.byteLength;
      try {
        this.dispatch(bytes);
      } catch (error) {
        console.error('[net] failed to handle packet', error);
      }
    };

    socket.onerror = () => {
      // onclose always follows; reconnect logic lives there.
    };

    socket.onclose = (event) => {
      this.stopPing();
      if (this.intentionalClose) {
        this.setState('closed');
        return;
      }
      this.scheduleReconnect(event.reason || `code ${event.code}`);
    };
  }

  private dispatch(bytes: Uint8Array): void {
    const op = bytes[0];
    switch (op) {
      case Op.Snapshot: {
        const snapshot = decodeSnapshot(bytes, this.baseline);
        // Out-of-order delivery is impossible over TCP, but a stale duplicate
        // after reconnect would corrupt the baseline chain.
        if (snapshot.tick < this.lastSnapshotTick) return;
        this.baseline = snapshot;
        this.lastSnapshotTick = snapshot.tick;
        this.snapshotsIn += 1;
        this.handlers.onSnapshot?.(snapshot);
        return;
      }
      case Op.Pong: {
        const { clientTimeMs, serverTimeMs } = decodePong(bytes);
        const now = this.nowMs();
        const rtt = Math.max(0, now - clientTimeMs);
        // Exponential moving average keeps the HUD number readable.
        this.rttMs = this.rttMs === 0 ? rtt : this.rttMs * 0.8 + rtt * 0.2;
        this.clockOffsetMs = serverTimeMs + rtt / 2 - now;
        this.handlers.onRtt?.(this.rttMs, this.clockOffsetMs);
        return;
      }
      case Op.Welcome: {
        const payload = decodeJsonBody<WelcomePayload>(bytes);
        this.baseline = createEmptySnapshot();
        this.lastSnapshotTick = 0;
        this.reconnectAttempt = 0;
        this.clockOffsetMs = payload.serverTimeMs - this.nowMs();
        if (this.options) {
          this.options.create = undefined;
          this.options.roomId = payload.room.id;
          this.options.roomCode = payload.room.joinCode;
        }
        this.setState('connected');
        this.startPing();
        this.handlers.onWelcome?.(payload);
        return;
      }
      case Op.Events:
        this.handlers.onEvents?.(decodeJsonBody<EventsPayload>(bytes));
        return;
      case Op.Roster:
        this.handlers.onRoster?.(decodeJsonBody<RosterPayload>(bytes));
        return;
      case Op.RoomList:
        this.handlers.onRoomList?.(decodeJsonBody<RoomListPayload>(bytes));
        return;
      case Op.LobbyState:
        this.handlers.onLobbyState?.(decodeJsonBody<LobbyStatePayload>(bytes));
        return;
      case Op.Error: {
        const payload = decodeJsonBody<ErrorPayload>(bytes);
        if (payload.fatal) this.intentionalClose = true;
        this.handlers.onError?.(payload);
        return;
      }
      case Op.Kicked: {
        this.intentionalClose = true;
        this.handlers.onKicked?.(decodeJsonBody<KickedPayload>(bytes));
        return;
      }
      default:
        return;
    }
  }

  // ── outbound ──────────────────────────────────────────────────────────────

  sendInput(packet: InputPacket): void {
    if (!this.isOpen) return;
    this.sendBytes(encodeInputPacket(packet, this.inputWriter));
  }

  sendSwitchWeapon(slot: number): void {
    this.sendJson(Op.SwitchWeapon, { slot } satisfies SwitchWeaponPayload);
  }

  sendChat(text: string): void {
    this.sendJson(Op.Chat, { text } satisfies ChatPayload);
  }

  sendRespawnRequest(): void {
    this.sendJson(Op.RespawnRequest, {});
  }

  requestRoomList(): void {
    this.sendJson(Op.ListRooms, {});
  }

  createRoom(payload: CreateRoomPayload): void {
    this.sendJson(Op.CreateRoom, payload);
  }

  leaveRoom(): void {
    this.sendJson(Op.LeaveRoom, {});
  }

  startMatch(): void {
    this.sendJson(Op.StartMatch, {} satisfies StartMatchPayload);
  }

  private sendJson(op: OpCode, payload: unknown): void {
    if (!this.isOpen) return;
    this.sendBytes(encodeJson(op, payload));
  }

  private sendBytes(bytes: Uint8Array): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    // Drop gameplay traffic when the send buffer backs up; stale input is
    // worse than no input.
    if (socket.bufferedAmount > 1 << 20) return;
    socket.send(bytes);
    this.bytesOut += bytes.byteLength;
  }

  /** Latest snapshot tick, echoed back so the server can pick a baseline. */
  get ackTick(): number {
    return this.lastSnapshotTick;
  }

  nowMs(): number {
    return performance.now();
  }

  /** Best estimate of the server clock, used to schedule interpolation. */
  serverNowMs(): number {
    return this.nowMs() + this.clockOffsetMs;
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  private startPing(): void {
    this.stopPing();
    const send = (): void => {
      if (!this.isOpen) return;
      this.sendBytes(encodePing(Op.Ping, Math.round(this.nowMs())));
    };
    send();
    this.pingTimer = setInterval(send, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(detail: string): void {
    if (!this.options) {
      this.setState('closed', detail);
      return;
    }
    if (this.reconnectAttempt >= RECONNECT_DELAYS_MS.length) {
      this.intentionalClose = true;
      this.setState('closed', detail);
      this.handlers.onKicked?.({ reason: 'Host left — session ended' });
      return;
    }
    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]!;
    this.reconnectAttempt += 1;
    this.setState('reconnecting', detail);
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private setState(state: ConnectionState, detail?: string): void {
    if (this.state === state && detail === undefined) return;
    this.state = state;
    this.handlers.onState?.(state, detail);
  }

  private cleanupSocket(): void {
    const socket = this.socket;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
    this.socket = null;
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.stopPing();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanupSocket();
    this.baseline = createEmptySnapshot();
    this.lastSnapshotTick = 0;
    this.setState('closed');
  }
}
