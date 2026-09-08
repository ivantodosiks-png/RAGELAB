import {
  ACTION_LABELS,
  DEFAULT_MAP_ID,
  MAP_IDS,
  getMap,
  mapHasSides,
  type QualityLevelId,
  type RoomSummary,
  type UserSettings,
} from '@ragelab/shared';
import type { FullProfile, WeaponStatRow, AdminUserRow } from '../supabase/profileService';
import type { LeaderboardEntry } from '../../../supabase/types/database';
import { formatCode, el, clear } from './dom';

export type MenuScreen =
  | 'home'
  | 'raid'
  | 'deploy'
  | 'character'
  | 'settings'
  | 'auth'
  | 'admin';

type SettingsTab = 'video' | 'audio' | 'controls' | 'interface';

export interface MenuPresence {
  playersOnline: number;
  serverLabel: string;
  pingMs: number | null;
}

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

const RAID_MAPS = MAP_IDS;

export class MainMenu {
  readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly adminBtn: HTMLButtonElement;
  private readonly settingsBtn: HTMLButtonElement;
  private screen: MenuScreen = 'home';
  private settingsTab: SettingsTab = 'video';
  private guestName: string;
  private rebinding: string | null = null;
  private presence: MenuPresence = {
    playersOnline: 0,
    serverLabel: 'Menu',
    pingMs: null,
  };
  private selectedMapId = DEFAULT_MAP_ID;
  private toastTimer = 0;

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
  /** True when local game server answers /health (npm run dev). */
  private canHostOnline = false;

  constructor(
    host: HTMLElement,
    private readonly callbacks: MenuCallbacks,
  ) {
    this.guestName = `Operator-${Math.floor(1000 + Math.random() * 9000)}`;
    this.root = el('div', 'rl-screen mm-root hit is-ready');
    this.root.tabIndex = 0;

    const fx = el('div', 'mm-fx');
    fx.append(
      el('div', 'mm-forest'),
      el('div', 'mm-vignette'),
      el('div', 'mm-glow'),
      el('div', 'mm-grain'),
    );
    this.root.append(fx);

    const shell = el('div', 'mm-shell');
    this.stage = el('div', 'mm-stage is-home');
    shell.append(this.stage);

    const dock = el('div', 'mm-dock');
    const dockRight = el('div', 'mm-dock-right');
    this.settingsBtn = el('button', 'mm-dock-ico', '') as HTMLButtonElement;
    this.settingsBtn.type = 'button';
    this.settingsBtn.title = 'Settings';
    this.settingsBtn.innerHTML = gearSvg();
    this.settingsBtn.addEventListener('click', () => this.show('settings'));
    this.adminBtn = el('button', 'mm-dock-ico mm-dock-admin', 'ADM') as HTMLButtonElement;
    this.adminBtn.type = 'button';
    this.adminBtn.title = 'Admin';
    this.adminBtn.hidden = true;
    this.adminBtn.addEventListener('click', () => this.show('admin'));
    dockRight.append(this.settingsBtn, this.adminBtn);
    dock.append(el('div', 'mm-dock-left'), dockRight);
    shell.append(dock);

    this.root.append(shell);
    host.append(this.root);
    this.show('home');
    this.bindKeyboard();
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  setPresence(presence: Partial<MenuPresence>): void {
    this.presence = { ...this.presence, ...presence };
  }

  setAuth(signedIn: boolean, username: string, supabaseReady: boolean): void {
    this.signedIn = signedIn;
    this.username = username;
    this.supabaseReady = supabaseReady;
    if (!signedIn) this.setAdmin(false);
    if (this.screen === 'auth' || this.screen === 'character' || this.screen === 'home') this.render();
  }

  setAdmin(isAdmin: boolean): void {
    this.isAdmin = isAdmin;
    this.adminBtn.hidden = !isAdmin;
    if (!isAdmin && this.screen === 'admin') this.show('home');
  }

  setCreateBusy(busy: boolean): void {
    this.createBusy = busy;
    if (this.screen === 'map') this.render();
  }

  setCanHostOnline(can: boolean): void {
    if (this.canHostOnline === can) return;
    this.canHostOnline = can;
    if (this.screen === 'map') this.render();
  }

  setProfile(profile: FullProfile | null, weaponStats: WeaponStatRow[], leaderboard: LeaderboardEntry[]): void {
    this.profile = profile;
    this.weaponStats = weaponStats;
    this.leaderboard = leaderboard;
    if (this.screen === 'character' || this.screen === 'home') this.render();
  }

  show(screen: MenuScreen): void {
    this.screen = screen;
    this.stage.className = `mm-stage is-${screen}`;
    this.render();
  }

  private bindKeyboard(): void {
    this.root.addEventListener('keydown', (event) => {
      if (this.rebinding) return;
      if (isTypingTarget(event.target)) return;
      if (event.code === 'Escape') {
        if (this.screen === 'home') return;
        if (this.screen === 'deploy') this.show('raid');
        else if (this.screen === 'raid') this.show('home');
        else this.show('home');
        event.preventDefault();
      }
    });
  }

  private render(): void {
    clear(this.stage);
    switch (this.screen) {
      case 'home':
        this.renderHome();
        break;
      case 'raid':
        this.renderRaidSelect();
        break;
      case 'deploy':
        this.renderDeploy();
        break;
      case 'character':
        this.renderCharacter();
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
    }
  }

  private operatorName(): string {
    return this.signedIn ? this.username : this.guestName;
  }

  /** Public callsign for join / lobby create. */
  get callsign(): string {
    return this.operatorName();
  }

  private flashLocked(label: string): void {
    window.clearTimeout(this.toastTimer);
    let toast = this.root.querySelector('.mm-lock-toast') as HTMLElement | null;
    if (!toast) {
      toast = el('div', 'mm-lock-toast');
      this.root.append(toast);
    }
    toast.textContent = `${label.toUpperCase()} — LOCKED`;
    toast.classList.add('is-on');
    this.toastTimer = window.setTimeout(() => toast?.classList.remove('is-on'), 1600);
  }

  private renderHome(): void {
    const view = el('div', 'tk-home');
    view.append(el('p', 'tk-beta', 'BETA TESTING'));

    const logo = el('h1', 'tk-title');
    logo.textContent = 'Escape from Hamar';
    view.append(logo);

    const warn = el('div', 'tk-warn');
    warn.innerHTML = `
      <span class="tk-warn-ico" aria-hidden="true">!</span>
      <span>This is a test build. Wipes, balance changes, and unfinished systems are expected.</span>`;
    view.append(warn);

    const nav = el('nav', 'tk-nav');
    nav.append(
      navLink('ESCAPE', () => this.show('raid'), true),
      navLink('CHARACTER', () => this.show('character')),
      navLink('INVENTORY', () => this.flashLocked('Inventory'), false, true),
      navLink('TRADING', () => this.flashLocked('Trading'), false, true),
      navLink('QUIT', () => {
        if (window.confirm('Quit Escape from Hamar?')) this.callbacks.quit();
      }),
    );
    view.append(nav);

    const foot = el('div', 'tk-home-foot');
    foot.innerHTML = `<span>${escapeHtml(this.operatorName())}</span><span>${this.presence.playersOnline} online</span>`;
    view.append(foot);
    this.stage.append(view);
  }

  private renderRaidSelect(): void {
    const view = el('div', 'tk-flow tk-raid-flow');
    view.append(el('p', 'tk-flow-kicker', 'RAID'));
    view.append(el('h2', 'tk-flow-title', 'SELECT MODE'));
    view.append(el('p', 'tk-flow-lead', 'Choose how you enter the operation.'));

    const grid = el('div', 'tk-faction-grid');

    const pmc = el('button', 'tk-faction is-pmc', '');
    pmc.type = 'button';
    pmc.innerHTML = `
      <div class="tk-faction-art tk-faction-art--pmc" aria-hidden="true">
        <span class="tk-faction-art-mark">01</span>
      </div>
      <div class="tk-faction-body">
        <span class="tk-faction-tag">CONTRACT</span>
        <strong>PMC</strong>
        <span class="tk-faction-sub">Private military · full kit · lobby deploy</span>
        <span class="tk-faction-cta">CONTINUE</span>
      </div>`;
    pmc.addEventListener('click', () => this.show('deploy'));

    const scav = el('button', 'tk-faction is-scav is-locked', '');
    scav.type = 'button';
    scav.innerHTML = `
      <div class="tk-faction-art tk-faction-art--scav" aria-hidden="true">
        <span class="tk-faction-art-mark">02</span>
      </div>
      <div class="tk-faction-body">
        <span class="tk-faction-tag">SCAV</span>
        <strong>ДИКИЙ</strong>
        <span class="tk-faction-sub">Random kit · scavenger run · unavailable</span>
        <em class="tk-lock-badge">LOCKED</em>
      </div>`;
    scav.addEventListener('click', () => this.flashLocked('Дикий'));

    grid.append(pmc, scav);
    view.append(grid);

    const back = el('button', 'tk-back', 'BACK');
    back.type = 'button';
    back.addEventListener('click', () => this.show('home'));
    view.append(back);
    this.stage.append(view);
  }

  private renderDeploy(): void {
    const view = el('div', 'tk-flow tk-deploy-flow');
    view.append(el('p', 'tk-flow-kicker', 'PMC'));
    view.append(el('h2', 'tk-flow-title', 'SELECT MAP'));
    view.append(
      el('p', 'tk-flow-lead', 'Pick the AO, then create a lobby or connect with a host code.'),
    );

    const selected = getMap(this.selectedMapId);
    const panel = el('div', 'tk-map-panel');

    const board = el('div', 'tk-map-board');
    board.append(el('div', 'tk-map-grid'));
    board.append(el('div', 'tk-map-wash tk-map-wash--' + this.selectedMapId));
    const frame = el('div', 'tk-map-frame');
    frame.innerHTML = `
      <span class="tk-map-corner tk-map-corner--tl"></span>
      <span class="tk-map-corner tk-map-corner--tr"></span>
      <span class="tk-map-corner tk-map-corner--bl"></span>
      <span class="tk-map-corner tk-map-corner--br"></span>`;
    board.append(frame);

    const pins = el('div', 'tk-map-pins');
    const layouts: Array<{ id: string; x: number; y: number; sector: string }> = [
      { id: 'arena', x: 32, y: 46, sector: 'SECTOR A' },
      { id: 'desert', x: 68, y: 54, sector: 'SECTOR B' },
    ];
    for (const layout of layouts) {
      if (!RAID_MAPS.includes(layout.id)) continue;
      const map = getMap(layout.id);
      const pin = el(
        'button',
        this.selectedMapId === layout.id ? 'tk-map-pin is-on' : 'tk-map-pin',
        '',
      );
      pin.type = 'button';
      pin.style.left = `${layout.x}%`;
      pin.style.top = `${layout.y}%`;
      pin.innerHTML = `
        <span class="tk-pin-dot"></span>
        <span class="tk-pin-label">
          <b>${escapeHtml(map.name)}</b>
          <i>${layout.sector}</i>
        </span>`;
      pin.addEventListener('click', () => {
        this.selectedMapId = layout.id;
        this.render();
      });
      pins.append(pin);
    }
    board.append(pins);
    panel.append(board);

    const meta = el('div', 'tk-map-meta');
    meta.innerHTML = `
      <div class="tk-map-meta-top">
        <span class="tk-map-meta-id">${escapeHtml(selected.id.toUpperCase())}</span>
        <span class="tk-map-meta-status">AVAILABLE</span>
      </div>
      <h3 class="tk-map-meta-name">${escapeHtml(selected.name)}</h3>
      <p class="tk-map-meta-desc">${escapeHtml(selected.description)}</p>
      <div class="tk-map-meta-rows">
        <div><span>Players</span><b>${mapHasSides(selected) ? '1v1' : 'up to 16'}</b></div>
        <div><span>Type</span><b>${mapHasSides(selected) ? 'Sides' : 'Sandbox'}</b></div>
        <div><span>Faction</span><b>PMC</b></div>
      </div>`;
    panel.append(meta);
    view.append(panel);

    const actions = el('div', 'tk-deploy-actions');

    const hostCol = el('div', 'tk-deploy-col');
    hostCol.append(el('h3', 'tk-deploy-col-title', 'HOST'));
    hostCol.append(el('p', 'tk-deploy-hint', 'Solo offline, or create a lobby and share the code.'));

    const hostRow = el('div', 'tk-host-row');
    const offline = el('button', 'tk-secondary tk-offline-btn', 'PLAY OFFLINE');
    offline.type = 'button';
    offline.addEventListener('click', () => {
      const mapId = this.selectedMapId;
      this.callbacks.play({
        username: this.operatorName(),
        mapId,
        team: mapHasSides(getMap(mapId)) ? this.pendingTeam : undefined,
      });
    });

    const create = el(
      'button',
      'tk-deploy',
      this.createBusy ? 'CREATING…' : 'CREATE LOBBY',
    );
    create.type = 'button';
    create.disabled = this.createBusy;
    create.addEventListener('click', () => {
      if (this.createBusy) return;
      const mapId = this.selectedMapId;
      this.callbacks.createRoom({
        name: `${this.operatorName()}'s lobby`.slice(0, 48),
        mapId,
        maxPlayers: mapHasSides(getMap(mapId)) ? 2 : 16,
        password: '',
        team: mapHasSides(getMap(mapId)) ? this.pendingTeam : undefined,
      });
    });
    hostRow.append(offline, create);
    hostCol.append(hostRow);

    const connectCol = el('div', 'tk-deploy-col tk-connect-block');
    connectCol.append(el('h3', 'tk-deploy-col-title', 'CONNECT'));
    connectCol.append(el('p', 'tk-deploy-hint', 'Enter the host’s 6-character lobby code.'));

    const row = el('div', 'tk-connect-row');
    const input = el('input', 'tk-connect-input') as HTMLInputElement;
    input.type = 'text';
    input.maxLength = 7;
    input.placeholder = 'ABC 123';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = this.pendingJoinCode
      ? formatLobbyCodeInput(this.pendingJoinCode.replace(/\s/g, '').slice(0, 6))
      : '';
    input.addEventListener('input', () => {
      const raw = input.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
      this.pendingJoinCode = raw;
      input.value = formatLobbyCodeInput(raw);
    });

    const join = el('button', 'tk-deploy tk-connect-btn', 'CONNECT');
    join.type = 'button';
    const doJoin = () => {
      const code = this.pendingJoinCode.replace(/\s/g, '');
      if (code.length < 6) {
        input.focus();
        return;
      }
      this.callbacks.joinByCode({
        username: this.operatorName(),
        code,
        mapId: this.selectedMapId,
        team: mapHasSides(getMap(this.selectedMapId)) ? this.pendingTeam : undefined,
      });
    };
    join.addEventListener('click', doJoin);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        doJoin();
      }
    });
    row.append(input, join);
    connectCol.append(row);

    actions.append(hostCol, connectCol);
    view.append(actions);

    const back = el('button', 'tk-back', 'BACK');
    back.type = 'button';
    back.addEventListener('click', () => this.show('raid'));
    view.append(back);
    this.stage.append(view);

    if (this.pendingJoinCode.length === 6) {
      window.setTimeout(() => input.focus(), 0);
    }
  }

  private renderCharacter(): void {
    const view = el('div', 'tk-char');
    const tabs = el('div', 'tk-char-tabs');
    const tabDefs: Array<{ id: string; label: string; locked?: boolean }> = [
      { id: 'general', label: 'OVERVIEW' },
      { id: 'items', label: 'ITEMS', locked: true },
      { id: 'health', label: 'HEALTH', locked: true },
      { id: 'skills', label: 'SKILLS', locked: true },
      { id: 'map', label: 'MAP', locked: true },
    ];
    for (const t of tabDefs) {
      const btn = el('button', t.id === 'general' ? 'is-on' : '', t.label);
      btn.type = 'button';
      if (t.locked) {
        btn.classList.add('is-locked');
        btn.addEventListener('click', () => this.flashLocked(t.label));
      }
      tabs.append(btn);
    }
    view.append(tabs);

    const body = el('div', 'tk-char-body');
    const left = el('div', 'tk-char-left');
    const level = this.profile?.stats.level ?? 1;
    left.innerHTML = `
      <div class="tk-level">${String(level).padStart(2, '0')}</div>
      <div class="tk-faction-badge" title="PMC">PMC</div>
      <div class="tk-mannequin" aria-hidden="true">
        <div class="tk-man-head"></div>
        <div class="tk-man-torso"></div>
        <div class="tk-man-arm tk-man-arm--l"></div>
        <div class="tk-man-arm tk-man-arm--r"></div>
        <div class="tk-man-leg tk-man-leg--l"></div>
        <div class="tk-man-leg tk-man-leg--r"></div>
        <div class="tk-man-rifle"></div>
      </div>
      <div class="tk-char-name">
        <b>${escapeHtml(this.operatorName())}</b>
        <i>EXP ${formatNum(this.profile?.stats.xp ?? 0)}</i>
      </div>`;

    const right = el('div', 'tk-char-right');
    const s = this.profile?.stats;
    const kills = s?.kills ?? 0;
    const deaths = Math.max(1, s?.deaths ?? 0);
    const matches = s?.matchesPlayed ?? 0;
    const wins = s?.wins ?? 0;
    const kd = (kills / deaths).toFixed(2);
    const surv = matches > 0 ? Math.round((wins / matches) * 100) : 0;

    const icons = el('div', 'tk-stat-icons');
    for (const row of [
      { n: String(matches), l: 'RAIDS' },
      { n: String(wins), l: 'SURVIVED' },
      { n: String(s?.deaths ?? 0), l: 'KIA' },
      { n: String(kills), l: 'KILLS' },
      { n: kd, l: 'K/D' },
      { n: `${surv}%`, l: 'SURVIVAL' },
    ]) {
      const cell = el('div', 'tk-stat-icon');
      cell.innerHTML = `<b>${row.n}</b><span>${row.l}</span>`;
      icons.append(cell);
    }
    right.append(icons);

    const list = el('div', 'tk-stat-list');
    list.innerHTML = `
      <h4>OVERALL STATS</h4>
      <div class="tk-stat-row"><span>Callsign</span><b>${escapeHtml(this.operatorName())}</b></div>
      <div class="tk-stat-row"><span>Faction</span><b>PMC</b></div>
      <div class="tk-stat-row"><span>Level</span><b>${level}</b></div>
      <div class="tk-stat-row"><span>Matches</span><b>${matches}</b></div>
      <div class="tk-stat-row"><span>Headshots</span><b>${s?.headshots ?? 0}</b></div>
      <div class="tk-stat-row"><span>Status</span><b>${this.signedIn ? 'Account' : 'Guest'}</b></div>`;
    right.append(list);

    const account = el('button', 'tk-secondary', this.signedIn ? 'ACCOUNT' : 'SIGN IN');
    account.type = 'button';
    account.addEventListener('click', () => this.show('auth'));
    right.append(account);

    body.append(left, right);
    view.append(body);

    const back = el('button', 'tk-back', 'BACK');
    back.type = 'button';
    back.addEventListener('click', () => this.show('home'));
    view.append(back);
    this.stage.append(view);
  }

  private async renderAdmin(): Promise<void> {
    const card = el('div', 'mm-glass mm-wide tk-panel');
    card.append(el('p', 'mm-kicker', 'Admin'));
    card.append(el('h2', '', 'Admin'));
    if (!this.isAdmin) {
      card.append(el('p', 'lead', 'Admin access required.'));
      this.stage.append(card);
      return;
    }
    const notice = el('div', 'rl-error', this.adminNotice);
    const search = inputField('Search', this.adminQuery);
    (search.input as HTMLInputElement).addEventListener('input', () => {
      this.adminQuery = (search.input as HTMLInputElement).value.trim().toLowerCase();
      this.renderAdminTable(tableHost);
    });
    const refresh = el('button', 'rl-btn', 'Refresh');
    refresh.addEventListener('click', async () => {
      this.adminUsers = await this.callbacks.listUsers();
      this.renderAdminTable(tableHost);
    });
    const tableHost = el('div', 'mm-admin-table');
    card.append(notice, search.wrap, refresh, tableHost);
    const back = el('button', 'tk-back', 'BACK');
    back.type = 'button';
    back.addEventListener('click', () => this.show('home'));
    card.append(back);
    this.stage.append(card);
    try {
      this.adminUsers = await this.callbacks.listUsers();
    } catch {
      this.adminNotice = 'Failed to load users';
      notice.textContent = this.adminNotice;
    }
    this.renderAdminTable(tableHost);
  }

  private renderAdminTable(host: HTMLElement): void {
    clear(host);
    const table = el('table', 'mm-table');
    const head = el('thead');
    const hr = el('tr');
    for (const h of ['User', 'Email', 'Status', 'Actions']) hr.append(el('th', '', h));
    head.append(hr);
    table.append(head);
    const body = el('tbody');
    const rows = this.adminUsers.filter((u) => {
      if (!this.adminQuery) return true;
      return (
        u.username.toLowerCase().includes(this.adminQuery) ||
        (u.email ?? '').toLowerCase().includes(this.adminQuery)
      );
    });
    for (const user of rows) {
      const tr = el('tr');
      tr.append(el('td', '', user.username));
      tr.append(el('td', '', user.email ?? '—'));
      tr.append(el('td', '', user.banned ? 'Banned' : 'Active'));
      const td = el('td');
      if (user.banned) {
        const unban = el('button', 'rl-btn', 'Unban');
        unban.addEventListener('click', async () => {
          const err = await this.callbacks.unbanUser(user.id);
          this.adminNotice = err ?? 'Unbanned';
          this.adminUsers = await this.callbacks.listUsers();
          this.render();
        });
        td.append(unban);
      } else {
        const ban = el('button', 'rl-btn', 'Ban');
        ban.addEventListener('click', async () => {
          const reason = window.prompt('Ban reason', 'Cheating') ?? '';
          if (!reason.trim()) return;
          this.pendingBanId = user.id;
          const err = await this.callbacks.banUser(user.id, reason.trim());
          this.adminNotice = err ?? 'Banned';
          this.pendingBanId = null;
          this.adminUsers = await this.callbacks.listUsers();
          this.render();
        });
        if (this.pendingBanId === user.id) ban.disabled = true;
        td.append(ban);
      }
      tr.append(td);
      body.append(tr);
    }
    table.append(body);
    host.append(table);
  }

  private renderSettings(): void {
    const card = el('div', 'mm-glass mm-wide tk-panel');
    card.append(el('p', 'mm-kicker', 'System'));
    card.append(el('h2', '', 'Settings'));
    const tabs = el('div', 'mm-tabs');
    for (const [id, label] of [
      ['video', 'Video'],
      ['audio', 'Audio'],
      ['controls', 'Controls'],
      ['interface', 'Interface'],
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
        slider('Music', a.music, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ music: v })),
        slider('Effects', a.effects, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ effects: v })),
        slider('Voice', a.voice, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ voice: v })),
        slider('Interface', a.ui, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ ui: v })),
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
      const bc = g.bodycam;
      body.append(
        checkbox('Show FPS', g.showFps, (v) => this.callbacks.patchGraphics({ showFps: v })),
        checkbox('Show ping', g.showPing, (v) => this.callbacks.patchGraphics({ showPing: v })),
        checkbox('Debug overlay', g.debugOverlay, (v) => this.callbacks.patchGraphics({ debugOverlay: v })),
        el('p', 'lead', 'Bodycam'),
        checkbox('Chest bodycam', bc.enabled, (v) =>
          this.callbacks.patchGraphics({ bodycam: { enabled: v } }),
        ),
        checkbox('REC indicator', bc.showRec, (v) =>
          this.callbacks.patchGraphics({ bodycam: { showRec: v } }),
        ),
        checkbox('Battery / resolution', bc.showMeta, (v) =>
          this.callbacks.patchGraphics({ bodycam: { showMeta: v } }),
        ),
        checkbox('Auto exposure', bc.autoExposure, (v) =>
          this.callbacks.patchGraphics({ bodycam: { autoExposure: v } }),
        ),
        slider('Walk bob', bc.walkBob, 0, 1, 0.01, (v) =>
          this.callbacks.patchGraphics({ bodycam: { walkBob: v } }),
        ),
        slider('Run bob', bc.runBob, 0, 1, 0.01, (v) =>
          this.callbacks.patchGraphics({ bodycam: { runBob: v } }),
        ),
        slider('Shake', bc.shakeIntensity, 0, 1, 0.01, (v) =>
          this.callbacks.patchGraphics({ bodycam: { shakeIntensity: v } }),
        ),
        slider('FOV boost', bc.fovBoost, 0, 14, 1, (v) =>
          this.callbacks.patchGraphics({ bodycam: { fovBoost: v } }),
        ),
        slider('Vignette', bc.vignette, 0, 1, 0.01, (v) =>
          this.callbacks.patchGraphics({ bodycam: { vignette: v } }),
        ),
        slider('Lens curve', bc.barrelDistortion, 0, 1, 0.01, (v) =>
          this.callbacks.patchGraphics({ bodycam: { barrelDistortion: v } }),
        ),
        slider('Chromatic aberration', bc.chromaticAberration, 0, 1, 0.01, (v) =>
          this.callbacks.patchGraphics({ bodycam: { chromaticAberration: v } }),
        ),
        slider('Edge softness', bc.edgeBlur, 0, 1, 0.01, (v) =>
          this.callbacks.patchGraphics({ bodycam: { edgeBlur: v } }),
        ),
        slider('Sensor noise', bc.noise, 0, 1, 0.01, (v) =>
          this.callbacks.patchGraphics({ bodycam: { noise: v } }),
        ),
        slider('Sharpening', bc.sharpening, 0, 1, 0.01, (v) =>
          this.callbacks.patchGraphics({ bodycam: { sharpening: v } }),
        ),
        slider('Motion blur', bc.motionBlur, 0, 1, 0.01, (v) =>
          this.callbacks.patchGraphics({ bodycam: { motionBlur: v } }),
        ),
        slider('White balance', bc.whiteBalance, 0, 1, 0.01, (v) =>
          this.callbacks.patchGraphics({ bodycam: { whiteBalance: v } }),
        ),
        slider('Exposure speed', bc.exposureSpeed, 0.2, 3, 0.05, (v) =>
          this.callbacks.patchGraphics({ bodycam: { exposureSpeed: v } }),
        ),
      );
    }
    card.append(body);
    const back = el('button', 'tk-back', 'BACK');
    back.type = 'button';
    back.addEventListener('click', () => this.show('home'));
    card.append(back);
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
    const card = el('div', 'mm-glass tk-panel');
    card.append(el('h2', '', this.signedIn ? 'Account' : 'Sign in'));
    if (!this.supabaseReady) {
      card.append(el('p', 'lead', 'Supabase is not configured. Guest play still works.'));
      const back = el('button', 'tk-back', 'BACK');
      back.addEventListener('click', () => this.show('character'));
      card.append(back);
      this.stage.append(card);
      return;
    }
    if (this.signedIn) {
      card.append(el('p', 'lead', `Signed in as ${this.username}.`));
      const out = el('button', 'rl-btn', 'Sign out');
      out.addEventListener('click', () => this.callbacks.signOut());
      const back = el('button', 'tk-back', 'BACK');
      back.addEventListener('click', () => this.show('character'));
      card.append(out, back);
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
    login.append(email.wrap, password.wrap, signIn, err);

    const reg = el('div', 'rl-form mm-form');
    const username = inputField('Username', this.guestName);
    const email2 = inputField('Email', '');
    (email2.input as HTMLInputElement).type = 'email';
    const password2 = inputField('Password', '');
    (password2.input as HTMLInputElement).type = 'password';
    const signUp = el('button', 'rl-btn', 'Create account');
    signUp.addEventListener('click', async () => {
      err.textContent = '';
      const message = await this.callbacks.signUp(
        (email2.input as HTMLInputElement).value,
        (password2.input as HTMLInputElement).value,
        (username.input as HTMLInputElement).value,
      );
      if (message) err.textContent = message;
    });
    reg.append(username.wrap, email2.wrap, password2.wrap, signUp);

    const back = el('button', 'tk-back', 'BACK');
    back.addEventListener('click', () => this.show('character'));
    card.append(login, el('p', 'lead', 'Or create an account'), reg, back);
    this.stage.append(card);
  }
}

function navLink(label: string, onClick: () => void, hero = false, locked = false): HTMLButtonElement {
  const btn = el('button', hero ? 'tk-nav-link is-hero' : 'tk-nav-link', label) as HTMLButtonElement;
  btn.type = 'button';
  if (locked) btn.classList.add('is-locked');
  btn.addEventListener('click', onClick);
  return btn;
}

function gearSvg(): string {
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.05 7.05 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.83 14.7a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.68.22l2.39-.96c.5.39 1.04.7 1.63.94l.36 2.54c.05.24.25.42.49.42h3.8c.24 0 .44-.18.49-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.25.12.54.02.68-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>`;
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
  const input = el('select', 'rl-input rl-select') as HTMLSelectElement;
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

function formatLobbyCodeInput(code: string): string {
  const raw = code.replace(/\s/g, '').toUpperCase();
  return raw.length > 3 ? `${raw.slice(0, 3)} ${raw.slice(3)}` : raw;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
  );
}
