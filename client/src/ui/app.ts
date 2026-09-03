import { GAME_SERVER_HTTP_URL, supabaseConfigured } from '../supabase/client';
import { authService } from '../supabase/auth';
import { profileService, type FullProfile } from '../supabase/profileService';
import { settingsStore } from '../settings/settingsStore';
import { Hud } from './hud';
import { MainMenu } from './menu';
import type { QualityLevelId, RoomSummary } from '@ragelab/shared';
import { el } from './dom';

export interface JoinRequest {
  username: string;
  roomId?: string;
  mapId?: string;
  password?: string;
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
  readonly connecting: HTMLElement;
  private readonly overlay: HTMLElement;

  onJoin: ((request: JoinRequest) => void) | null = null;
  onLeaveMatch: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.menu = new MainMenu(root, {
      play: (opts) => this.onJoin?.({ ...opts }),
      createRoom: (opts) => this.onJoin?.({ username: this.menu.username, create: opts }),
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

    this.connecting = el('div', 'connecting', 'Connecting…');
    root.append(this.connecting);

    this.overlay = el('div', 'toast');
    root.append(this.overlay);
  }

  showMenu(): void {
    this.menu.setVisible(true);
    this.hud.setVisible(false);
    this.hud.setPaused(false);
    this.setConnecting(false);
  }

  showGame(): void {
    this.menu.setVisible(false);
    this.hud.setVisible(true);
    this.setConnecting(false);
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
        settingsStore.hydrateFromRemote(full.settings);
        settingsStore.attachRemote((settings) => {
          void profileService.saveSettings(state.user!.id, settings);
        });
      }
      this.menu.weaponStats = await profileService.loadWeaponStats(state.user.id);
      this.menu.leaderboard = await profileService.leaderboard();
    } else {
      this.menu.profile = null;
    }
  }

  private async signIn(email: string, password: string): Promise<string | null> {
    const result = await authService.signIn(email, password);
    if (!result.ok) return result.message ?? 'Sign in failed';
    await this.refreshAuth();
    this.menu.show('play');
    return null;
  }

  private async signUp(email: string, password: string, username: string): Promise<string | null> {
    const result = await authService.signUp(email, password, username);
    if (!result.ok) return result.message ?? 'Sign up failed';
    if (result.needsConfirmation) return 'Check your email to confirm the account, then sign in.';
    await this.refreshAuth();
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
    try {
      const res = await fetch(`${GAME_SERVER_HTTP_URL}/rooms`);
      if (res.ok) {
        const body = (await res.json()) as { rooms?: RoomSummary[] };
        if (body.rooms) return body.rooms;
      }
    } catch {
      /* fall through to supabase registry */
    }
    return profileService.activeServers();
  }

  get profile(): FullProfile | null {
    return this.menu.profile;
  }
}
