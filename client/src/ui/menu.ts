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
  | 'shop'
  | 'profile'
  | 'settings'
  | 'controls'
  | 'auth'
  | 'admin';

type SettingsTab = 'video' | 'audio' | 'controls' | 'interface';
type ShopCategory = 'all' | 'suit' | 'tracer' | 'charm' | 'title';

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

const NAV: Array<{ id: MenuScreen; label: string; hero?: boolean; quit?: boolean }> = [
  { id: 'play', label: 'Играть', hero: true },
  { id: 'servers', label: 'Серверы' },
  { id: 'profile', label: 'Профиль' },
  { id: 'inventory', label: 'Инвентарь' },
  { id: 'shop', label: 'Магазин' },
  { id: 'loadout', label: 'Арсенал' },
  { id: 'settings', label: 'Настройки' },
];

const INTRO_MS = 1850;
const CREDITS_KEY = 'ragelab.credits';

const RARITY_PRICE: Record<string, number> = {
  common: 500,
  rare: 1500,
  epic: 4000,
  legendary: 10000,
};

const LOADOUT_GROUPS: Array<{ title: string; ids: WeaponId[] }> = [
  { title: 'Primary', ids: ['rifle', 'assault', 'ak', 'smg', 'pdw', 'bizon', 'shotgun', 'autosg', 'saiga', 'dmr', 'sniper'] },
  { title: 'Secondary', ids: ['pistol', 'glock', 'usp', 'makarov', 'magnum'] },
];

export class MainMenu {
  readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly status: HTMLElement;
  private readonly statusBar: HTMLElement;
  private readonly playerCard: HTMLButtonElement;
  private readonly adminBtn: HTMLButtonElement;
  private readonly navButtons = new Map<MenuScreen, HTMLButtonElement>();
  private readonly navOrder: MenuScreen[] = [];
  private screen: MenuScreen = 'play';
  private settingsTab: SettingsTab = 'video';
  private shopCategory: ShopCategory = 'all';
  private guestName: string;
  private rebinding: string | null = null;
  private preview: WeaponPreview | null = null;
  private loadoutFocus: WeaponId = 'rifle';
  private presence: MenuPresence = {
    playersOnline: 0,
    serverLabel: 'Меню',
    pingMs: null,
  };
  private credits = 0;
  private shopNotice = '';
  private switchTimer = 0;

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
    this.credits = loadCredits();
    this.root = el('div', 'rl-screen mm-root is-intro');

    const fx = el('div', 'mm-fx');
    const particles = el('div', 'mm-particles');
    for (let i = 0; i < 18; i++) {
      const p = el('div', 'mm-particle');
      p.style.left = `${4 + Math.random() * 92}%`;
      p.style.animationDuration = `${9 + Math.random() * 14}s`;
      p.style.animationDelay = `${Math.random() * 8}s`;
      particles.append(p);
    }
    fx.append(el('div', 'mm-vignette'), el('div', 'mm-glow'), el('div', 'mm-grain'), el('div', 'mm-scan'), particles);
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
    this.statusBar = el('div', 'mm-status-bar');
    this.refreshStatusBar();

    const layout = el('div', 'mm-layout');
    const rail = el('div', 'mm-rail');
    const brand = el('div', 'mm-brand');
    brand.innerHTML = `
      <p class="mm-brand-tag">Online sandbox</p>
      <h1>RAGE<span>LAB</span></h1>
      <p class="mm-brand-sub">Browser multiplayer</p>`;

    const nav = el('nav', 'mm-nav');
    nav.setAttribute('aria-label', 'Главное меню');
    for (const item of NAV) {
      const btn = el('button', item.hero ? 'mm-nav-btn is-play' : 'mm-nav-btn', '');
      btn.type = 'button';
      if (item.hero) {
        btn.innerHTML = `<span class="mm-nav-ico"><span class="mm-play-ico" aria-hidden="true"></span></span><span>${item.label}</span>`;
      } else {
        btn.innerHTML = `<span>${item.label}</span>`;
      }
      btn.addEventListener('click', () => this.show(item.id));
      nav.append(btn);
      this.navButtons.set(item.id, btn);
      this.navOrder.push(item.id);
    }

    this.adminBtn = el('button', 'mm-nav-btn', 'Админ');
    this.adminBtn.type = 'button';
    this.adminBtn.hidden = true;
    this.adminBtn.addEventListener('click', () => this.show('admin'));
    nav.append(this.adminBtn);
    this.navButtons.set('admin', this.adminBtn);

    const quit = el('button', 'mm-nav-btn is-quit', 'Выйти');
    quit.type = 'button';
    quit.addEventListener('click', () => {
      if (window.confirm('Покинуть RAGELAB?')) this.callbacks.quit();
    });
    nav.append(quit);
    rail.append(brand, nav);

    const main = el('div', 'mm-main');
    this.playerCard = el('button', 'mm-player-card');
    this.playerCard.type = 'button';
    this.playerCard.title = 'Профиль';
    this.playerCard.addEventListener('click', () => this.show(this.signedIn ? 'profile' : 'auth'));
    this.stage = el('div', 'mm-stage');
    main.append(this.playerCard, this.stage);
    layout.append(rail, main);

    const foot = el('div', 'mm-foot');
    this.status = el('div', 'mm-status');
    foot.append(this.status, el('div', 'mm-ver', 'v0.1.0 · 1920×1080'));

    shell.append(this.statusBar, layout, foot);
    this.root.append(shell);
    host.append(this.root);
    this.refreshChip();
    this.show('play');
    this.bindKeyboard();
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

  setPresence(presence: Partial<MenuPresence>): void {
    this.presence = { ...this.presence, ...presence };
    this.refreshStatusBar();
  }

  setAuth(signedIn: boolean, username: string, supabaseReady: boolean): void {
    this.signedIn = signedIn;
    this.username = username;
    this.supabaseReady = supabaseReady;
    this.refreshChip();
    this.refreshStatusBar();
    this.status.innerHTML = signedIn
      ? `в сети как <b>${escapeHtml(username)}</b>`
      : supabaseReady
        ? 'гость · войдите, чтобы сохранить прогресс'
        : 'гость · supabase не настроен';
    if (!signedIn) this.setAdmin(false);
    if (
      this.screen === 'auth' ||
      this.screen === 'profile' ||
      this.screen === 'play' ||
      this.screen === 'inventory' ||
      this.screen === 'shop' ||
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

  setProfile(profile: FullProfile | null, weaponStats: WeaponStatRow[], leaderboard: LeaderboardEntry[]): void {
    this.profile = profile;
    this.weaponStats = weaponStats;
    this.leaderboard = leaderboard;
    this.refreshChip();
    this.refreshStatusBar();
    if (this.screen === 'profile' || this.screen === 'inventory' || this.screen === 'shop' || this.screen === 'play') {
      this.render();
    }
  }

  show(screen: MenuScreen): void {
    if (screen === 'controls') {
      this.settingsTab = 'controls';
      screen = 'settings';
    }
    if (screen === this.screen && this.stage.childNodes.length > 0) {
      this.render();
      return;
    }
    this.screen = screen;
    for (const [id, btn] of this.navButtons) btn.classList.toggle('is-active', id === screen);
    if (screen !== 'loadout') this.disposePreview();
    this.stage.className = `mm-stage is-${screen} is-switching`;
    window.clearTimeout(this.switchTimer);
    this.switchTimer = window.setTimeout(() => {
      this.stage.className = `mm-stage is-${screen}`;
      this.render();
    }, 120);
  }

  private bindKeyboard(): void {
    this.root.addEventListener('keydown', (event) => {
      if (this.rebinding) return;
      if (isTypingTarget(event.target)) return;
      const visible = [...this.navOrder, ...(this.isAdmin ? (['admin'] as MenuScreen[]) : [])].filter((id) => {
        const btn = this.navButtons.get(id);
        return btn && !btn.hidden;
      });
      const idx = visible.indexOf(this.screen);
      if (event.code === 'ArrowDown') {
        const next = visible[(idx + 1) % visible.length];
        if (next) this.show(next);
        event.preventDefault();
      } else if (event.code === 'ArrowUp') {
        const prev = visible[(idx - 1 + visible.length) % visible.length];
        if (prev) this.show(prev);
        event.preventDefault();
      } else if (event.code === 'Escape' && this.screen !== 'play') {
        this.show('play');
        event.preventDefault();
      }
    });
  }

  private refreshStatusBar(): void {
    const ping =
      this.presence.pingMs == null
        ? '—'
        : `${Math.round(this.presence.pingMs)} ms`;
    const pingClass = this.presence.pingMs == null ? '' : this.presence.pingMs < 80 ? 'is-live' : 'is-warn';
    this.statusBar.innerHTML = `
      <div class="mm-status-cluster">
        <div class="mm-stat-pill"><span>Онлайн</span><b class="is-live"><i class="mm-live-dot"></i>${this.presence.playersOnline}</b></div>
        <div class="mm-stat-pill"><span>Сервер</span><b>${escapeHtml(this.presence.serverLabel)}</b></div>
        <div class="mm-stat-pill"><span>Пинг</span><b class="${pingClass}">${ping}</b></div>
      </div>
      <div class="mm-status-cluster">
        <div class="mm-stat-pill"><span>Сессия</span><b>${this.signedIn ? 'Аккаунт' : 'Гость'}</b></div>
      </div>`;
  }

  private refreshChip(): void {
    const level = this.profile?.stats.level ?? 1;
    const name = this.signedIn ? this.username : this.guestName;
    const initial = (name[0] ?? 'R').toUpperCase();
    const avatar = this.profile?.profile.avatarUrl;
    this.playerCard.innerHTML = `
      <div class="mm-player-left">
        <span class="mm-avatar">${avatar ? `<img src="${escapeHtml(avatar)}" alt="">` : escapeHtml(initial)}</span>
        <span class="mm-player-meta"><b>${escapeHtml(name)}</b><i>LVL ${level}</i></span>
      </div>
      <span class="mm-currency"><em>CR</em>${formatCredits(this.displayCredits())}</span>`;
  }

  private displayCredits(): number {
    const stats = this.profile?.stats;
    const earned = stats ? stats.level * 250 + stats.kills * 15 + stats.wins * 100 : 750;
    return Math.max(0, earned + this.credits);
  }

  private spendCredits(amount: number): boolean {
    if (this.displayCredits() < amount) return false;
    this.credits -= amount;
    saveCredits(this.credits);
    this.refreshChip();
    return true;
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
      case 'shop':
        this.renderShop();
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
    const card = el('div', 'mm-glass mm-hero');
    card.append(el('p', 'mm-kicker', 'Deploy'));
    card.append(el('h2', '', 'В бой'));
    card.append(
      el(
        'p',
        'lead',
        'Онлайн sandbox: стройте, сражайтесь и экспериментируйте. Быстрый старт в локальную сессию или переход к браузеру серверов.',
      ),
    );

    const form = el('div', 'rl-form mm-form');
    const name = inputField('Позывной', this.signedIn ? this.username : this.guestName, !this.signedIn);
    const map = selectField(
      'Карта',
      MAP_IDS.map((id) => ({ value: id, label: getMap(id).name })),
      DEFAULT_MAP_ID,
    );
    const side = selectField(
      'Сторона',
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

    const play = el('button', 'mm-hero-cta', '');
    play.type = 'button';
    play.innerHTML = '<span class="mm-play-ico" aria-hidden="true"></span><span>Играть</span>';
    play.addEventListener('click', () => {
      play.classList.add('is-pressed');
      const username = this.commitName(name);
      this.callbacks.play({
        username,
        mapId: (map.input as HTMLSelectElement).value,
        team: this.teamFor(map),
      });
    });

    form.append(name.wrap, map.wrap, side.wrap);
    card.append(form, play);

    const quick = el('div', 'mm-quick-grid');
    const qServers = el('button', 'mm-quick-card', '');
    qServers.innerHTML = '<strong>Серверы</strong><span>Лобби и коды приглашений</span>';
    qServers.addEventListener('click', () => this.show('servers'));
    const qShop = el('button', 'mm-quick-card', '');
    qShop.innerHTML = '<strong>Магазин</strong><span>Косметика и редкость</span>';
    qShop.addEventListener('click', () => this.show('shop'));
    const qSettings = el('button', 'mm-quick-card', '');
    qSettings.innerHTML = '<strong>Настройки</strong><span>Графика, звук, управление</span>';
    qSettings.addEventListener('click', () => this.show('settings'));
    quick.append(qServers, qShop, qSettings);
    card.append(quick);
    this.stage.append(card);
  }

  private renderServers(): void {
    const card = el('div', 'mm-glass mm-wide');
    card.append(el('p', 'mm-kicker', 'Multiplayer'));
    card.append(el('h2', '', 'Серверы'));
    card.append(el('p', 'lead', 'Создайте лобби или подключитесь по коду. В списке — живые комнаты с картой, режимом и пингом.'));

    const grid = el('div', 'mm-mp-grid');
    const createPane = el('div', 'mm-mp-pane');
    createPane.append(el('h3', '', 'Создать лобби'));
    const map = selectField(
      'Карта',
      MAP_IDS.map((id) => ({ value: id, label: getMap(id).name })),
      DEFAULT_MAP_ID,
    );
    const create = el('button', 'rl-btn primary rl-create-lobby', '');
    create.innerHTML = '<span class="rl-create-label">Создать</span>';
    create.disabled = !this.isAdmin || this.createBusy;
    if (!this.isAdmin) create.classList.add('is-locked');
    if (this.createBusy) {
      create.classList.add('is-loading');
      create.innerHTML = '<span class="rl-create-spinner" aria-hidden="true"></span><span class="rl-create-label">Создание…</span>';
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
      createPane.append(el('p', 'mm-lock-note', 'Создавать лобби могут только администраторы'));
    }

    const joinPane = el('div', 'mm-mp-pane');
    joinPane.append(el('h3', '', 'Войти по коду'));
    const err = el('div', 'rl-error');
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
    const join = el('button', 'rl-btn primary', 'Подключиться');
    const go = (): void => {
      const value = normalizeLobbyCode(codeInput.value || this.pendingJoinCode);
      if (!isLobbyCode(value)) {
        err.textContent = 'Введите 6-символьный код лобби.';
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

    const listHost = el('div', 'mm-server-list');
    listHost.textContent = 'Загрузка серверов…';
    card.append(listHost);
    this.stage.append(card);
    void this.fillRooms(listHost);
  }

  private async fillRooms(listHost: HTMLElement): Promise<void> {
    try {
      const rooms = await this.callbacks.refreshServers();
      if (this.screen !== 'servers') return;
      const online = rooms.reduce((sum, room) => sum + room.playerCount, 0);
      this.setPresence({
        playersOnline: online,
        serverLabel: rooms.length > 0 ? `${rooms.length} лобби` : 'Нет лобби',
        pingMs: rooms[0] ? Math.max(12, Math.round(rooms[0].tickMs * 4)) : null,
      });
      if (rooms.length === 0) {
        listHost.textContent = 'Нет активных лобби. Администратор может создать комнату выше.';
        return;
      }
      clear(listHost);
      const head = el('div', 'mm-server-head');
      head.innerHTML = '<span>Сервер</span><span>Карта</span><span>Режим</span><span>Игроки</span><span>Пинг</span><span></span>';
      listHost.append(head);
      for (const room of rooms) {
        const row = el('div', 'mm-server-row');
        const ping = Math.max(12, Math.round(room.tickMs * 4 + room.playerCount * 2));
        row.innerHTML = `
          <b>${escapeHtml(room.name)}</b>
          <span>${escapeHtml(mapLabel(room.mapId))}</span>
          <span>${escapeHtml(room.mode)}</span>
          <span>${room.playerCount}/${room.maxPlayers}</span>
          <span>${ping} ms</span>`;
        const btn = el('button', 'rl-btn', room.hasPassword ? 'Войти…' : 'Войти');
        btn.addEventListener('click', () => {
          const password = room.hasPassword ? window.prompt('Пароль комнаты') ?? '' : undefined;
          this.callbacks.play({
            username: this.operatorName(),
            roomId: room.id,
            roomCode: room.joinCode,
            password: password || undefined,
            wsUrl: room.wsUrl,
          });
        });
        row.append(btn);
        listHost.append(row);
      }
    } catch (err) {
      listHost.textContent = `Сервер недоступен: ${String(err)}`;
      this.setPresence({ playersOnline: 0, serverLabel: 'Оффлайн', pingMs: null });
    }
  }

  private renderLoadout(): void {
    const card = el('div', 'mm-glass mm-wide mm-loadout');
    const def = getWeapon(this.loadoutFocus);
    card.append(el('p', 'mm-kicker', 'Armory'));
    card.append(el('h2', '', 'Арсенал'));
    card.append(el('p', 'lead', 'Превью оружия. В матче используется стандартный loadout; sandbox-пушки подбираются в мире.'));

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
    melee.innerHTML = '<b>Katana</b><i>Sandbox pickup</i>';
    list.append(melee);
    list.append(el('h3', '', 'Equipment'));
    const tool = el('div', 'mm-gun is-static');
    tool.innerHTML = '<b>Tool Gun</b><i>Слот 6 · spawn / physics</i>';
    list.append(tool);

    const show = el('div', 'mm-loadout-show');
    show.append(el('div', 'mm-preview-title', def.name));
    const frame = el('div', 'mm-preview-frame');
    show.append(frame);
    show.append(
      el('p', 'mm-preview-meta', `${def.damage} dmg · ${def.rpm} rpm · ${def.magazineSize}/${def.reserveAmmo} ammo`),
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
    card.append(el('h2', '', 'Инвентарь'));

    if (!this.signedIn || !this.profile) {
      card.append(el('p', 'lead', 'Войдите, чтобы загрузить косметику и постоянный инвентарь.'));
      const go = el('button', 'rl-btn primary', 'Войти');
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
      card.append(el('p', 'lead', 'Каталог косметики на сервере пока пуст.'));
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
        <em>${have ? `×${counts.get(item.id) ?? 1}` : 'Закрыто'}</em>`;
      if (have) {
        const btn = el('button', 'rl-btn', equipped.has(item.id) ? 'Надето' : 'Надеть');
        btn.disabled = equipped.has(item.id);
        btn.addEventListener('click', () => this.callbacks.equipCosmetic(item.id));
        tile.append(btn);
      }
      grid.append(tile);
    }
    card.append(grid);
    this.stage.append(card);
  }

  private renderShop(): void {
    const card = el('div', 'mm-glass mm-wide');
    card.append(el('p', 'mm-kicker', 'Store'));
    card.append(el('h2', '', 'Магазин'));
    card.append(el('p', 'lead', 'Косметика по категориям. Цена зависит от редкости. Покупка списывает локальные кредиты (CR).'));

    const tabs = el('div', 'mm-cat-tabs');
    for (const [id, label] of [
      ['all', 'Все'],
      ['suit', 'Костюмы'],
      ['tracer', 'Трассеры'],
      ['charm', 'Брелоки'],
      ['title', 'Титулы'],
    ] as const) {
      const btn = el('button', this.shopCategory === id ? 'is-on' : '', label);
      btn.addEventListener('click', () => {
        this.shopCategory = id;
        this.render();
      });
      tabs.append(btn);
    }
    card.append(tabs);
    if (this.shopNotice) card.append(el('div', 'rl-error', this.shopNotice));

    const items = this.profile?.cosmetics ?? DEMO_SHOP_ITEMS;
    const owned = new Set(this.profile?.inventory.map((i) => i.itemId) ?? []);
    const grid = el('div', 'mm-shop-grid');
    let shown = 0;
    for (const item of items) {
      if (this.shopCategory !== 'all' && item.itemType !== this.shopCategory) continue;
      shown += 1;
      const price = RARITY_PRICE[item.rarity] ?? 1000;
      const have = owned.has(item.id);
      const tile = el('article', `mm-shop-card rarity-${item.rarity}${have ? ' is-owned' : ''}`);
      tile.innerHTML = `
        <span class="mm-shop-ico">${item.itemType[0]?.toUpperCase() ?? '?'}</span>
        <b>${escapeHtml(item.name)}</b>
        <i>${escapeHtml(item.itemType)} · ${escapeHtml(item.rarity)}</i>
        <em>${have ? 'В инвентаре' : `${formatCredits(price)} CR`}</em>`;
      const btn = el('button', 'rl-btn', have ? 'Надеть' : 'Купить');
      if (have) {
        btn.addEventListener('click', () => {
          if (this.signedIn) this.callbacks.equipCosmetic(item.id);
          else {
            this.shopNotice = 'Войдите, чтобы экипировать предмет.';
            this.render();
          }
        });
      } else {
        btn.addEventListener('click', () => {
          if (!this.spendCredits(price)) {
            this.shopNotice = 'Недостаточно кредитов.';
            this.render();
            return;
          }
          this.shopNotice = `Куплено: ${item.name}. Предметы аккаунта разблокируются прогрессом на сервере.`;
          this.render();
        });
      }
      tile.append(btn);
      grid.append(tile);
    }
    if (shown === 0) {
      card.append(el('p', 'lead', 'В этой категории пока нет предметов. Войдите, чтобы загрузить каталог.'));
    } else {
      card.append(grid);
    }
    this.stage.append(card);
  }

  private renderProfile(): void {
    const card = el('div', 'mm-glass mm-wide');
    card.append(el('p', 'mm-kicker', 'Operator'));
    card.append(el('h2', '', 'Профиль'));
    if (!this.signedIn || !this.profile) {
      card.append(el('p', 'lead', 'Войдите, чтобы видеть аватар, уровень, статистику и достижения.'));
      const go = el('button', 'rl-btn primary', 'Войти');
      go.addEventListener('click', () => this.show('auth'));
      card.append(go);
      this.stage.append(card);
      return;
    }

    const p = this.profile;
    const s = p.stats;
    const hero = el('div', 'mm-profile-hero');
    const initial = (p.profile.username[0] ?? 'R').toUpperCase();
    const avatar = el('div', 'mm-avatar lg');
    if (p.profile.avatarUrl) {
      avatar.innerHTML = `<img src="${escapeHtml(p.profile.avatarUrl)}" alt="">`;
    } else {
      avatar.textContent = initial;
    }
    const meta = el('div');
    meta.innerHTML = `<h3 style="margin:0 0 6px;font-family:var(--display);letter-spacing:.12em;text-transform:uppercase">${escapeHtml(p.profile.username)}</h3>
      <p class="lead" style="margin:0">Уровень ${s.level} · ${formatCredits(this.displayCredits())} CR · ${formatPlaytime(s.playtimeSeconds)}</p>`;
    hero.append(avatar, meta);
    card.append(hero);

    const form = el('div', 'rl-form mm-form');
    const name = inputField('Никнейм', p.profile.username);
    const avatarUrl = inputField('URL аватара', p.profile.avatarUrl ?? '');
    const err = el('div', 'rl-error');
    const save = el('button', 'rl-btn primary', 'Сохранить');
    save.addEventListener('click', async () => {
      err.textContent = '';
      const message = await this.callbacks.saveProfile(
        (name.input as HTMLInputElement).value.trim(),
        (avatarUrl.input as HTMLInputElement).value.trim(),
      );
      err.textContent = message ?? 'Сохранено.';
      this.refreshChip();
    });
    const account = el('button', 'rl-btn', 'Аккаунт');
    account.addEventListener('click', () => this.show('auth'));
    form.append(name.wrap, avatarUrl.wrap, err, save, account);
    card.append(form);

    const kd = s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : String(s.kills);
    const stats = el('div', 'stat-grid');
    for (const [label, value] of [
      ['Уровень', String(s.level)],
      ['XP', String(s.xp)],
      ['Победы', String(s.wins)],
      ['Убийства', String(s.kills)],
      ['Смерти', String(s.deaths)],
      ['K/D', kd],
      ['Хедшоты', String(s.headshots)],
      ['Матчи', String(s.matchesPlayed)],
    ] as const) {
      const node = el('div', 'stat');
      node.append(el('b', '', value), el('span', '', label));
      stats.append(node);
    }
    card.append(stats);

    card.append(el('p', 'mm-kicker', 'Achievements'));
    const achieve = el('div', 'mm-achieve-grid');
    for (const a of buildAchievements(s)) {
      const node = el('div', `mm-achieve${a.done ? '' : ' is-locked'}`);
      node.innerHTML = `<b>${escapeHtml(a.title)}</b><span>${escapeHtml(a.desc)}</span>`;
      achieve.append(node);
    }
    card.append(achieve);

    if (this.weaponStats.length > 0) {
      const table = document.createElement('table');
      table.className = 'rl-table';
      table.innerHTML = `<thead><tr><th>Оружие</th><th>K</th><th>Fired</th><th>Hit</th><th>HS</th></tr></thead><tbody>${this.weaponStats
        .map(
          (w) =>
            `<tr><td>${escapeHtml(w.weaponId)}</td><td>${w.kills}</td><td>${w.shotsFired}</td><td>${w.shotsHit}</td><td>${w.headshots}</td></tr>`,
        )
        .join('')}</tbody>`;
      card.append(table);
    }

    if (this.leaderboard.length > 0) {
      card.append(el('p', 'lead', 'Таблица лидеров'));
      const table = document.createElement('table');
      table.className = 'rl-table';
      table.innerHTML = `<thead><tr><th>#</th><th>Игрок</th><th>K</th><th>D</th><th>Lv</th></tr></thead><tbody>${this.leaderboard
        .map(
          (row, i) =>
            `<tr><td>${i + 1}</td><td>${escapeHtml(row.username)}</td><td>${row.kills}</td><td>${row.deaths}</td><td>${row.level}</td></tr>`,
        )
        .join('')}</tbody>`;
      card.append(table);
    }
    this.stage.append(card);
  }

  private async renderAdmin(): Promise<void> {
    const card = el('div', 'mm-glass mm-wide');
    card.append(el('h2', '', 'Админ'));
    card.append(el('p', 'lead', 'Аккаунты, баны и модерация.'));
    this.stage.append(card);
    if (!this.isAdmin) {
      card.append(el('p', 'rl-error', 'Нужен доступ администратора.'));
      return;
    }

    const tools = el('div', 'rl-admin-tools');
    const search = inputField('Поиск', this.adminQuery);
    const searchInput = search.input as HTMLInputElement;
    searchInput.placeholder = 'username or email';
    searchInput.addEventListener('input', () => {
      this.adminQuery = searchInput.value;
      this.fillAdminTable(tableHost);
    });
    const refresh = el('button', 'rl-btn', 'Обновить');
    refresh.addEventListener('click', () => void this.reloadAdminUsers());
    tools.append(search.wrap, refresh);
    card.append(tools);
    if (this.adminNotice) card.append(el('div', 'rl-error', this.adminNotice));
    const tableHost = el('div', 'rl-admin-table');
    tableHost.textContent = 'Загрузка…';
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
      host.textContent = this.adminUsers.length === 0 ? 'Игроков пока нет.' : 'Никого не найдено.';
      return;
    }

    const table = document.createElement('table');
    table.className = 'rl-table';
    table.innerHTML =
      '<thead><tr><th>Игрок</th><th>Email</th><th>Joined</th><th>Lv</th><th>K/D</th><th>Status</th><th></th></tr></thead>';
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
        reason.placeholder = 'Причина бана';
        const confirm = el('button', 'rl-btn danger', 'Подтвердить');
        confirm.addEventListener('click', async () => {
          this.adminNotice = (await this.callbacks.banUser(user.id, reason.value.trim())) ?? '';
          this.pendingBanId = null;
          await this.reloadAdminUsers();
        });
        const cancel = el('button', 'rl-btn', 'Отмена');
        cancel.addEventListener('click', () => {
          this.pendingBanId = null;
          this.render();
        });
        wrap.append(reason, confirm, cancel);
        td.append(wrap);
      } else {
        const ban = el('button', 'rl-btn danger', 'Ban');
        ban.addEventListener('click', () => {
          this.pendingBanId = user.id;
          this.render();
        });
        td.append(ban);
      }
      tr.append(td);
      body.append(tr);
    }
    table.append(body);
    host.append(table);
  }

  private renderSettings(): void {
    const card = el('div', 'mm-glass mm-wide');
    card.append(el('p', 'mm-kicker', 'System'));
    card.append(el('h2', '', 'Настройки'));
    const tabs = el('div', 'mm-tabs');
    for (const [id, label] of [
      ['video', 'Графика'],
      ['audio', 'Звук'],
      ['controls', 'Управление'],
      ['interface', 'Интерфейс'],
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
      const quality = selectField('Качество', ['low', 'medium', 'high', 'ultra'], g.quality);
      quality.input.addEventListener('change', () => {
        this.callbacks.applyQuality((quality.input as HTMLSelectElement).value as QualityLevelId);
      });
      body.append(
        quality.wrap,
        slider('Поле зрения', g.fov, 70, 110, 1, (v) => this.callbacks.patchGraphics({ fov: v })),
        slider('Масштаб разрешения', g.resolutionScale, 0.5, 1.5, 0.05, (v) =>
          this.callbacks.patchGraphics({ resolutionScale: v }),
        ),
        slider('Дальность отрисовки', g.renderDistance, 80, 400, 10, (v) =>
          this.callbacks.patchGraphics({ renderDistance: v }),
        ),
        checkbox('Тени', g.shadows, (v) => this.callbacks.patchGraphics({ shadows: v })),
        checkbox('Сглаживание', g.antialias, (v) => this.callbacks.patchGraphics({ antialias: v })),
      );
      const full = el('button', 'rl-btn', document.fullscreenElement ? 'Выйти из fullscreen' : 'Fullscreen');
      full.addEventListener('click', () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
        window.setTimeout(() => this.render(), 200);
      });
      body.append(full);
    } else if (this.settingsTab === 'audio') {
      body.append(
        slider('Общая громкость', a.master, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ master: v })),
        slider('Музыка', a.music, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ music: v })),
        slider('Эффекты', a.effects, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ effects: v })),
        slider('Голос', a.voice, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ voice: v })),
        slider('Интерфейс', a.ui, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ ui: v })),
        slider('Амбиент', a.ambience, 0, 1, 0.01, (v) => this.callbacks.patchAudio({ ambience: v })),
      );
    } else if (this.settingsTab === 'controls') {
      body.append(
        slider('Чувствительность мыши', c.sensitivity, 0.4, 6, 0.05, (v) =>
          this.callbacks.patchControls({ sensitivity: v }),
        ),
        slider('Чувствительность прицела', c.aimSensitivityMultiplier, 0.2, 1.5, 0.05, (v) =>
          this.callbacks.patchControls({ aimSensitivityMultiplier: v }),
        ),
        checkbox('Инверсия Y', c.invertY, (v) => this.callbacks.patchControls({ invertY: v })),
        checkbox('Переключение спринта', c.toggleSprint, (v) => this.callbacks.patchControls({ toggleSprint: v })),
        checkbox('Переключение приседа', c.toggleCrouch, (v) => this.callbacks.patchControls({ toggleCrouch: v })),
        checkbox('Переключение прицела', c.toggleAim, (v) => this.callbacks.patchControls({ toggleAim: v })),
        el('p', 'lead', 'Привязки — нажмите кнопку, затем новую клавишу'),
      );
      for (const [action, label] of Object.entries(ACTION_LABELS)) {
        const row = el('div', 'bind-row');
        row.append(el('span', '', label));
        const btn = el('button', 'rl-btn bind-key', formatCode(c.bindings[action] ?? ''));
        if (this.rebinding === action) btn.textContent = 'Нажмите…';
        btn.addEventListener('click', () => this.beginRebind(action, btn));
        row.append(btn);
        body.append(row);
      }
    } else {
      body.append(
        checkbox('Показывать FPS', g.showFps, (v) => this.callbacks.patchGraphics({ showFps: v })),
        checkbox('Показывать пинг', g.showPing, (v) => this.callbacks.patchGraphics({ showPing: v })),
        checkbox('Debug overlay', g.debugOverlay, (v) => this.callbacks.patchGraphics({ debugOverlay: v })),
        el('p', 'lead', 'Прицел, тряска камеры и sway оружия управляются отдачей в матче.'),
      );
    }
    card.append(body);
    this.stage.append(card);
  }

  private beginRebind(action: string, btn: HTMLButtonElement): void {
    this.rebinding = action;
    btn.textContent = 'Нажмите…';
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
    card.append(el('h2', '', this.signedIn ? 'Аккаунт' : 'Вход'));
    if (!this.supabaseReady) {
      card.append(el('p', 'lead', 'Ключи Supabase не заданы в .env. Гостевая игра всё ещё доступна.'));
      this.stage.append(card);
      return;
    }
    if (this.signedIn) {
      card.append(el('p', 'lead', `Вы вошли как ${this.username}.`));
      const out = el('button', 'rl-btn', 'Выйти из аккаунта');
      out.addEventListener('click', () => this.callbacks.signOut());
      card.append(out);
      this.stage.append(card);
      return;
    }

    const err = el('div', 'rl-error');
    const login = el('div', 'rl-form mm-form');
    const email = inputField('Email', '');
    (email.input as HTMLInputElement).type = 'email';
    const password = inputField('Пароль', '');
    (password.input as HTMLInputElement).type = 'password';
    const signIn = el('button', 'rl-btn primary', 'Войти');
    signIn.addEventListener('click', async () => {
      err.textContent = '';
      const message = await this.callbacks.signIn(
        (email.input as HTMLInputElement).value,
        (password.input as HTMLInputElement).value,
      );
      if (message) err.textContent = message;
    });
    login.append(email.wrap, password.wrap, signIn);
    card.append(login, el('p', 'lead', 'Новый игрок?'), err);

    const signup = el('div', 'rl-form mm-form');
    const user = inputField('Никнейм', '');
    const email2 = inputField('Email', '');
    (email2.input as HTMLInputElement).type = 'email';
    const pass2 = inputField('Пароль', '');
    (pass2.input as HTMLInputElement).type = 'password';
    const create = el('button', 'rl-btn', 'Создать аккаунт');
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

const DEMO_SHOP_ITEMS = [
  { id: 'demo_suit', name: 'Standard Issue', itemType: 'suit', rarity: 'common' as const },
  { id: 'demo_toxic', name: 'Toxic', itemType: 'suit', rarity: 'rare' as const },
  { id: 'demo_tracer', name: 'Amber Tracer', itemType: 'tracer', rarity: 'common' as const },
  { id: 'demo_charm', name: 'Lucky Bolt', itemType: 'charm', rarity: 'common' as const },
  { id: 'demo_title', name: 'Rookie', itemType: 'title', rarity: 'common' as const },
  { id: 'demo_void', name: 'Void Operator', itemType: 'suit', rarity: 'legendary' as const },
];

function mapLabel(mapId: string): string {
  try {
    return getMap(mapId).name;
  } catch {
    return mapId;
  }
}

function buildAchievements(s: { kills: number; wins: number; headshots: number; level: number; matchesPlayed: number }) {
  return [
    { title: 'Первая кровь', desc: '1 убийство', done: s.kills >= 1 },
    { title: 'Ветеран двора', desc: '10 матчей', done: s.matchesPlayed >= 10 },
    { title: 'Снайпер', desc: '25 хедшотов', done: s.headshots >= 25 },
    { title: 'Чемпион', desc: '5 побед', done: s.wins >= 5 },
    { title: 'Оператор', desc: 'Уровень 10', done: s.level >= 10 },
    { title: 'Легенда', desc: 'Уровень 25', done: s.level >= 25 },
  ];
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

function formatCredits(value: number): string {
  return Math.round(value).toLocaleString('ru-RU');
}

function formatPlaytime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}ч ${m}м`;
}

function loadCredits(): number {
  try {
    const raw = localStorage.getItem(CREDITS_KEY);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

function saveCredits(value: number): void {
  try {
    localStorage.setItem(CREDITS_KEY, String(value));
  } catch {
    /* ignore */
  }
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
