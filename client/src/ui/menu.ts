import {
  ACTION_LABELS,
  DEFAULT_MAP_ID,
  MAP_IDS,
  type QualityLevelId,
  type RoomSummary,
  type UserSettings,
} from '@ragelab/shared';
import type { FullProfile, WeaponStatRow } from '../supabase/profileService';
import type { LeaderboardEntry } from '../../../supabase/types/database';
import { formatCode, el, clear } from './dom';

export type MenuScreen = 'play' | 'servers' | 'profile' | 'settings' | 'controls' | 'auth';

export interface MenuCallbacks {
  play: (opts: {
    username: string;
    roomId?: string;
    mapId?: string;
    password?: string;
    wsUrl?: string;
  }) => void;
  createRoom: (opts: { name: string; mapId: string; maxPlayers: number; password: string }) => void;
  refreshServers: () => Promise<RoomSummary[]>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string, username: string) => Promise<string | null>;
  signOut: () => void;
  saveProfile: (username: string, avatarUrl: string) => Promise<string | null>;
  patchGraphics: (patch: Record<string, unknown>) => void;
  patchAudio: (patch: Record<string, unknown>) => void;
  patchControls: (patch: Record<string, unknown>) => void;
  applyQuality: (quality: QualityLevelId) => void;
  setBinding: (action: string, code: string) => void;
  equipCosmetic: (itemId: string) => void;
  quit: () => void;
}

export class MainMenu {
  readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly status: HTMLElement;
  private readonly navButtons = new Map<MenuScreen, HTMLButtonElement>();
  private screen: MenuScreen = 'play';
  private guestName: string;
  private rebinding: string | null = null;

  signedIn = false;
  username = 'Guest';
  supabaseReady = false;
  profile: FullProfile | null = null;
  weaponStats: WeaponStatRow[] = [];
  leaderboard: LeaderboardEntry[] = [];
  settings!: UserSettings;

  constructor(
    host: HTMLElement,
    private readonly callbacks: MenuCallbacks,
  ) {
    this.guestName = `Operator-${Math.floor(1000 + Math.random() * 9000)}`;
    this.root = el('div', 'rl-screen');
    const menu = el('div', 'rl-menu');

    const brand = el('div', 'rl-brand');
    const logo = el('h1', 'rl-logo');
    logo.innerHTML = 'RAGE<span>LAB</span>';
    brand.append(logo, el('p', 'rl-tag', 'sandbox fps'));

    const nav = el('div', 'rl-nav');
    for (const [id, label] of [
      ['play', 'Play'],
      ['servers', 'Servers'],
      ['profile', 'Profile'],
      ['settings', 'Settings'],
      ['controls', 'Controls'],
    ] as const) {
      const btn = el('button', '', label);
      btn.addEventListener('click', () => this.show(id));
      nav.append(btn);
      this.navButtons.set(id, btn);
    }
    const authBtn = el('button', '', 'Sign in');
    authBtn.addEventListener('click', () => this.show('auth'));
    nav.append(authBtn);
    this.navButtons.set('auth', authBtn);
    const quit = el('button', 'danger', 'Quit');
    quit.addEventListener('click', () => this.callbacks.quit());
    nav.append(quit);
    brand.append(nav);

    this.status = el('div', 'rl-status');
    brand.append(this.status);

    this.panel = el('div', 'rl-panel');
    menu.append(brand, this.panel);
    this.root.append(menu);
    host.append(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  setAuth(signedIn: boolean, username: string, supabaseReady: boolean): void {
    this.signedIn = signedIn;
    this.username = username;
    this.supabaseReady = supabaseReady;
    const authBtn = this.navButtons.get('auth');
    if (authBtn) authBtn.textContent = signedIn ? 'Account' : 'Sign in';
    this.status.innerHTML = signedIn
      ? `signed in as <b>${escapeHtml(username)}</b>`
      : supabaseReady
        ? 'guest session · sign in to keep stats'
        : 'guest session · supabase not configured';
    if (this.screen === 'auth' || this.screen === 'profile' || this.screen === 'play') {
      this.render();
    }
  }

  show(screen: MenuScreen): void {
    this.screen = screen;
    for (const [id, btn] of this.navButtons) btn.classList.toggle('active', id === screen);
    this.render();
  }

  private render(): void {
    clear(this.panel);
    switch (this.screen) {
      case 'play':
        this.renderPlay();
        break;
      case 'servers':
        void this.renderServers();
        break;
      case 'profile':
        this.renderProfile();
        break;
      case 'settings':
        this.renderSettings();
        break;
      case 'controls':
        this.renderControls();
        break;
      case 'auth':
        this.renderAuth();
        break;
    }
  }

  private renderPlay(): void {
    this.panel.append(el('h2', '', 'Drop in'));
    this.panel.append(
      el(
        'p',
        'lead',
        'Host a match from this PC (any internet) or join a live host. When the host leaves, the session ends for everyone.',
      ),
    );
    const form = el('div', 'rl-form');
    const name = inputField('Callsign', this.signedIn ? this.username : this.guestName, !this.signedIn);
    const map = selectField('Map', MAP_IDS, DEFAULT_MAP_ID);
    const err = el('div', 'rl-error');
    const play = el('button', 'rl-btn primary', 'Play');
    play.addEventListener('click', () => {
      const username = this.signedIn ? this.username : (name.input as HTMLInputElement).value.trim();
      if (!this.signedIn) this.guestName = username || this.guestName;
      this.callbacks.play({
        username: username || this.guestName,
        mapId: (map.input as HTMLSelectElement).value,
      });
    });
    form.append(name.wrap, map.wrap, err, play);
    this.panel.append(form);
  }

  private async renderServers(): Promise<void> {
    this.panel.append(el('h2', '', 'Servers'));
    this.panel.append(
      el(
        'p',
        'lead',
        'Create a room on this PC to host. Friends join from this list over the internet. If you leave, everyone is kicked.',
      ),
    );
    const listHost = el('div');
    listHost.textContent = 'Loading rooms…';
    this.panel.append(listHost);

    const create = el('div', 'rl-card');
    create.append(el('h3', '', 'Create room'));
    const form = el('div', 'rl-form');
    const name = inputField('Name', 'Rage Yard');
    const map = selectField('Map', MAP_IDS, DEFAULT_MAP_ID);
    const max = inputField('Max players', '16');
    (max.input as HTMLInputElement).type = 'number';
    const password = inputField('Password (optional)', '');
    (password.input as HTMLInputElement).type = 'password';
    const go = el('button', 'rl-btn primary', 'Host & join');
    go.addEventListener('click', () => {
      this.callbacks.createRoom({
        name: (name.input as HTMLInputElement).value.trim() || 'RAGELAB',
        mapId: (map.input as HTMLSelectElement).value,
        maxPlayers: Number((max.input as HTMLInputElement).value) || 16,
        password: (password.input as HTMLInputElement).value,
      });
    });
    form.append(name.wrap, map.wrap, max.wrap, password.wrap, go);
    create.append(form);
    this.panel.append(create);

    try {
      const rooms = await this.callbacks.refreshServers();
      if (rooms.length === 0) {
        listHost.textContent = 'No rooms listed. Host one below, or hit Play.';
        return;
      }
      const table = document.createElement('table');
      table.className = 'rl-table';
      table.innerHTML = `<thead><tr><th>Name</th><th>Map</th><th>Players</th><th>Mode</th><th></th></tr></thead>`;
      const body = document.createElement('tbody');
      for (const room of rooms) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(room.name)}</td><td>${escapeHtml(room.mapId)}</td>
          <td>${room.playerCount}/${room.maxPlayers}</td><td>${room.mode}</td>`;
        const td = document.createElement('td');
        const btn = el('button', 'rl-btn', room.hasPassword ? 'Join…' : 'Join');
        btn.addEventListener('click', () => {
          const password = room.hasPassword ? window.prompt('Room password') ?? '' : undefined;
          this.callbacks.play({
            username: this.signedIn ? this.username : this.guestName,
            roomId: room.id,
            password: password || undefined,
            wsUrl: room.wsUrl,
          });
        });
        td.append(btn);
        tr.append(td);
        body.append(tr);
      }
      table.append(body);
      clear(listHost);
      listHost.append(table);
    } catch (err) {
      listHost.textContent = `Could not reach the game server: ${String(err)}`;
    }
  }

  private renderProfile(): void {
    this.panel.append(el('h2', '', 'Profile'));
    if (!this.signedIn || !this.profile) {
      this.panel.append(
        el('p', 'lead', 'Sign in to load your persistent profile, cosmetics and statistics from Supabase.'),
      );
      const go = el('button', 'rl-btn primary', 'Sign in');
      go.addEventListener('click', () => this.show('auth'));
      this.panel.append(go);
      return;
    }

    const p = this.profile;
    const form = el('div', 'rl-form');
    const name = inputField('Username', p.profile.username);
    const avatar = inputField('Avatar URL', p.profile.avatarUrl ?? '');
    const err = el('div', 'rl-error');
    const save = el('button', 'rl-btn primary', 'Save profile');
    save.addEventListener('click', async () => {
      err.textContent = '';
      const message = await this.callbacks.saveProfile(
        (name.input as HTMLInputElement).value.trim(),
        (avatar.input as HTMLInputElement).value.trim(),
      );
      err.textContent = message ?? 'Saved.';
    });
    form.append(name.wrap, avatar.wrap, err, save);
    this.panel.append(form);

    const s = p.stats;
    const kd = s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : String(s.kills);
    const stats = el('div', 'stat-grid');
    for (const [label, value] of [
      ['Level', String(s.level)],
      ['XP', String(s.xp)],
      ['Kills', String(s.kills)],
      ['Deaths', String(s.deaths)],
      ['K/D', kd],
      ['Headshots', String(s.headshots)],
      ['Matches', String(s.matchesPlayed)],
      ['Playtime', formatPlaytime(s.playtimeSeconds)],
    ] as const) {
      const node = el('div', 'stat');
      node.append(el('b', '', value), el('span', '', label));
      stats.append(node);
    }
    this.panel.append(el('p', 'lead', ''), stats);

    if (this.weaponStats.length > 0) {
      const table = document.createElement('table');
      table.className = 'rl-table';
      table.innerHTML = `<thead><tr><th>Weapon</th><th>Kills</th><th>Fired</th><th>Hit</th><th>HS</th></tr></thead><tbody>${this.weaponStats
        .map(
          (w) =>
            `<tr><td>${escapeHtml(w.weaponId)}</td><td>${w.kills}</td><td>${w.shotsFired}</td><td>${w.shotsHit}</td><td>${w.headshots}</td></tr>`,
        )
        .join('')}</tbody>`;
      this.panel.append(table);
    }

    if (p.cosmetics.length > 0) {
      this.panel.append(el('p', 'lead', 'Cosmetics'));
      const owned = new Set(p.inventory.map((i) => i.itemId));
      const equipped = new Set(p.inventory.filter((i) => i.equipped).map((i) => i.itemId));
      for (const item of p.cosmetics) {
        const row = el('div', 'cosmetic');
        const left = el('div');
        left.innerHTML = `<b class="rarity-${item.rarity}">${escapeHtml(item.name)}</b><div style="color:var(--muted);font-size:12px">${item.itemType} · ${item.rarity}</div>`;
        row.append(left);
        if (owned.has(item.id)) {
          const btn = el('button', 'rl-btn', equipped.has(item.id) ? 'Equipped' : 'Equip');
          btn.disabled = equipped.has(item.id);
          btn.addEventListener('click', () => this.callbacks.equipCosmetic(item.id));
          row.append(btn);
        } else {
          row.append(el('span', '', 'Locked'));
        }
        this.panel.append(row);
      }
    }

    if (this.leaderboard.length > 0) {
      this.panel.append(el('p', 'lead', 'Leaderboard'));
      const table = document.createElement('table');
      table.className = 'rl-table';
      table.innerHTML = `<thead><tr><th>#</th><th>Player</th><th>K</th><th>D</th><th>Lv</th></tr></thead><tbody>${this.leaderboard
        .map(
          (row, i) =>
            `<tr><td>${i + 1}</td><td>${escapeHtml(row.username)}</td><td>${row.kills}</td><td>${row.deaths}</td><td>${row.level}</td></tr>`,
        )
        .join('')}</tbody>`;
      this.panel.append(table);
    }
  }

  private renderSettings(): void {
    this.panel.append(el('h2', '', 'Settings'));
    const g = this.settings.graphics;
    const a = this.settings.audio;

    this.panel.append(el('p', 'lead', 'Graphics'));
    const quality = selectField('Quality', ['low', 'medium', 'high', 'ultra'], g.quality);
    quality.input.addEventListener('change', () => {
      this.callbacks.applyQuality((quality.input as HTMLSelectElement).value as QualityLevelId);
    });
    this.panel.append(quality.wrap);
    this.panel.append(
      slider('Field of view', g.fov, 70, 110, 1, (v) => this.callbacks.patchGraphics({ fov: v })),
      slider('Render distance', g.renderDistance, 80, 400, 10, (v) =>
        this.callbacks.patchGraphics({ renderDistance: v }),
      ),
      slider('Resolution scale', g.resolutionScale, 0.5, 1.5, 0.05, (v) =>
        this.callbacks.patchGraphics({ resolutionScale: v }),
      ),
      checkbox('Shadows', g.shadows, (v) => this.callbacks.patchGraphics({ shadows: v })),
      checkbox('Antialias', g.antialias, (v) => this.callbacks.patchGraphics({ antialias: v })),
      checkbox('Show FPS', g.showFps, (v) => this.callbacks.patchGraphics({ showFps: v })),
      checkbox('Show ping', g.showPing, (v) => this.callbacks.patchGraphics({ showPing: v })),
      checkbox('Debug overlay', g.debugOverlay, (v) => this.callbacks.patchGraphics({ debugOverlay: v })),
    );

    this.panel.append(el('p', 'lead', 'Audio'));
    this.panel.append(
      slider('Master', a.master, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ master: v })),
      slider('Effects', a.effects, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ effects: v })),
      slider('Music', a.music, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ music: v })),
      slider('Voice', a.voice, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ voice: v })),
      slider('UI', a.ui, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ ui: v })),
      slider('Ambience', a.ambience, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ ambience: v })),
    );
  }

  private renderControls(): void {
    this.panel.append(el('h2', '', 'Controls'));
    const c = this.settings.controls;
    this.panel.append(
      slider('Sensitivity', c.sensitivity, 0.4, 6, 0.05, (v) => this.callbacks.patchControls({ sensitivity: v })),
      slider('ADS sensitivity', c.aimSensitivityMultiplier, 0.2, 1.5, 0.05, (v) =>
        this.callbacks.patchControls({ aimSensitivityMultiplier: v }),
      ),
      checkbox('Invert Y', c.invertY, (v) => this.callbacks.patchControls({ invertY: v })),
      checkbox('Toggle sprint', c.toggleSprint, (v) => this.callbacks.patchControls({ toggleSprint: v })),
      checkbox('Toggle crouch', c.toggleCrouch, (v) => this.callbacks.patchControls({ toggleCrouch: v })),
      checkbox('Toggle aim', c.toggleAim, (v) => this.callbacks.patchControls({ toggleAim: v })),
    );

    this.panel.append(el('p', 'lead', 'Bindings — click a key, then press a new one'));
    for (const [action, label] of Object.entries(ACTION_LABELS)) {
      const row = el('div', 'bind-row');
      row.append(el('span', '', label));
      const btn = el('button', 'rl-btn bind-key', formatCode(c.bindings[action] ?? ''));
      if (this.rebinding === action) btn.textContent = 'Press a key…';
      btn.addEventListener('click', () => this.beginRebind(action, btn));
      row.append(btn);
      this.panel.append(row);
    }
  }

  private beginRebind(action: string, btn: HTMLButtonElement): void {
    this.rebinding = action;
    btn.textContent = 'Press a key…';
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      this.rebinding = null;
      this.callbacks.setBinding(action, event.code);
      this.render();
    };
    const onMouse = (event: MouseEvent): void => {
      event.preventDefault();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      this.rebinding = null;
      this.callbacks.setBinding(action, `Mouse${event.button}`);
      this.render();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
  }

  private renderAuth(): void {
    this.panel.append(el('h2', '', this.signedIn ? 'Account' : 'Sign in'));
    if (!this.supabaseReady) {
      this.panel.append(
        el('p', 'lead', 'Supabase public keys are missing from .env, so accounts are unavailable. Guest play still works.'),
      );
      return;
    }
    if (this.signedIn) {
      this.panel.append(el('p', 'lead', `Signed in as ${this.username}.`));
      const out = el('button', 'rl-btn', 'Sign out');
      out.addEventListener('click', () => this.callbacks.signOut());
      this.panel.append(out);
      return;
    }

    const err = el('div', 'rl-error');
    const login = el('div', 'rl-form');
    const email = inputField('Email', '');
    (email.input as HTMLInputElement).type = 'email';
    const password = inputField('Password', '');
    (password.input as HTMLInputElement).type = 'password';
    const signIn = el('button', 'rl-btn primary', 'Sign in');
    signIn.addEventListener('click', async () => {
      err.textContent = '';
      const message = await this.callbacks.signIn(
        (email.input as HTMLInputElement).value,
        (password.input as HTMLInputElement).value,
      );
      if (message) err.textContent = message;
    });
    login.append(email.wrap, password.wrap, signIn);
    this.panel.append(login, el('p', 'lead', 'New here?'), err);

    const signup = el('div', 'rl-form');
    const user = inputField('Username', '');
    const email2 = inputField('Email', '');
    (email2.input as HTMLInputElement).type = 'email';
    const pass2 = inputField('Password', '');
    (pass2.input as HTMLInputElement).type = 'password';
    const create = el('button', 'rl-btn', 'Create account');
    create.addEventListener('click', async () => {
      err.textContent = '';
      const message = await this.callbacks.signUp(
        (email2.input as HTMLInputElement).value,
        (pass2.input as HTMLInputElement).value,
        (user.input as HTMLInputElement).value,
      );
      if (message) err.textContent = message;
    });
    signup.append(user.wrap, email2.wrap, pass2.wrap, create);
    this.panel.append(signup);
  }
}

function inputField(label: string, value: string, enabled = true): { wrap: HTMLElement; input: HTMLElement } {
  const wrap = el('label', 'rl-field', label);
  const input = el('input', 'rl-input') as HTMLInputElement;
  input.value = value;
  input.disabled = !enabled;
  wrap.append(input);
  return { wrap, input };
}

function selectField(label: string, values: readonly string[], current: string): { wrap: HTMLElement; input: HTMLElement } {
  const wrap = el('label', 'rl-field', label);
  const input = el('select', 'rl-input') as HTMLSelectElement;
  for (const value of values) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    if (value === current) opt.selected = true;
    input.append(opt);
  }
  wrap.append(input);
  return { wrap, input };
}

function slider(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (value: number) => void,
): HTMLElement {
  const wrap = el('label', 'rl-field', label);
  const row = el('div', 'range-wrap');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const readout = el('span', '', formatNum(value));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    readout.textContent = formatNum(v);
    onChange(v);
  });
  row.append(input, readout);
  wrap.append(row);
  return wrap;
}

function checkbox(label: string, value: boolean, onChange: (value: boolean) => void): HTMLElement {
  const wrap = el('label', 'rl-field check');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  wrap.append(input, document.createTextNode(label));
  return wrap;
}

function formatNum(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatPlaytime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
  );
}
