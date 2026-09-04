import {
  ACTION_LABELS,
  DEFAULT_LOADOUT,
  DEFAULT_MAP_ID,
  MAP_IDS,
  WEAPON_DEFINITIONS,
  getMap,
  getWeapon,
  isLobbyCode,
  mapHasSides,
  normalizeLobbyCode,
  type QualityLevelId,
  type RoomSummary,
  type UserSettings,
  type WeaponId,
} from '@ragelab/shared';
import type { FullProfile, WeaponStatRow, AdminUserRow } from '../supabase/profileService';
import type { LeaderboardEntry } from '../../../supabase/types/database';
import { formatCode, el, clear } from './dom';
import { WeaponPreview } from './weaponPreview';

export type MenuScreen =
  | 'play'
  | 'servers'
  | 'loadout'
  | 'inventory'
  | 'profile'
  | 'settings'
  | 'controls'
  | 'auth'
  | 'admin';

type SettingsTab = 'video' | 'audio' | 'controls' | 'gameplay';

export interface MenuCallbacks {
  play: (opts: {
    username: string;
    roomId?: string;
    roomCode?: string;
    mapId?: string;
    password?: string;
    wsUrl?: string;
    team?: number;
  }) => void;
  createRoom: (opts: { name: string; mapId: string; maxPlayers: number; password: string; team?: number }) => void;
  joinByCode: (opts: { username: string; code: string; mapId?: string; wsUrl?: string; team?: number }) => void;
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

const NAV: Array<{ id: MenuScreen; label: string; hero?: boolean }> = [
  { id: 'play', label: 'Play', hero: true },
  { id: 'servers', label: 'Servers' },
  { id: 'loadout', label: 'Loadout' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'settings', label: 'Settings' },
];

const INTRO_MS = 1850;

const LOADOUT_GROUPS: Array<{ title: string; ids: WeaponId[] }> = [
  { title: 'Primary', ids: ['rifle', 'smg', 'shotgun', 'sniper'] },
  { title: 'Secondary', ids: ['pistol', 'glock', 'magnum'] },
];

export class MainMenu {
  readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly status: HTMLElement;
  private readonly profileChip: HTMLButtonElement;
  private readonly adminBtn: HTMLButtonElement;
  private readonly navButtons = new Map<MenuScreen, HTMLButtonElement>();
  private screen: MenuScreen = 'play';
  private settingsTab: SettingsTab = 'video';
  private guestName: string;
  private rebinding: string | null = null;
  private preview: WeaponPreview | null = null;
  private loadoutFocus: WeaponId = 'rifle';

  signedIn = false;
  username = 'Guest';
  supabaseReady = false;
  pendingJoinCode = '';
  private pendingTeam = 1;
  isAdmin = false;
  profile: FullProfile | null = null;
  weaponStats: WeaponStatRow[] = [];
  leaderboard: LeaderboardEntry[] = [];
  settings!: UserSettings;
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
    this.root = el('div', 'rl-screen mm-root is-intro');

    const fx = el('div', 'mm-fx');
    fx.append(
      el('div', 'mm-vignette'),
      el('div', 'mm-glow'),
      el('div', 'mm-grain'),
      el('div', 'mm-scan'),
    );
    this.root.append(fx);

    const intro = el('div', 'mm-intro');
    intro.innerHTML = `
      <div class="mm-intro-core">
        <div class="mm-intro-mark">RAGE<span>LAB</span></div>
        <p class="mm-intro-sub">SANDBOX MULTIPLAYER</p>
        <div class="mm-intro-bar" aria-hidden="true"></div>
      </div>`;
    this.root.append(intro);

    const shell = el('div', 'mm-shell');
    const top = el('div', 'mm-top');
    const word = el('div', 'mm-wordmark');
    word.innerHTML = `
      <p class="mm-brand-tag">TACTICAL SANDBOX</p>
      <h1>RAGE<span>LAB</span></h1>
      <p class="mm-brand-sub">BROWSER MULTIPLAYER FPS</p>`;
    this.profileChip = el('button', 'mm-profile');
    this.profileChip.type = 'button';
    this.profileChip.title = 'Profile';
    this.profileChip.addEventListener('click', () => this.show(this.signedIn ? 'profile' : 'auth'));
    top.append(word, this.profileChip);

    const body = el('div', 'mm-body');
    const nav = el('nav', 'mm-nav');
    let navIndex = 0;
    for (const item of NAV) {
      const btn = el('button', item.hero ? 'mm-nav-btn is-play' : 'mm-nav-btn', '');
      if (item.hero) {
        btn.innerHTML = `<span class="mm-play-ico" aria-hidden="true"></span><span>${item.label}</span>`;
      } else {
        navIndex += 1;
        btn.innerHTML = `<span class="mm-nav-index">${String(navIndex).padStart(2, '0')}</span><span>${item.label}</span>`;
      }
      btn.addEventListener('click', () => this.show(item.id));
      nav.append(btn);
      this.navButtons.set(item.id, btn);
    }
    this.adminBtn = el('button', 'mm-nav-btn', '');
    this.adminBtn.innerHTML = '<span class="mm-nav-index">AD</span><span>Admin</span>';
    this.adminBtn.hidden = true;
    this.adminBtn.addEventListener('click', () => this.show('admin'));
    nav.append(this.adminBtn);
    this.navButtons.set('admin', this.adminBtn);
    const quit = el('button', 'mm-nav-btn is-quit', 'Quit');
    quit.addEventListener('click', () => {
      if (window.confirm('Leave RAGELAB?')) this.callbacks.quit();
    });
    nav.append(quit);

    this.stage = el('div', 'mm-stage');
    body.append(nav, this.stage);

    const foot = el('div', 'mm-foot');
    this.status = el('div', 'mm-status');
    foot.append(this.status, el('div', 'mm-ver', 'v0.1.0'));

    shell.append(top, body, foot);
    this.root.append(shell);
    host.append(this.root);
    this.refreshChip();
    this.show('play');
    window.setTimeout(() => {
      this.root.classList.remove('is-intro');
      this.root.classList.add('is-ready');
    }, INTRO_MS);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
    if (!visible) this.disposePreview();
    else if (this.screen === 'loadout') this.ensurePreview();
  }

  setAuth(signedIn: boolean, username: string, supabaseReady: boolean): void {
    this.signedIn = signedIn;
    this.username = username;
    this.supabaseReady = supabaseReady;
    this.refreshChip();
    this.status.innerHTML = signedIn
      ? `signed in as <b>${escapeHtml(username)}</b>`
      : supabaseReady
        ? 'guest session · sign in to keep stats'
        : 'guest session · supabase not configured';
    if (!signedIn) this.setAdmin(false);
    if (
      this.screen === 'auth' ||
      this.screen === 'profile' ||
      this.screen === 'play' ||
      this.screen === 'inventory' ||
      this.screen === 'admin'
    ) {
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
    if (screen === 'controls') {
      this.settingsTab = 'controls';
      screen = 'settings';
    }
    this.screen = screen;
    for (const [id, btn] of this.navButtons) btn.classList.toggle('is-active', id === screen);
    if (screen !== 'loadout') this.disposePreview();
    this.stage.className = `mm-stage is-${screen}`;
    this.render();
  }

  private refreshChip(): void {
    const level = this.profile?.stats.level ?? 1;
    const name = this.signedIn ? this.username : this.guestName;
    const initial = (name[0] ?? 'R').toUpperCase();
    const avatar = this.profile?.profile.avatarUrl;
    this.profileChip.innerHTML = `
      <span class="mm-avatar">${avatar ? `<img src="${escapeHtml(avatar)}" alt="">` : escapeHtml(initial)}</span>
      <span class="mm-chip-meta"><b>${escapeHtml(name)}</b><i>LVL ${level}</i></span>`;
  }

  private render(): void {
    clear(this.stage);
    switch (this.screen) {
      case 'play':
        this.renderPlay();
        break;
      case 'servers':
        void this.renderServers();
        break;
      case 'loadout':
        this.renderLoadout();
        break;
      case 'inventory':
        this.renderInventory();
        break;
      case 'profile':
        this.renderProfile();
        break;
      case 'settings':
        this.renderSettings();
        break;
      case 'auth':
        this.renderAuth();
        break;
      case 'admin':
        void this.renderAdmin();
        break;
      case 'controls':
        this.settingsTab = 'controls';
        this.renderSettings();
        break;
    }
  }

  private operatorName(): string {
    if (this.signedIn) return this.username;
    return this.guestName;
  }

  private renderPlay(): void {
    const card = el('div', 'mm-glass mm-play-card');
    card.append(el('p', 'mm-kicker', 'Deploy'));
    card.append(el('h2', '', 'Offline match'));
    card.append(
      el(
        'p',
        'lead',
        'Jump straight into a local sandbox. Multiplayer lobbies live under Servers — create as admin, or join with a code.',
      ),
    );

    const form = el('div', 'rl-form mm-form');
    const name = inputField('Callsign', this.signedIn ? this.username : this.guestName, !this.signedIn);
    const map = selectField(
      'Map',
      MAP_IDS.map((id) => ({ value: id, label: getMap(id).name })),
      DEFAULT_MAP_ID,
    );
    const side = selectField(
      'Side',
      [
        { value: '1', label: 'Alpha' },
        { value: '2', label: 'Bravo' },
      ],
      String(this.pendingTeam),
    );
    const syncSide = (): void => {
      const mapId = (map.input as HTMLSelectElement).value;
      side.wrap.hidden = !mapHasSides(getMap(mapId));
    };
    map.input.addEventListener('change', syncSide);
    syncSide();
    side.input.addEventListener('change', () => {
      this.pendingTeam = (side.input as HTMLSelectElement).value === '2' ? 2 : 1;
    });

    const play = el('button', 'mm-play-cta', '');
    play.innerHTML = '<span class="mm-play-ico" aria-hidden="true"></span><span>Play</span>';
    play.addEventListener('click', () => {
      play.classList.add('is-pressed');
      const username = this.commitName(name);
      // Keep this in the click gesture so AudioContext / pointer lock can start.
      this.callbacks.play({
        username,
        mapId: (map.input as HTMLSelectElement).value,
        team: this.teamFor(map),
      });
    });

    form.append(name.wrap, map.wrap, side.wrap);
    card.append(form, play);
    this.stage.append(card);
  }

  private renderServers(): void {
    const card = el('div', 'mm-glass mm-wide');
    card.append(el('p', 'mm-kicker', 'Online'));
    card.append(el('h2', '', 'Multiplayer'));
    card.append(el('p', 'lead', 'Host a lobby on this machine, or join a friend with a 6-character code.'));

    const grid = el('div', 'mm-mp-grid');
    const createPane = el('div', 'mm-mp-pane');
    createPane.append(el('h3', '', 'Create lobby'));
    const map = selectField(
      'Map',
      MAP_IDS.map((id) => ({ value: id, label: getMap(id).name })),
      DEFAULT_MAP_ID,
    );
    const create = el('button', 'rl-btn primary rl-create-lobby', '');
    create.innerHTML = '<span class="rl-create-label">Create lobby</span>';
    create.disabled = !this.isAdmin || this.createBusy;
    if (!this.isAdmin) create.classList.add('is-locked');
    if (this.createBusy) {
      create.classList.add('is-loading');
      create.innerHTML = '<span class="rl-create-spinner" aria-hidden="true"></span><span class="rl-create-label">Creating…</span>';
    }
    create.addEventListener('click', () => {
      if (!this.isAdmin || this.createBusy) return;
      const mapId = (map.input as HTMLSelectElement).value;
      this.callbacks.createRoom({
        name: `${this.operatorName()}'s lobby`.slice(0, 48),
        mapId,
        maxPlayers: mapHasSides(getMap(mapId)) ? 2 : 16,
        password: '',
        team: mapHasSides(getMap(mapId)) ? this.pendingTeam : undefined,
      });
    });
    createPane.append(map.wrap, create);
    if (!this.isAdmin) {
      createPane.append(el('p', 'mm-lock-note', 'Only administrators can create a lobby'));
    }

    const joinPane = el('div', 'mm-mp-pane');
    joinPane.append(el('h3', '', 'Join with code'));
    const err = el('div', 'rl-error');
    const code = inputField('Code', this.pendingJoinCode);
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
    const join = el('button', 'rl-btn primary', 'Join');
    const go = (): void => {
      const value = normalizeLobbyCode(codeInput.value || this.pendingJoinCode);
      if (!isLobbyCode(value)) {
        err.textContent = 'Enter a 6-character lobby code.';
        return;
      }
      err.textContent = '';
      this.callbacks.joinByCode({ username: this.operatorName(), code: value });
    };
    codeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') go();
    });
    join.addEventListener('click', go);
    const joinRow = el('div', 'mm-join-row');
    joinRow.append(code.wrap, join);
    joinPane.append(joinRow, err);

    grid.append(createPane, joinPane);
    card.append(grid);

    const listHost = el('div', 'mm-room-list');
    listHost.textContent = 'Loading rooms…';
    card.append(listHost);
    this.stage.append(card);
    void this.fillRooms(listHost);
  }

  private async fillRooms(listHost: HTMLElement): Promise<void> {
    try {
      const rooms = await this.callbacks.refreshServers();
      if (this.screen !== 'servers') return;
      if (rooms.length === 0) {
        listHost.textContent = 'No live lobbies. An administrator can create one above.';
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
            username: this.operatorName(),
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

  private renderLoadout(): void {
    const card = el('div', 'mm-glass mm-wide mm-loadout');
    const def = getWeapon(this.loadoutFocus);
    card.append(el('p', 'mm-kicker', 'Armory'));
    card.append(el('h2', '', 'Loadout'));
    card.append(
      el(
        'p',
        'lead',
        'Spawn kit preview. The live match still uses the default five-slot loadout; sandbox guns (Glock 17, DX-50 Hammer) are picked up in-world.',
      ),
    );

    const layout = el('div', 'mm-loadout-layout');
    const list = el('div', 'mm-loadout-list');
    for (const group of LOADOUT_GROUPS) {
      list.append(el('h3', '', group.title));
      for (const id of group.ids) {
        const weapon = WEAPON_DEFINITIONS[id];
        if (!weapon) continue;
        const row = el('button', `mm-gun${id === this.loadoutFocus ? ' is-on' : ''}`, '');
        const kit = DEFAULT_LOADOUT.includes(id) ? 'Kit' : 'Sandbox';
        row.innerHTML = `<b>${escapeHtml(weapon.name)}</b><i>${kit} · ${weapon.magazineSize} rd</i>`;
        row.addEventListener('click', () => {
          this.loadoutFocus = id;
          this.render();
        });
        list.append(row);
      }
    }
    list.append(el('h3', '', 'Melee'));
    const melee = el('div', 'mm-gun is-static');
    melee.innerHTML = '<b>Katana</b><i>Sandbox pickup · not a loadout slot</i>';
    list.append(melee);
    list.append(el('h3', '', 'Equipment'));
    const tool = el('div', 'mm-gun is-static');
    tool.innerHTML = '<b>Tool Gun</b><i>In-match slot 6 · spawn / physics</i>';
    list.append(tool);

    const show = el('div', 'mm-loadout-show');
    show.append(el('div', 'mm-preview-title', def.name));
    const frame = el('div', 'mm-preview-frame');
    show.append(frame);
    show.append(
      el(
        'p',
        'mm-preview-meta',
        `${def.damage} dmg · ${def.rpm} rpm · ${def.magazineSize}/${def.reserveAmmo} ammo`,
      ),
    );

    layout.append(list, show);
    card.append(layout);
    this.stage.append(card);
    this.ensurePreview();
    this.preview?.show(this.loadoutFocus);
    const host = this.stage.querySelector('.mm-preview-frame');
    if (host instanceof HTMLElement && this.preview) this.preview.mount(host);
  }

  private renderInventory(): void {
    const card = el('div', 'mm-glass mm-wide');
    card.append(el('p', 'mm-kicker', 'Locker'));
    card.append(el('h2', '', 'Inventory'));

    if (!this.signedIn || !this.profile) {
      card.append(el('p', 'lead', 'Sign in to load cosmetics and persistent inventory from your profile.'));
      const go = el('button', 'rl-btn primary', 'Sign in');
      go.addEventListener('click', () => this.show('auth'));
      card.append(go);
      this.stage.append(card);
      return;
    }

    const owned = new Set(this.profile.inventory.map((i) => i.itemId));
    const equipped = new Set(this.profile.inventory.filter((i) => i.equipped).map((i) => i.itemId));
    const counts = new Map<string, number>();
    for (const entry of this.profile.inventory) {
      counts.set(entry.itemId, (counts.get(entry.itemId) ?? 0) + 1);
    }

    if (this.profile.cosmetics.length === 0) {
      card.append(el('p', 'lead', 'No cosmetic catalog is configured on this server yet.'));
      this.stage.append(card);
      return;
    }

    const grid = el('div', 'mm-inv-grid');
    for (const item of this.profile.cosmetics) {
      const have = owned.has(item.id);
      const tile = el('article', `mm-inv-card rarity-${item.rarity}${have ? '' : ' is-locked'}`);
      tile.innerHTML = `
        <span class="mm-inv-ico">${item.itemType[0]?.toUpperCase() ?? '?'}</span>
        <b>${escapeHtml(item.name)}</b>
        <i>${escapeHtml(item.itemType)} · ${escapeHtml(item.rarity)}</i>
        <em>${have ? `×${counts.get(item.id) ?? 1}` : 'Locked'}</em>`;
      if (have) {
        const btn = el('button', 'rl-btn', equipped.has(item.id) ? 'Equipped' : 'Equip');
        btn.disabled = equipped.has(item.id);
        btn.addEventListener('click', () => this.callbacks.equipCosmetic(item.id));
        tile.append(btn);
      }
      grid.append(tile);
    }
    card.append(grid);
    this.stage.append(card);
  }

  private async renderAdmin(): Promise<void> {
    const card = el('div', 'mm-glass mm-wide');
    card.append(el('h2', '', 'Admin'));
    card.append(
      el('p', 'lead', 'Registered accounts. Ban writes a reason the player sees on the website. Unban restores access immediately.'),
    );
    this.stage.append(card);
    if (!this.isAdmin) {
      card.append(el('p', 'rl-error', 'Admin access required.'));
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
    card.append(tools);
    if (this.adminNotice) card.append(el('div', 'rl-error', this.adminNotice));
    const tableHost = el('div', 'rl-admin-table');
    tableHost.textContent = 'Loading players…';
    card.append(tableHost);
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
      return user.username.toLowerCase().includes(needle) || (user.email ?? '').toLowerCase().includes(needle);
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
    const card = el('div', 'mm-glass mm-wide');
    card.append(el('p', 'mm-kicker', 'Operator'));
    card.append(el('h2', '', 'Profile'));
    if (!this.signedIn || !this.profile) {
      card.append(el('p', 'lead', 'Sign in to load your persistent profile, cosmetics and statistics.'));
      const go = el('button', 'rl-btn primary', 'Sign in');
      go.addEventListener('click', () => this.show('auth'));
      card.append(go);
      this.stage.append(card);
      return;
    }

    const p = this.profile;
    const form = el('div', 'rl-form mm-form');
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
      this.refreshChip();
    });
    const account = el('button', 'rl-btn', 'Account');
    account.addEventListener('click', () => this.show('auth'));
    form.append(name.wrap, avatar.wrap, err, save, account);
    card.append(form);

    const s = p.stats;
    const kd = s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : String(s.kills);
    const stats = el('div', 'stat-grid');
    for (const [label, value] of [
      ['Level', String(s.level)],
      ['XP', String(s.xp)],
      ['Wins', String(s.wins)],
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
    card.append(stats);

    if (this.weaponStats.length > 0) {
      const table = document.createElement('table');
      table.className = 'rl-table';
      table.innerHTML = `<thead><tr><th>Weapon</th><th>Kills</th><th>Fired</th><th>Hit</th><th>HS</th></tr></thead><tbody>${this.weaponStats
        .map(
          (w) =>
            `<tr><td>${escapeHtml(w.weaponId)}</td><td>${w.kills}</td><td>${w.shotsFired}</td><td>${w.shotsHit}</td><td>${w.headshots}</td></tr>`,
        )
        .join('')}</tbody>`;
      card.append(table);
    }

    if (this.leaderboard.length > 0) {
      card.append(el('p', 'lead', 'Leaderboard'));
      const table = document.createElement('table');
      table.className = 'rl-table';
      table.innerHTML = `<thead><tr><th>#</th><th>Player</th><th>K</th><th>D</th><th>Lv</th></tr></thead><tbody>${this.leaderboard
        .map(
          (row, i) =>
            `<tr><td>${i + 1}</td><td>${escapeHtml(row.username)}</td><td>${row.kills}</td><td>${row.deaths}</td><td>${row.level}</td></tr>`,
        )
        .join('')}</tbody>`;
      card.append(table);
    }
    this.stage.append(card);
  }

  private renderSettings(): void {
    const card = el('div', 'mm-glass mm-wide');
    card.append(el('p', 'mm-kicker', 'System'));
    card.append(el('h2', '', 'Settings'));
    const tabs = el('div', 'mm-tabs');
    for (const [id, label] of [
      ['video', 'Video'],
      ['audio', 'Audio'],
      ['controls', 'Controls'],
      ['gameplay', 'Gameplay'],
    ] as const) {
      const btn = el('button', this.settingsTab === id ? 'is-on' : '', label);
      btn.addEventListener('click', () => {
        this.settingsTab = id;
        this.render();
      });
      tabs.append(btn);
    }
    card.append(tabs);
    const body = el('div', 'mm-settings-body');
    const g = this.settings.graphics;
    const a = this.settings.audio;
    const c = this.settings.controls;

    if (this.settingsTab === 'video') {
      const quality = selectField('Graphics', ['low', 'medium', 'high', 'ultra'], g.quality);
      quality.input.addEventListener('change', () => {
        this.callbacks.applyQuality((quality.input as HTMLSelectElement).value as QualityLevelId);
      });
      body.append(
        quality.wrap,
        slider('Field of view', g.fov, 70, 110, 1, (v) => this.callbacks.patchGraphics({ fov: v })),
        slider('Resolution scale', g.resolutionScale, 0.5, 1.5, 0.05, (v) =>
          this.callbacks.patchGraphics({ resolutionScale: v }),
        ),
        slider('Render distance', g.renderDistance, 80, 400, 10, (v) =>
          this.callbacks.patchGraphics({ renderDistance: v }),
        ),
        checkbox('Shadows', g.shadows, (v) => this.callbacks.patchGraphics({ shadows: v })),
        checkbox('Antialias', g.antialias, (v) => this.callbacks.patchGraphics({ antialias: v })),
      );
      const full = el('button', 'rl-btn', document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen');
      full.addEventListener('click', () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
        window.setTimeout(() => this.render(), 200);
      });
      body.append(full);
    } else if (this.settingsTab === 'audio') {
      body.append(
        slider('Master volume', a.master, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ master: v })),
        slider('Music volume', a.music, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ music: v })),
        slider('SFX volume', a.effects, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ effects: v })),
        slider('Voice', a.voice, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ voice: v })),
        slider('UI', a.ui, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ ui: v })),
        slider('Ambience', a.ambience, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ ambience: v })),
      );
    } else if (this.settingsTab === 'controls') {
      body.append(
        slider('Mouse sensitivity', c.sensitivity, 0.4, 6, 0.05, (v) =>
          this.callbacks.patchControls({ sensitivity: v }),
        ),
        slider('ADS sensitivity', c.aimSensitivityMultiplier, 0.2, 1.5, 0.05, (v) =>
          this.callbacks.patchControls({ aimSensitivityMultiplier: v }),
        ),
        checkbox('Invert Y', c.invertY, (v) => this.callbacks.patchControls({ invertY: v })),
        checkbox('Toggle sprint', c.toggleSprint, (v) => this.callbacks.patchControls({ toggleSprint: v })),
        checkbox('Toggle crouch', c.toggleCrouch, (v) => this.callbacks.patchControls({ toggleCrouch: v })),
        checkbox('Toggle aim', c.toggleAim, (v) => this.callbacks.patchControls({ toggleAim: v })),
        el('p', 'lead', 'Bindings — click a key, then press a new one'),
      );
      for (const [action, label] of Object.entries(ACTION_LABELS)) {
        const row = el('div', 'bind-row');
        row.append(el('span', '', label));
        const btn = el('button', 'rl-btn bind-key', formatCode(c.bindings[action] ?? ''));
        if (this.rebinding === action) btn.textContent = 'Press a key…';
        btn.addEventListener('click', () => this.beginRebind(action, btn));
        row.append(btn);
        body.append(row);
      }
    } else {
      body.append(
        checkbox('Show FPS', g.showFps, (v) => this.callbacks.patchGraphics({ showFps: v })),
        checkbox('Show ping', g.showPing, (v) => this.callbacks.patchGraphics({ showPing: v })),
        checkbox('Debug overlay', g.debugOverlay, (v) => this.callbacks.patchGraphics({ debugOverlay: v })),
        el('p', 'lead', 'Crosshair, camera shake and weapon sway are driven in-match from weapon recoil. They are not separate saved toggles.'),
      );
    }
    card.append(body);
    this.stage.append(card);
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
    const card = el('div', 'mm-glass');
    card.append(el('h2', '', this.signedIn ? 'Account' : 'Sign in'));
    if (!this.supabaseReady) {
      card.append(
        el('p', 'lead', 'Supabase public keys are missing from .env, so accounts are unavailable. Guest play still works.'),
      );
      this.stage.append(card);
      return;
    }
    if (this.signedIn) {
      card.append(el('p', 'lead', `Signed in as ${this.username}.`));
      const out = el('button', 'rl-btn', 'Sign out');
      out.addEventListener('click', () => this.callbacks.signOut());
      card.append(out);
      this.stage.append(card);
      return;
    }

    const err = el('div', 'rl-error');
    const login = el('div', 'rl-form mm-form');
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
    card.append(login, el('p', 'lead', 'New here?'), err);

    const signup = el('div', 'rl-form mm-form');
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
    card.append(signup);
    this.stage.append(card);
  }

  private commitName(name: { input: HTMLElement }): string {
    const username = this.signedIn ? this.username : (name.input as HTMLInputElement).value.trim();
    if (!this.signedIn) this.guestName = username || this.guestName;
    this.username = username || this.guestName;
    this.refreshChip();
    return this.username;
  }

  private ensurePreview(): void {
    if (!this.preview) this.preview = new WeaponPreview();
  }

  private disposePreview(): void {
    this.preview?.stop();
    this.preview = null;
  }

  private teamFor(map: { input: HTMLElement }): number | undefined {
    const mapId = (map.input as HTMLSelectElement).value;
    return mapHasSides(getMap(mapId)) ? this.pendingTeam : undefined;
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

function selectField(
  label: string,
  values: readonly string[] | readonly { value: string; label: string }[],
  current: string,
): { wrap: HTMLElement; input: HTMLElement } {
  const wrap = el('label', 'rl-field', label);
  const input = el('select', 'rl-input') as HTMLSelectElement;
  for (const entry of values) {
    const value = typeof entry === 'string' ? entry : entry.value;
    const text = typeof entry === 'string' ? entry : entry.label;
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
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
