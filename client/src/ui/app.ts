import {
  GAME_SERVER_HTTP_URL,
  localGameServerReachable,
  shouldQueryConfiguredGameHttp,
  supabaseConfigured,
} from '../supabase/client';
import { authService } from '../supabase/auth';
import { profileService, type FullProfile } from '../supabase/profileService';
import { settingsStore } from '../settings/settingsStore';
import { Hud } from './hud';
import { MainMenu } from './menu';
import { LobbyWait, type LobbyWaitState } from './lobbyWait';
import { isLobbyCode, normalizeLobbyCode, type QualityLevelId, type RoomSummary } from '@ragelab/shared';
import { el } from './dom';

function isListedAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return __ADMIN_EMAILS__.includes(email.trim().toLowerCase());
}

export interface JoinRequest {
  username: string;
  roomId?: string;
  roomCode?: string;
  mapId?: string;
  password?: string;
  wsUrl?: string;
  offline?: boolean;
  team?: number;
  create?: {
    name: string;
    mapId: string;
    maxPlayers: number;
    password: string;
  };
}

export class UiApp {
  readonly menu: MainMenu;
  readonly hud: Hud;
  readonly lobby: LobbyWait;
  readonly connecting: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly banScreen: HTMLElement;
  private readonly banReason: HTMLElement;
  private banned = false;

  onJoin: ((request: JoinRequest) => void) | null = null;
  onLeaveMatch: (() => void) | null = null;
  onStartMatch: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.menu = new MainMenu(root, {
      play: (opts) => {
        if (opts.roomId || opts.roomCode || opts.wsUrl) void this.joinFromPlay(opts);
        else this.startOffline(opts);
      },
      createRoom: (opts) => void this.hostNewRoom(opts),
      joinByCode: (opts) => void this.joinByCode(opts),
      refreshServers: () => this.fetchRooms(),
      signIn: (email, password) => this.signIn(email, password),
      signUp: (email, password, username) => this.signUp(email, password, username),
      signOut: () => void authService.signOut(),
      saveProfile: (username, avatarUrl) => this.saveProfile(username, avatarUrl),
      patchGraphics: (patch) => settingsStore.patchGraphics(patch as never),
      patchAudio: (patch) => settingsStore.patchAudio(patch as never),
      patchControls: (patch) => settingsStore.patchControls(patch as never),
      applyQuality: (quality: QualityLevelId) => settingsStore.applyQualityPreset(quality),
      setBinding: (action, code) => settingsStore.setBinding(action, code),
      equipCosmetic: (itemId) => {
        const user = authService.current.user;
        if (user) void profileService.equipCosmetic(user.id, itemId);
      },
      listUsers: () => profileService.listUsers(),
      banUser: async (profileId, reason) => {
        const result = await profileService.banUser(profileId, reason);
        return result.ok ? null : result.message ?? 'Ban failed';
      },
      unbanUser: async (profileId) => {
        const result = await profileService.unbanUser(profileId);
        return result.ok ? null : result.message ?? 'Unban failed';
      },
      quit: () => {
        document.documentElement.innerHTML =
          '<body style="background:#090b0d;color:#8b9786;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0"><p>You left RAGELAB. Close this tab, or refresh to return.</p></body>';
      },
    });
    this.menu.settings = settingsStore.value;
    settingsStore.events.on('changed', (value) => {
      this.menu.settings = value;
    });

    this.hud = new Hud(root);
    this.hud.setVisible(false);
    this.lobby = new LobbyWait(root);
    this.lobby.onStart = () => this.onStartMatch?.();
    this.lobby.onLeave = () => this.onLeaveMatch?.();

    this.connecting = el('div', 'connecting', 'Connecting…');
    root.append(this.connecting);

    this.overlay = el('div', 'toast');
    root.append(this.overlay);

    this.banScreen = el('div', 'ban-screen');
    this.banScreen.hidden = true;
    const banCard = el('div', 'ban-card');
    banCard.append(el('p', 'ban-kicker', 'RAGELAB'));
    banCard.append(el('h1', '', 'You were banned'));
    this.banReason = el('p', 'ban-reason', '');
    banCard.append(this.banReason);
    const signOut = el('button', 'rl-btn', 'Sign out');
    signOut.addEventListener('click', () => void authService.signOut());
    banCard.append(signOut);
    this.banScreen.append(banCard);
    root.append(this.banScreen);

    window.setInterval(() => {
      if (authService.current.status === 'signedIn') void this.refreshBan();
    }, 20_000);
  }

  showMenu(): void {
    if (this.banned) {
      this.banScreen.hidden = false;
      this.menu.setVisible(false);
      this.hud.setVisible(false);
      this.setConnecting(false);
      return;
    }
    this.menu.setVisible(true);
    this.hud.setVisible(false);
    this.hud.setPaused(false);
    this.lobby.setVisible(false);
    this.setConnecting(false);
  }

  showGame(): void {
    this.menu.setVisible(false);
    this.hud.setVisible(true);
    this.lobby.setVisible(false);
    this.setConnecting(false);
  }

  showLobbyWait(state: LobbyWaitState): void {
    this.menu.setCreateBusy(false);
    this.menu.setVisible(false);
    this.hud.setVisible(false);
    this.setConnecting(false);
    this.lobby.setVisible(true);
    this.lobby.render(state);
  }

  hideLobbyWait(): void {
    this.lobby.setVisible(false);
  }

  setConnecting(open: boolean, label = 'Connecting…'): void {
    this.connecting.textContent = label;
    this.connecting.classList.toggle('open', open);
  }

  toast(text: string): void {
    this.hud.showToast(text);
    this.overlay.textContent = text;
    this.overlay.classList.add('show');
    window.setTimeout(() => this.overlay.classList.remove('show'), 2400);
  }

  joinInvite(invite: { code: string; wsUrl?: string }): Promise<void> {
    this.menu.pendingJoinCode = invite.code;
    return this.joinByCode({
      username: this.menu.username,
      code: invite.code,
      wsUrl: invite.wsUrl,
    });
  }

  async refreshAuth(): Promise<void> {
    const state = authService.current;
    const username = state.user?.user_metadata?.username ?? state.user?.email ?? 'Operator';
    this.menu.setAuth(state.status === 'signedIn', String(username), supabaseConfigured());
    if (state.status === 'signedIn' && state.user) {
      const full = await profileService.loadFull(state.user.id);
      if (full) {
        this.menu.profile = full;
        this.menu.username = full.profile.username;
        this.menu.setAuth(true, full.profile.username, true);
        this.menu.setAdmin((full.isAdmin || isListedAdminEmail(state.user.email)) && !full.ban);
        settingsStore.hydrateFromRemote(full.settings);
        settingsStore.attachRemote((settings) => {
          void profileService.saveSettings(state.user!.id, settings);
        });
        if (full.ban) {
          this.showBan(full.ban.reason);
          this.onLeaveMatch?.();
          return;
        }
      } else {
        this.menu.setAdmin(false);
      }
      this.hideBan();
      this.menu.weaponStats = await profileService.loadWeaponStats(state.user.id);
      this.menu.leaderboard = await profileService.leaderboard();
    } else {
      this.menu.profile = null;
      this.menu.setAdmin(false);
      this.hideBan();
      this.menu.setVisible(true);
    }
  }

  private async refreshBan(): Promise<void> {
    if (authService.current.status !== 'signedIn') return;
    const ban = await profileService.myActiveBan();
    if (ban) {
      this.showBan(ban.reason);
      this.onLeaveMatch?.();
    } else if (this.banned) {
      this.hideBan();
      this.showMenu();
    }
  }

  private showBan(reason: string): void {
    this.banned = true;
    this.banReason.textContent = reason.trim() || 'No reason given.';
    this.banScreen.hidden = false;
    this.menu.setVisible(false);
    this.hud.setVisible(false);
    this.lobby.setVisible(false);
    this.setConnecting(false);
  }

  private hideBan(): void {
    this.banned = false;
    this.banScreen.hidden = true;
  }

  private blockedByBan(): boolean {
    if (!this.banned) return false;
    this.showBan(this.banReason.textContent || 'No reason given.');
    return true;
  }

  private async signIn(email: string, password: string): Promise<string | null> {
    const result = await authService.signIn(email, password);
    if (!result.ok) return result.message ?? 'Sign in failed';
    await this.refreshAuth();
    if (this.banned) return null;
    this.menu.show('play');
    return null;
  }

  private async signUp(email: string, password: string, username: string): Promise<string | null> {
    const result = await authService.signUp(email, password, username);
    if (!result.ok) return result.message ?? 'Sign up failed';
    if (result.needsConfirmation) return 'Check your email to confirm the account, then sign in.';
    await this.refreshAuth();
    if (this.banned) return null;
    this.menu.show('play');
    return null;
  }

  private async saveProfile(username: string, avatarUrl: string): Promise<string | null> {
    const user = authService.current.user;
    if (!user) return 'Not signed in';
    const result = await profileService.updateProfile(user.id, {
      username,
      avatarUrl: avatarUrl || null,
    });
    if (!result.ok) return result.message ?? 'Save failed';
    await this.refreshAuth();
    return null;
  }

  private async fetchRooms(): Promise<RoomSummary[]> {
    const local = await this.fetchLocalRooms();
    const remote = supabaseConfigured() ? await profileService.activeServers() : [];
    const seen = new Set<string>();
    const out: RoomSummary[] = [];

    for (const room of local.rooms) {
      seen.add(`${local.wsUrl ?? 'local'}|${room.id}`);
      // Rooms on this PC join through the same-origin proxy, not the public tunnel.
      out.push({ ...room, wsUrl: undefined });
    }
    for (const room of remote) {
      const key = `${room.wsUrl ?? ''}|${room.id}`;
      if (local.wsUrl && room.wsUrl === local.wsUrl && seen.has(`${local.wsUrl}|${room.id}`)) {
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(room);
    }
    return out;
  }

  private async fetchLocalRooms(): Promise<{ rooms: RoomSummary[]; wsUrl: string | null }> {
    if (!shouldQueryConfiguredGameHttp()) return { rooms: [], wsUrl: null };
    try {
      const res = await fetch(`${GAME_SERVER_HTTP_URL}/rooms`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return { rooms: [], wsUrl: null };
      const body = (await res.json()) as { rooms?: RoomSummary[]; wsUrl?: string | null };
      return { rooms: body.rooms ?? [], wsUrl: body.wsUrl ?? null };
    } catch {
      return { rooms: [], wsUrl: null };
    }
  }

  private async fetchLobbyByCode(code: string): Promise<RoomSummary | null> {
    if (!shouldQueryConfiguredGameHttp()) return null;
    try {
      const res = await fetch(`${GAME_SERVER_HTTP_URL}/lobby/${encodeURIComponent(code)}`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { room?: RoomSummary; wsUrl?: string | null };
      if (!body.room) return null;
      return { ...body.room, wsUrl: body.wsUrl || body.room.wsUrl };
    } catch {
      return null;
    }
  }

  private startOffline(opts: { username: string; mapId?: string; team?: number }): void {
    if (this.blockedByBan()) return;
    this.onJoin?.({
      username: opts.username,
      mapId: opts.mapId,
      team: opts.team,
      offline: true,
    });
  }

  private async joinFromPlay(opts: {
    username: string;
    roomId?: string;
    roomCode?: string;
    mapId?: string;
    password?: string;
    wsUrl?: string;
    team?: number;
  }): Promise<void> {
    if (this.blockedByBan()) return;
    if (opts.roomCode) {
      await this.joinByCode({
        username: opts.username,
        code: opts.roomCode,
        mapId: opts.mapId,
        wsUrl: opts.wsUrl,
        team: opts.team,
      });
      return;
    }
    this.onJoin?.(opts);
  }

  private async joinByCode(opts: {
    username: string;
    code: string;
    mapId?: string;
    wsUrl?: string;
    team?: number;
  }): Promise<void> {
    if (this.blockedByBan()) return;
    const code = normalizeLobbyCode(opts.code);
    if (!isLobbyCode(code)) {
      this.toast('Введите 6-символьный код лобби.');
      return;
    }

    const listed = (await this.fetchLobbyByCode(code)) ?? (await profileService.findLobby(code));
    if (listed) {
      this.onJoin?.({
        username: opts.username,
        roomId: listed.id,
        roomCode: listed.joinCode ?? code,
        mapId: opts.mapId ?? listed.mapId,
        wsUrl: opts.wsUrl || listed.wsUrl,
        team: opts.team,
      });
      return;
    }

    if (opts.wsUrl) {
      this.onJoin?.({
        username: opts.username,
        roomCode: code,
        mapId: opts.mapId,
        wsUrl: opts.wsUrl,
        team: opts.team,
      });
      return;
    }

    if (await localGameServerReachable()) {
      this.onJoin?.({ username: opts.username, roomCode: code, mapId: opts.mapId, team: opts.team });
      return;
    }

    this.toast('Лобби не найдено. Админ должен запустить npm run dev и создать лобби.');
  }

  private async hostNewRoom(opts: {
    name: string;
    mapId: string;
    maxPlayers: number;
    password: string;
    team?: number;
  }): Promise<void> {
    if (this.blockedByBan()) return;
    if (!this.menu.isAdmin) {
      this.toast('Только администратор может создать лобби.');
      return;
    }
    if (await localGameServerReachable()) {
      this.menu.setCreateBusy(true);
      this.onJoin?.({ username: this.menu.username, create: opts, mapId: opts.mapId, team: opts.team });
      return;
    }
    this.toast('Онлайн недоступен. Запустите npm run dev на этом ПК, затем создайте лобби.');
  }

  get profile(): FullProfile | null {
    return this.menu.profile;
  }
}
