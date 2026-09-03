import { el } from './dom';
import { TOOL_GUN_UI_SLOT } from '../player/inputController';

export interface HudScoreRow {
  id: number;
  name: string;
  kills: number;
  deaths: number;
  ping: number;
  self: boolean;
}

export interface HudSlotInfo {
  id: string;
  name: string;
}

export type ToolGunKind = 'NPC' | 'Prop' | 'Tool' | 'Weapon';

export class Hud {
  readonly root: HTMLElement;

  private readonly healthFill: HTMLElement;
  private readonly healthText: HTMLElement;
  private readonly ammoFill: HTMLElement;
  private readonly ammoText: HTMLElement;
  private readonly ammoPanel: HTMLElement;
  private readonly ammoBig: HTMLElement;
  private readonly ammoName: HTMLElement;
  private readonly killfeed: HTMLElement;
  private readonly chatLog: HTMLElement;
  private readonly chatBox: HTMLElement;
  private readonly chatInput: HTMLInputElement;
  private readonly net: HTMLElement;
  private readonly interact: HTMLElement;
  private readonly hitmarker: HTMLElement;
  private readonly hurt: HTMLElement;
  private readonly dirHit: HTMLElement;
  private readonly death: HTMLElement;
  private readonly deathSub: HTMLElement;
  private readonly scoreboard: HTMLElement;
  private readonly debug: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly hairN: HTMLElement;
  private readonly hairE: HTMLElement;
  private readonly hairS: HTMLElement;
  private readonly hairW: HTMLElement;
  private readonly toolGunHud: HTMLElement;
  private readonly toolGunSelected: HTMLElement;
  private readonly toolGunHint: HTMLElement;
  private readonly weaponBar: HTMLElement;
  private readonly slotNodes: HTMLElement[] = [];
  private readonly slotIcons: HTMLElement[] = [];
  private readonly slotNames: HTMLElement[] = [];

  private hitTimer = 0;
  private hurtTimer = 0;
  private toastTimer = 0;
  private deathEndsAt = 0;
  private chatLines: string[] = [];
  private lastHealth = -1;
  private lastAmmo = '';
  private lastWeapon = '';
  private lastNet = '';
  private lastInteract = '';
  private lastDebug = '';
  private lastSpread = -1;
  private lastSlot = -1;
  private lastToolGun = '';
  private lastCross = '';
  private slotPopTimer = 0;
  private loadoutKey = '';

  constructor(host: HTMLElement) {
    this.root = el('div', 'hud');
    host.append(this.root);

    this.crosshair = el('div', 'crosshair');
    this.crosshair.append(el('i', 'ch-dot'));
    this.hairN = el('i', 'ch-tick n');
    this.hairE = el('i', 'ch-tick e');
    this.hairS = el('i', 'ch-tick s');
    this.hairW = el('i', 'ch-tick w');
    this.crosshair.append(this.hairN, this.hairE, this.hairS, this.hairW, el('i', 'ch-ring'));

    this.toolGunHud = el('div', 'toolgun-hud hud-glass');
    this.toolGunHud.append(el('div', 'toolgun-title', 'TOOL GUN'));
    this.toolGunSelected = el('div', 'toolgun-selected', 'Selected: NPC');
    this.toolGunHint = el('div', 'toolgun-hint');
    this.toolGunHint.append(
      hintRow('LMB', 'Spawn'),
      hintRow('RMB', 'Spawn Menu'),
    );
    this.toolGunHud.append(this.toolGunSelected, this.toolGunHint);
    this.toolGunHud.hidden = true;

    this.hitmarker = el('div', 'hitmarker');
    this.hitmarker.append(el('i', 'a'), el('i', 'b'));

    this.hurt = el('div', 'hurt');
    this.dirHit = el('div', 'dir-hit');
    this.dirHit.append(el('i'));

    const vitals = el('div', 'hud-vitals hud-glass');
    const hpRow = el('div', 'vital-meta');
    hpRow.append(el('span', '', 'VITALS'), (this.healthText = el('span', '', '100')));
    const hpBar = el('div', 'bar');
    this.healthFill = el('span');
    hpBar.append(this.healthFill);
    vitals.append(hpRow, hpBar);

    this.ammoPanel = el('div', 'hud-weapon hud-glass');
    this.ammoName = el('div', 'name', '—');
    this.ammoBig = el('div', 'ammo', '0');
    const magRow = el('div', 'vital-meta');
    magRow.append(el('span', '', 'MAG'), (this.ammoText = el('span', '', '0 / 0')));
    const magBar = el('div', 'bar ammo');
    this.ammoFill = el('span');
    magBar.append(this.ammoFill);
    this.ammoPanel.append(this.ammoName, this.ammoBig, magRow, magBar);

    this.weaponBar = el('div', 'weapon-bar');
    for (let i = 0; i < 6; i++) {
      const slot = el('div', 'weapon-slot');
      const num = el('div', 'slot-num', String(i + 1));
      const icon = el('div', 'slot-icon');
      icon.innerHTML = slotGlyph(i === TOOL_GUN_UI_SLOT ? 'toolgun' : 'pistol');
      const name = el('div', 'slot-name', i === TOOL_GUN_UI_SLOT ? 'TOOL GUN' : '—');
      slot.append(num, icon, name);
      this.weaponBar.append(slot);
      this.slotNodes.push(slot);
      this.slotIcons.push(icon);
      this.slotNames.push(name);
    }

    this.killfeed = el('div', 'killfeed');
    this.chatLog = el('div', 'chat-log');
    this.chatBox = el('div', 'chat-box');
    this.chatInput = document.createElement('input');
    this.chatInput.maxLength = 160;
    this.chatInput.placeholder = 'say something';
    this.chatBox.append(this.chatInput);

    this.net = el('div', 'hud-net', '');
    this.net.hidden = true;
    this.interact = el('div', 'interact', '');
    this.debug = el('div', 'debug-overlay');
    this.toast = el('div', 'toast hud-glass');

    this.death = el('div', 'death');
    this.death.append(el('h2', '', 'ELIMINATED'));
    this.deathSub = el('p', '', '');
    this.death.append(this.deathSub);

    this.scoreboard = el('div', 'scoreboard hud-glass');

    this.pause = el('div', 'pause');
    const card = el('div', 'pause-card');
    card.append(el('h2', '', 'PAUSED'));
    const resume = el('button', 'rl-btn primary', 'Resume');
    const settings = el('button', 'rl-btn', 'Settings');
    const leave = el('button', 'rl-btn', 'Leave match');
    resume.addEventListener('click', () => this.onResume?.());
    settings.addEventListener('click', () => this.onSettings?.());
    leave.addEventListener('click', () => this.onLeave?.());
    card.append(resume, settings, leave);
    this.pause.append(card);

    this.root.append(
      this.hurt,
      this.dirHit,
      this.crosshair,
      this.toolGunHud,
      this.hitmarker,
      vitals,
      this.ammoPanel,
      this.weaponBar,
      this.killfeed,
      this.chatLog,
      this.chatBox,
      this.net,
      this.interact,
      this.debug,
      this.toast,
      this.death,
      this.scoreboard,
      this.pause,
    );

    this.chatInput.addEventListener('keydown', (event) => {
      if (event.code === 'Escape') {
        this.closeChat();
        event.preventDefault();
      }
      if (event.code === 'Enter') {
        const text = this.chatInput.value.trim();
        this.closeChat();
        if (text) this.onChat?.(text);
        event.preventDefault();
      }
      event.stopPropagation();
    });
  }

  onResume: (() => void) | null = null;
  onSettings: (() => void) | null = null;
  onLeave: (() => void) | null = null;
  onChat: ((text: string) => void) | null = null;
  onRespawn: (() => void) | null = null;

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  setHealth(current: number, max = 100): void {
    const rounded = Math.round(current);
    if (rounded === this.lastHealth) return;
    this.lastHealth = rounded;
    const t = Math.max(0, Math.min(1, current / max));
    this.healthFill.style.transform = `scaleX(${t})`;
    this.healthText.textContent = String(rounded);
  }

  setAmmo(mag: number, reserve: number, magSize: number): void {
    const key = `${mag}/${reserve}/${magSize}`;
    if (key === this.lastAmmo) return;
    this.lastAmmo = key;
    this.ammoFill.style.transform = `scaleX(${magSize > 0 ? mag / magSize : 0})`;
    this.ammoText.textContent = `${mag} / ${reserve}`;
    this.ammoBig.innerHTML = `${mag}<small> / ${reserve}</small>`;
  }

  setWeapon(name: string): void {
    if (name === this.lastWeapon) return;
    this.lastWeapon = name;
    this.ammoName.textContent = name;
  }

  setLoadout(slots: HudSlotInfo[]): void {
    const key = slots.map((s) => `${s.id}:${s.name}`).join('|');
    if (key === this.loadoutKey) return;
    this.loadoutKey = key;
    for (let i = 0; i < TOOL_GUN_UI_SLOT; i++) {
      const info = slots[i];
      const name = this.slotNames[i];
      const icon = this.slotIcons[i];
      if (!name || !icon) continue;
      name.textContent = info ? shortWeaponName(info.name) : '—';
      icon.innerHTML = slotGlyph(info?.id ?? 'pistol');
    }
    const toolName = this.slotNames[TOOL_GUN_UI_SLOT];
    const toolIcon = this.slotIcons[TOOL_GUN_UI_SLOT];
    if (toolName) toolName.textContent = 'TOOL GUN';
    if (toolIcon) toolIcon.innerHTML = slotGlyph('toolgun');
  }

  setActiveSlot(slot: number): void {
    if (slot === this.lastSlot) return;
    this.lastSlot = slot;
    for (let i = 0; i < this.slotNodes.length; i++) {
      this.slotNodes[i]!.classList.toggle('selected', i === slot);
    }
    this.weaponBar.classList.add('switching');
    window.clearTimeout(this.slotPopTimer);
    this.slotPopTimer = window.setTimeout(() => this.weaponBar.classList.remove('switching'), 220);
  }

  setToolGun(active: boolean, kind: ToolGunKind, spawnable: boolean): void {
    const key = `${active}|${kind}|${spawnable}`;
    if (key === this.lastToolGun) return;
    this.lastToolGun = key;
    this.toolGunHud.hidden = !active;
    this.ammoPanel.hidden = active;
    this.crosshair.classList.toggle('toolgun', active);
    if (!active) return;
    this.toolGunSelected.textContent = `Selected: ${kind}`;
    const lmb = this.toolGunHint.firstElementChild?.lastElementChild;
    if (lmb) lmb.textContent = spawnable ? 'Spawn' : 'Unavailable';
  }

  setSpread(radians: number): void {
    const px = Math.round(5 + radians * 380);
    if (px === this.lastSpread) return;
    this.lastSpread = px;
    this.crosshair.style.setProperty('--gap', `${px}px`);
  }

  setCrosshairMotion(speedRatio: number, hover: boolean, spawnReady: boolean): void {
    const moving = speedRatio > 0.12;
    const key = `${moving}|${hover}|${spawnReady}`;
    if (key === this.lastCross) return;
    this.lastCross = key;
    this.crosshair.classList.toggle('moving', moving);
    this.crosshair.classList.toggle('hover', hover);
    this.crosshair.classList.toggle('ready', spawnReady);
  }

  setNet(fps: number, ping: number, debug: boolean): void {
    if (!debug) {
      if (!this.net.hidden) {
        this.net.hidden = true;
        this.net.textContent = '';
        this.lastNet = '';
      }
      return;
    }
    const text = `${Math.round(fps)} FPS   ${Math.round(ping)} ms`;
    if (text === this.lastNet) return;
    this.lastNet = text;
    this.net.hidden = false;
    this.net.textContent = text;
  }

  setInteract(label: string | null): void {
    const text = label ?? '';
    if (text === this.lastInteract) return;
    this.lastInteract = text;
    this.interact.textContent = text;
  }

  setDebug(text: string, open: boolean): void {
    this.debug.classList.toggle('open', open);
    if (!open) return;
    if (text === this.lastDebug) return;
    this.lastDebug = text;
    this.debug.textContent = text;
  }

  setScoreboard(rows: HudScoreRow[], open: boolean): void {
    this.scoreboard.classList.toggle('open', open);
    if (!open) return;
    const body = rows
      .map(
        (r) =>
          `<tr${r.self ? ' style="color:var(--accent)"' : ''}><td>${escapeHtml(r.name)}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.ping}</td></tr>`,
      )
      .join('');
    this.scoreboard.innerHTML = `<h3 style="margin:0 0 8px;letter-spacing:.18em">ROSTER</h3>
      <table class="rl-table"><thead><tr><th>Player</th><th>K</th><th>D</th><th>Ping</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  addKill(killer: string, victim: string, weapon: string, head: boolean): void {
    const row = el('div', '', `${killer}  [${weapon}${head ? ' HS' : ''}]  ${victim}`);
    this.killfeed.prepend(row);
    while (this.killfeed.childElementCount > 6) this.killfeed.lastElementChild?.remove();
    window.setTimeout(() => row.remove(), 6000);
  }

  addChat(name: string, message: string): void {
    this.chatLines.push(`<span>${escapeHtml(name)}</span>: ${escapeHtml(message)}`);
    if (this.chatLines.length > 8) this.chatLines.shift();
    this.chatLog.innerHTML = this.chatLines.map((l) => `<div>${l}</div>`).join('');
  }

  openChat(): void {
    this.chatBox.classList.add('open');
    this.chatInput.value = '';
    this.chatInput.focus();
  }

  closeChat(): void {
    this.chatBox.classList.remove('open');
    this.chatInput.blur();
  }

  get chatting(): boolean {
    return this.chatBox.classList.contains('open');
  }

  showHit(head: boolean): void {
    this.hitmarker.classList.add('show');
    this.hitmarker.classList.toggle('head', head);
    this.hitTimer = 0.12;
  }

  showHurt(yawOffset: number): void {
    this.hurt.classList.add('on');
    this.hurtTimer = 0.22;
    const mark = this.dirHit.firstElementChild as HTMLElement | null;
    if (mark) {
      mark.style.opacity = '1';
      this.dirHit.style.transform = `translate(-50%, -50%) rotate(${yawOffset}rad)`;
    }
  }

  showDeath(respawnAt: number, now: number): void {
    this.death.classList.add('show');
    this.deathEndsAt = respawnAt;
    this.updateDeath(now);
    this.death.onclick = () => this.onRespawn?.();
  }

  hideDeath(): void {
    this.death.classList.remove('show');
  }

  private updateDeath(now: number): void {
    const remain = Math.max(0, this.deathEndsAt - now);
    this.deathSub.textContent =
      remain > 0
        ? `Respawn in ${(remain / 1000).toFixed(1)}s`
        : 'Click or jump to respawn';
  }

  setPaused(open: boolean): void {
    this.pause.classList.toggle('open', open);
  }

  showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this.toastTimer = 2.4;
  }

  update(dt: number, nowMs: number): void {
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.hitmarker.classList.remove('show');
    }
    if (this.hurtTimer > 0) {
      this.hurtTimer -= dt;
      if (this.hurtTimer <= 0) {
        this.hurt.classList.remove('on');
        const mark = this.dirHit.firstElementChild as HTMLElement | null;
        if (mark) mark.style.opacity = '0';
      }
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
    if (this.death.classList.contains('show')) this.updateDeath(nowMs);
  }
}

function hintRow(key: string, action: string): HTMLElement {
  const row = el('div', 'toolgun-bind');
  row.append(el('kbd', '', key), el('span', '', action));
  return row;
}

function shortWeaponName(name: string): string {
  const cut = name.split(' ')[0] ?? name;
  return cut.length > 10 ? cut.slice(0, 10) : cut;
}

function slotGlyph(id: string): string {
  const common = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
  switch (id) {
    case 'toolgun':
      return `<svg ${common}><path d="M14 7l3-3 3 3-3 3"/><path d="M11 10L4 17v3h3l7-7"/><circle cx="16.5" cy="7.5" r="1"/></svg>`;
    case 'smg':
      return `<svg ${common}><path d="M3 14h12l2-5h3"/><path d="M7 14v5H5"/><path d="M11 14v3"/></svg>`;
    case 'rifle':
      return `<svg ${common}><path d="M2 14h16l3-4"/><path d="M8 14v5H6"/><path d="M12 10h4"/></svg>`;
    case 'shotgun':
      return `<svg ${common}><path d="M2 15h14l4-3"/><path d="M7 15v4H5"/><path d="M11 12h5"/></svg>`;
    case 'sniper':
      return `<svg ${common}><path d="M2 14h18"/><circle cx="14" cy="10" r="2.4"/><path d="M8 14v5H6"/></svg>`;
    default:
      return `<svg ${common}><path d="M8 13h8l2-4"/><path d="M10 13v6H8"/><path d="M7 9h4"/></svg>`;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
