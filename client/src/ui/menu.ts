import {
  ACTION_LABELS,
  DEFAULT_MAP_ID,
  MAP_IDS,
  isLobbyCode,
  normalizeLobbyCode,
  type QualityLevelId,
  type RoomSummary,
  type UserSettings,
} from '@ragelab/shared';
import type { FullProfile, WeaponStatRow, AdminUserRow } from '../supabase/profileService';
import type { LeaderboardEntry } from '../../../supabase/types/database';
import { formatCode, el, clear } from './dom';

export type MenuScreen = 'play' | 'servers' | 'profile' | 'settings' | 'controls' | 'auth' | 'admin';

export interface MenuCallbacks {
  play: (opts: {
    username: string;
    roomId?: string;
    roomCode?: string;
    mapId?: string;
    password?: string;
    wsUrl?: string;
  }) => void;
  createRoom: (opts: { name: string; mapId: string; maxPlayers: number; password: string }) => void;
  joinByCode: (opts: { username: string; code: string; mapId?: string; wsUrl?: string }) => void;
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
  listUsers: () => Promise<AdminUserRow[]>;
  banUser: (profileId: string, reason: string) => Promise<string | null>;
  unbanUser: (profileId: string) => Promise<string | null>;
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
  pendingJoinCode = '';
  isAdmin = false;
  profile: FullProfile | null = null;
  weaponStats: WeaponStatRow[] = [];
  leaderboard: LeaderboardEntry[] = [];
  settings!: UserSettings;
  private readonly adminBtn: HTMLButtonElement;
  private adminUsers: AdminUserRow[] = [];
  private adminQuery = '';
  private pendingBanId: string | null = null;
  private adminNotice = '';
  private createBusy = false;

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
    this.adminBtn = el('button', '', 'Admin');
    this.adminBtn.hidden = true;
    this.adminBtn.addEventListener('click', () => this.show('admin'));
    nav.append(this.adminBtn);
    this.navButtons.set('admin', this.adminBtn);
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
    if (!signedIn) this.setAdmin(false);
    if (this.screen === 'auth' || this.screen === 'profile' || this.screen === 'play' || this.screen === 'admin') {
      this.render();
    }
  }

  setAdmin(isAdmin: boolean): void {
    this.isAdmin = isAdmin;
    this.adminBtn.hidden = !isAdmin;
    if (!isAdmin && this.screen === 'admin') this.show('play');
    else if (this.screen === 'play' || this.screen === 'servers') this.render();
  }

  setCreateBusy(busy: boolean): void {
    this.createBusy = busy;
    if (this.screen === 'play' || this.screen === 'servers') this.render();
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
      case 'admin':
        void this.renderAdmin();
        break;
    }
  }

  private renderPlay(): void {
    this.panel.append(el('h2', '', 'Play'));
    this.panel.append(
      el(
        'p',
        'lead',
        'Офлайн доступен всем — сервер не нужен. Онлайн-лобби может создать только администратор после npm run dev.',
      ),
    );
    const form = el('div', 'rl-form');
    const name = inputField('Позывной', this.signedIn ? this.username : this.guestName, !this.signedIn);
    const map = selectField('Карта', MAP_IDS, DEFAULT_MAP_ID);
    const err = el('div', 'rl-error');

    const offline = el('button', 'rl-btn primary rl-create-lobby', '');
    offline.innerHTML =
      '<span class="rl-create-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M5 4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5v15a.75.75 0 0 1-1.2.6L12 16.25 6.2 20.1A.75.75 0 0 1 5 19.5v-15Z"/></svg></span><span class="rl-create-label">Офлайн игра</span>';
    offline.addEventListener('click', () => {
      const username = this.signedIn ? this.username : (name.input as HTMLInputElement).value.trim();
      if (!this.signedIn) this.guestName = username || this.guestName;
      this.username = username || this.guestName;
      this.callbacks.play({
        username: username || this.guestName,
        mapId: (map.input as HTMLSelectElement).value,
      });
    });

    const createWrap = el('div', 'rl-create-wrap');
    if (!this.isAdmin) createWrap.dataset.tip = 'Только для администратора';
    const create = el('button', 'rl-btn rl-create-lobby', '');
    create.innerHTML =
      '<span class="rl-create-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v7h7a1 1 0 1 1 0 2h-7v7a1 1 0 1 1-2 0v-7H4a1 1 0 1 1 0-2h7V4a1 1 0 0 1 1-1Z"/></svg></span><span class="rl-create-label">Создать лобби</span>';
    create.disabled = !this.isAdmin || this.createBusy;
    if (!this.isAdmin) create.classList.add('is-locked');
    if (this.createBusy) {
      create.classList.add('is-loading');
      create.innerHTML =
        '<span class="rl-create-spinner" aria-hidden="true"></span><span class="rl-create-label">Создание…</span>';
    }
    create.addEventListener('click', () => {
      if (!this.isAdmin || this.createBusy) return;
      const username = this.signedIn ? this.username : (name.input as HTMLInputElement).value.trim();
      if (!this.signedIn) this.guestName = username || this.guestName;
      this.username = username || this.guestName;
      err.textContent = '';
      this.callbacks.createRoom({
        name: `${this.username}'s lobby`.slice(0, 48),
        mapId: (map.input as HTMLSelectElement).value,
        maxPlayers: 16,
        password: '',
      });
    });
    createWrap.append(create);

    const joinBlock = el('div', 'lobby-join-block');
    joinBlock.append(el('h3', 'lobby-join-title', 'Введите код лобби'));
    const code = inputField('Код', this.pendingJoinCode);
    const codeInput = code.input as HTMLInputElement;
    codeInput.maxLength = 6;
    codeInput.autocomplete = 'off';
    codeInput.placeholder = 'X7K9P2';
    codeInput.spellcheck = false;
    codeInput.style.textTransform = 'uppercase';
    codeInput.addEventListener('input', () => {
      const next = normalizeLobbyCode(codeInput.value);
      this.pendingJoinCode = next;
      if (codeInput.value !== next) codeInput.value = next;
    });
    codeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') join.click();
    });

    const join = el('button', 'rl-btn', 'Подключиться');
    join.addEventListener('click', () => {
      const username = this.signedIn ? this.username : (name.input as HTMLInputElement).value.trim();
      if (!this.signedIn) this.guestName = username || this.guestName;
      const value = normalizeLobbyCode(codeInput.value || this.pendingJoinCode);
      if (!isLobbyCode(value)) {
        err.textContent = 'Введите 6-символьный код лобби.';
        return;
      }
      err.textContent = '';
      this.callbacks.joinByCode({
        username: username || this.guestName,
        code: value,
        mapId: (map.input as HTMLSelectElement).value,
      });
    });

    joinBlock.append(code.wrap, join);
    form.append(name.wrap, map.wrap, offline, createWrap, err, joinBlock);
    this.panel.append(form);
  }

  private async renderServers(): Promise<void> {
    this.panel.append(el('h2', '', 'Servers'));
    this.panel.append(el('p', 'lead', 'Живые лобби. Зайти можно кнопкой Join или кодом на вкладке Play.'));
    const listHost = el('div');
    listHost.textContent = 'Loading rooms…';
    this.panel.append(listHost);

    try {
      const rooms = await this.callbacks.refreshServers();
      if (rooms.length === 0) {
        listHost.textContent = 'Нет живых лобби. Админ создаёт лобби на вкладке Play.';
        return;
      }
      const table = document.createElement('table');
      table.className = 'rl-table';
      table.innerHTML = `<thead><tr><th>Name</th><th>Map</th><th>Code</th><th>Players</th><th></th></tr></thead>`;
      const body = document.createElement('tbody');
      for (const room of rooms) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(room.name)}</td><td>${escapeHtml(room.mapId)}</td>
          <td>${escapeHtml(room.joinCode ?? '—')}</td><td>${room.playerCount}/${room.maxPlayers}</td>`;
        const td = document.createElement('td');
        const btn = el('button', 'rl-btn', room.hasPassword ? 'Join…' : 'Join');
        btn.addEventListener('click', () => {
          const password = room.hasPassword ? window.prompt('Room password') ?? '' : undefined;
          this.callbacks.play({
            username: this.signedIn ? this.username : this.guestName,
            roomId: room.id,
            roomCode: room.joinCode,
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

  private async renderAdmin(): Promise<void> {
    this.panel.append(el('h2', '', 'Admin'));
    this.panel.append(
      el('p', 'lead', 'Registered accounts. Ban writes a reason the player sees on the website. Unban restores access immediately.'),
    );
    if (!this.isAdmin) {
      this.panel.append(el('p', 'rl-error', 'Admin access required.'));
      return;
    }

    const tools = el('div', 'rl-admin-tools');
    const search = inputField('Search', this.adminQuery);
    const searchInput = search.input as HTMLInputElement;
    searchInput.placeholder = 'username or email';
    searchInput.addEventListener('input', () => {
      this.adminQuery = searchInput.value;
      this.fillAdminTable(tableHost);
    });
    const refresh = el('button', 'rl-btn', 'Refresh');
    refresh.addEventListener('click', () => void this.reloadAdminUsers());
    tools.append(search.wrap, refresh);
    this.panel.append(tools);

    if (this.adminNotice) this.panel.append(el('div', 'rl-error', this.adminNotice));

    const tableHost = el('div', 'rl-admin-table');
    tableHost.textContent = 'Loading players…';
    this.panel.append(tableHost);

    if (this.adminUsers.length === 0) {
      await this.reloadAdminUsers(false);
      if (this.screen !== 'admin') return;
      clear(tableHost);
    }
    this.fillAdminTable(tableHost);
  }

  private async reloadAdminUsers(rerender = true): Promise<void> {
    this.adminNotice = '';
    try {
      this.adminUsers = await this.callbacks.listUsers();
    } catch (err) {
      this.adminNotice = err instanceof Error ? err.message : String(err);
      this.adminUsers = [];
    }
    if (rerender && this.screen === 'admin') this.render();
  }

  private fillAdminTable(host: HTMLElement): void {
    clear(host);
    const needle = this.adminQuery.trim().toLowerCase();
    const rows = this.adminUsers.filter((user) => {
      if (!needle) return true;
      return (
        user.username.toLowerCase().includes(needle) ||
        (user.email ?? '').toLowerCase().includes(needle)
      );
    });
    if (rows.length === 0) {
      host.textContent = this.adminUsers.length === 0 ? 'No registered players yet.' : 'No players match that search.';
      return;
    }

    const table = document.createElement('table');
    table.className = 'rl-table';
    table.innerHTML =
      '<thead><tr><th>Player</th><th>Email</th><th>Joined</th><th>Lv</th><th>K/D</th><th>Status</th><th></th></tr></thead>';
    const body = document.createElement('tbody');
    for (const user of rows) {
      const tr = document.createElement('tr');
      if (user.banned) tr.classList.add('banned');
      const status = user.isAdmin ? 'Admin' : user.banned ? 'Banned' : 'Active';
      tr.innerHTML = `<td>${escapeHtml(user.username)}</td>
        <td>${escapeHtml(user.email ?? '—')}</td>
        <td>${escapeHtml(user.createdAt.slice(0, 10))}</td>
        <td>${user.level}</td>
        <td>${user.kills}/${user.deaths}</td>
        <td>${escapeHtml(status)}</td>`;
      const td = document.createElement('td');
      if (user.isAdmin) {
        td.append(el('span', 'rl-muted', '—'));
      } else if (user.banned) {
        const unban = el('button', 'rl-btn', 'Unban');
        unban.addEventListener('click', async () => {
          this.adminNotice = (await this.callbacks.unbanUser(user.id)) ?? '';
          this.pendingBanId = null;
          await this.reloadAdminUsers();
        });
        td.append(unban);
        if (user.banReason) td.append(el('div', 'rl-ban-reason', user.banReason));
      } else if (this.pendingBanId === user.id) {
        const wrap = el('div', 'rl-ban-form');
        const reason = document.createElement('textarea');
        reason.className = 'rl-input';
        reason.rows = 3;
        reason.maxLength = 280;
        reason.placeholder = 'Ban reason (shown to the player)';
        const confirm = el('button', 'rl-btn danger', 'Confirm ban');
        confirm.addEventListener('click', async () => {
          this.adminNotice = (await this.callbacks.banUser(user.id, reason.value.trim())) ?? '';
          this.pendingBanId = null;
          await this.reloadAdminUsers();
        });
        const cancel = el('button', 'rl-btn', 'Cancel');
        cancel.addEventListener('click', () => {
          this.pendingBanId = null;
          this.fillAdminTable(host);
        });
        wrap.append(reason, confirm, cancel);
        td.append(wrap);
      } else {
        const ban = el('button', 'rl-btn danger', 'Ban');
        ban.addEventListener('click', () => {
          this.pendingBanId = user.id;
          this.fillAdminTable(host);
        });
        td.append(ban);
      }
      tr.append(td);
      body.append(tr);
    }
    table.append(body);
    host.append(table);
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
