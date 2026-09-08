import { el } from './dom';
import { TOOL_GUN_UI_SLOT } from '../player/inputController';
import { copyText, lobbyInviteUrl } from './lobbyInvite';
import { settingsStore } from '../settings/settingsStore';
import { BodycamOverlay } from './bodycamOverlay';
import { BodyStatusView } from './bodyStatus';
import type { BodyPartId, BodyPartState } from '@ragelab/shared';

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
  blurb?: string;
  mag?: number;
  reserve?: number;
  magSize?: number;
}

export type ToolGunKind = 'NPC' | 'Prop' | 'Tool' | 'Weapon';

const WHEEL_SLOTS = 4;
const WHEEL_DEADZONE = 36;
const TIPS_DISMISS_KEY = 'ragelab.hud.tips.dismissed';

export class Hud {
  readonly root: HTMLElement;

  private readonly healthFill: HTMLElement;
  private readonly healthText: HTMLElement;
  private readonly ammoPanel: HTMLElement;
  private readonly ammoName: HTMLElement;
  private readonly killfeed: HTMLElement;
  private readonly chatLog: HTMLElement;
  private readonly chatBox: HTMLElement;
  private readonly chatInput: HTMLInputElement;
  private readonly net: HTMLElement;
  private readonly interact: HTMLElement;
  private readonly interactKey: HTMLElement;
  private readonly interactAction: HTMLElement;
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
  private readonly toolGunHud: HTMLElement;
  private readonly toolGunSelected: HTMLElement;
  private readonly toolGunHint: HTMLElement;
  private readonly weaponBar: HTMLElement;
  private readonly slotNodes: HTMLElement[] = [];
  private readonly slotIcons: HTMLElement[] = [];
  private readonly slotNames: HTMLElement[] = [];
  private readonly wheel: HTMLElement;
  private readonly wheelSlots: HTMLElement[] = [];
  private readonly wheelIcons: HTMLElement[] = [];
  private readonly wheelNames: HTMLElement[] = [];
  private readonly wheelCenterName: HTMLElement;
  private readonly wheelCenterBlurb: HTMLElement;
  private readonly wheelCenterAmmo: HTMLElement;
  private readonly wheelCenterIcon: HTMLElement;
  private readonly wheelCursor: HTMLElement;
  private readonly vitals: HTMLElement;
  private readonly staminaFill: HTMLElement;
  private readonly staminaText: HTMLElement;
  private readonly lobbyChip: HTMLButtonElement;
  private readonly scope: HTMLElement;
  private readonly bodycam: BodycamOverlay;
  private readonly tips: HTMLElement;
  private readonly magStatus: HTMLElement;
  private readonly bodyStatus: BodyStatusView;

  private hitTimer = 0;
  private hurtTimer = 0;
  private toastTimer = 0;
  private magStatusTimer = 0;
  private deathEndsAt = 0;
  private chatLines: string[] = [];
  private lastHealth = -1;
  private lastStamina = -1;
  private lastAmmo = '';
  private lastWeapon = '';
  private lastNet = '';
  private lastInteract = '';
  private lastDebug = '';
  private lastSpread = -1;
  private lastSlot = -1;
  private lastToolGun = '';
  private lastCross = '';
  private lastWheel = '';
  private lastLobby = '';
  private lobbyCode = '';
  private lobbyWsUrl: string | undefined;
  private slotPopTimer = 0;
  private loadoutKey = '';
  private loadout: HudSlotInfo[] = [];
  private wheelHighlight = 0;
  private wheelOpen = false;
  private wheelCancel = false;

  constructor(host: HTMLElement) {
    this.root = el('div', 'hud');
    host.append(this.root);
    this.bodycam = new BodycamOverlay(settingsStore.graphics.bodycam);

    this.crosshair = el('div', 'crosshair is-hidden');

    this.scope = el('div', 'scope');
    this.scope.innerHTML =
      '<div class="scope-shade"></div><div class="scope-lens"><i class="sr-ring"></i><i class="sr-h"></i><i class="sr-v"></i><i class="sr-dot"></i><i class="sr-hash n"></i><i class="sr-hash e"></i><i class="sr-hash s"></i><i class="sr-hash w"></i></div>';

    this.toolGunHud = el('div', 'toolgun-hud');
    this.toolGunHud.append(el('div', 'toolgun-title', 'Tool Gun'));
    this.toolGunSelected = el('div', 'toolgun-selected', 'NPC');
    this.toolGunHint = el('div', 'toolgun-hint');
    this.toolGunHint.append(hintRow('LMB', 'Spawn'), hintRow('RMB', 'Menu'));
    this.toolGunHud.append(this.toolGunSelected, this.toolGunHint);
    this.toolGunHud.hidden = true;

    this.hitmarker = el('div', 'hitmarker');
    this.hitmarker.append(el('i', 'a'), el('i', 'b'));

    this.hurt = el('div', 'hurt');
    this.dirHit = el('div', 'dir-hit');
    this.dirHit.append(el('i'));

    this.vitals = el('div', 'hud-vitals');
    const hpKicker = el('div', 'vital-kicker', 'Vitals');
    const hpLabel = el('div', 'vital-meta');
    hpLabel.append(el('span', '', 'Health'), (this.healthText = el('span', '', '100')));
    const hpBar = el('div', 'bar');
    this.healthFill = el('span');
    hpBar.append(this.healthFill);
    const stLabel = el('div', 'vital-meta stamina-meta');
    stLabel.append(el('span', '', 'Stamina'), (this.staminaText = el('span', '', '100')));
    const stBar = el('div', 'bar stamina');
    this.staminaFill = el('span');
    stBar.append(this.staminaFill);
    this.vitals.append(hpKicker, hpLabel, hpBar, stLabel, stBar);

    this.bodyStatus = new BodyStatusView('hud');

    this.tips = this.buildTips();
    this.magStatus = el('div', 'hud-mag-status');
    this.magStatus.setAttribute('aria-live', 'polite');

    this.ammoPanel = el('div', 'hud-weapon');
    this.ammoName = el('div', 'name', '—');
    // Minimal HUD: right panel hidden via CSS. No ammo / LOW / mag strip.
    this.ammoPanel.append(this.ammoName);

    this.weaponBar = el('div', 'weapon-bar');
    for (let i = 0; i < WHEEL_SLOTS; i++) {
      const slot = el('div', 'weapon-slot');
      const num = el('div', 'slot-num', String(i + 1));
      const icon = el('div', 'slot-icon');
      icon.innerHTML = slotGlyph(i === TOOL_GUN_UI_SLOT ? 'toolgun' : 'pistol');
      const name = el('div', 'slot-name', i === TOOL_GUN_UI_SLOT ? 'Tool Gun' : '—');
      slot.append(num, icon, name);
      this.weaponBar.append(slot);
      this.slotNodes.push(slot);
      this.slotIcons.push(icon);
      this.slotNames.push(name);
    }

    this.wheel = this.buildWheel();
    this.wheelCenterIcon = this.wheel.querySelector('.ww-center-icon') as HTMLElement;
    this.wheelCenterName = this.wheel.querySelector('.ww-center-name') as HTMLElement;
    this.wheelCenterBlurb = this.wheel.querySelector('.ww-center-blurb') as HTMLElement;
    this.wheelCenterAmmo = this.wheel.querySelector('.ww-center-ammo') as HTMLElement;
    this.wheelCursor = this.wheel.querySelector('.ww-cursor') as HTMLElement;

    this.killfeed = el('div', 'killfeed');
    this.chatLog = el('div', 'chat-log');
    this.chatBox = el('div', 'chat-box');
    this.chatInput = document.createElement('input');
    this.chatInput.maxLength = 160;
    this.chatInput.placeholder = 'Message';
    this.chatBox.append(this.chatInput);

    this.net = el('div', 'hud-net', '');
    this.net.hidden = true;
    this.lobbyChip = el('button', 'lobby-chip');
    this.lobbyChip.type = 'button';
    this.lobbyChip.hidden = true;
    this.lobbyChip.title = 'Copy invite link';
    this.lobbyChip.addEventListener('click', () => {
      void this.copyLobbyInvite();
    });
    this.interact = el('div', 'interact');
    this.interactKey = el('kbd', '', 'E');
    this.interactAction = el('span', '', '');
    this.interact.append(this.interactKey, this.interactAction);
    this.debug = el('div', 'debug-overlay');
    this.toast = el('div', 'toast');

    this.death = el('div', 'death');
    this.deathSub = el('p', '', '');
    this.death.append(this.deathSub);

    this.scoreboard = el('div', 'scoreboard');

    this.pause = el('div', 'pause');
    // Content is built only when ESC opens pause — never leave Resume/Main menu on screen.

    this.root.append(
      this.bodycam.root,
      this.hurt,
      this.dirHit,
      this.scope,
      this.crosshair,
      this.toolGunHud,
      this.hitmarker,
      this.vitals,
      this.bodyStatus.root,
      this.tips,
      this.magStatus,
      this.ammoPanel,
      this.weaponBar,
      this.wheel,
      this.killfeed,
      this.chatLog,
      this.chatBox,
      this.net,
      this.lobbyChip,
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

    this.refreshTipsVisibility();
  }

  onResume: (() => void) | null = null;
  onSettings: (() => void) | null = null;
  onLeave: (() => void) | null = null;
  onChat: ((text: string) => void) | null = null;
  onRespawn: (() => void) | null = null;

  get weaponWheelOpen(): boolean {
    return this.wheelOpen;
  }

  get wheelSelectedSlot(): number {
    return this.wheelHighlight;
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
    this.root.classList.toggle('hud-ready', visible);
    this.bodycam.setVisible(visible);
    if (visible) {
      this.bodycam.clearDeath();
      this.bodycam.resetRecTimer();
      this.refreshTipsVisibility();
    }
  }

  applyBodycamSettings(): void {
    this.bodycam.apply(settingsStore.graphics.bodycam);
  }

  setHealth(current: number, max = 100): void {
    const rounded = Math.round(current);
    if (rounded === this.lastHealth) return;
    this.lastHealth = rounded;
    const t = Math.max(0, Math.min(1, current / max));
    this.healthFill.style.transform = `scaleX(${t})`;
    this.healthText.textContent = String(rounded);
    this.vitals.classList.toggle('critical', t <= 0.28);
  }

  setBodyParts(parts: BodyPartState, hit?: BodyPartId | null): void {
    this.bodyStatus.setParts(parts, hit);
  }

  resetBodyParts(): void {
    this.bodyStatus.reset();
  }

  getBodyParts(): BodyPartState {
    return this.bodyStatus.state;
  }

  setStamina(current: number, max = 1): void {
    const t = Math.max(0, Math.min(1, current / max));
    const rounded = Math.round(t * 100);
    if (rounded === this.lastStamina) return;
    this.lastStamina = rounded;
    this.staminaFill.style.transform = `scaleX(${t})`;
    this.staminaText.textContent = String(rounded);
    this.vitals.classList.toggle('winded', t <= 0.22);
  }

  setAmmo(mag: number, reserve: number, magSize: number): void {
    const key = `${mag}/${reserve}/${magSize}`;
    if (key === this.lastAmmo) return;
    this.lastAmmo = key;
    // Keep internal state for wheel / logic — never show counts or LOW/FULL on HUD.
    this.ammoPanel.classList.toggle('empty', mag <= 0);
    if (this.loadout[this.lastSlot]) {
      this.loadout[this.lastSlot]!.mag = mag;
      this.loadout[this.lastSlot]!.reserve = reserve;
      this.loadout[this.lastSlot]!.magSize = magSize;
    }
    if (this.wheelOpen) this.paintWheelCenter(this.wheelHighlight);
  }

  setMagazineIcons(_icons: Array<{ icon: string; fill: number; active?: boolean }>): void {
    // Magazines live only in TAB inventory — never on the in-game HUD.
  }

  setWeapon(name: string): void {
    if (name === this.lastWeapon) return;
    this.lastWeapon = name;
    this.ammoName.textContent = name;
    this.ammoPanel.classList.add('switching');
    window.setTimeout(() => this.ammoPanel.classList.remove('switching'), 180);
  }

  setLoadout(slots: HudSlotInfo[]): void {
    const key = slots.map((s) => `${s.id}:${s.name}`).join('|');
    this.loadout = slots.slice();
    if (key === this.loadoutKey) return;
    this.loadoutKey = key;
    for (let i = 0; i < TOOL_GUN_UI_SLOT; i++) {
      const info = slots[i];
      const name = this.slotNames[i];
      const icon = this.slotIcons[i];
      if (!name || !icon) continue;
      name.textContent = info && info.id ? shortWeaponName(info.name) : '—';
      icon.innerHTML = slotGlyph(info?.id || 'empty');
      const wName = this.wheelNames[i];
      const wIcon = this.wheelIcons[i];
      if (wName) wName.textContent = info && info.id ? shortWeaponName(info.name) : '—';
      if (wIcon) wIcon.innerHTML = slotGlyph(info?.id || 'empty');
    }
    const name = this.slotNames[TOOL_GUN_UI_SLOT];
    const icon = this.slotIcons[TOOL_GUN_UI_SLOT];
    if (name) name.textContent = 'Tool Gun';
    if (icon) icon.innerHTML = slotGlyph('toolgun');
    const wName = this.wheelNames[TOOL_GUN_UI_SLOT];
    const wIcon = this.wheelIcons[TOOL_GUN_UI_SLOT];
    if (wName) wName.textContent = 'Tool Gun';
    if (wIcon) wIcon.innerHTML = slotGlyph('toolgun');
  }

  setActiveSlot(slot: number): void {
    if (slot === this.lastSlot) return;
    this.lastSlot = slot;
    for (let i = 0; i < this.slotNodes.length; i++) {
      this.slotNodes[i]!.classList.toggle('selected', i === slot);
    }
    this.weaponBar.classList.add('switching');
    window.clearTimeout(this.slotPopTimer);
    this.slotPopTimer = window.setTimeout(() => this.weaponBar.classList.remove('switching'), 200);
    if (this.wheelOpen) this.setWheelHighlight(slot);
  }

  setToolGun(active: boolean, kind: ToolGunKind, spawnable: boolean): void {
    const key = `${active}|${kind}|${spawnable}`;
    if (key === this.lastToolGun) return;
    this.lastToolGun = key;
    this.toolGunHud.hidden = !active;
    this.ammoPanel.hidden = active;
    this.crosshair.classList.toggle('toolgun', active);
    if (!active) return;
    this.toolGunSelected.textContent = kind;
    const lmb = this.toolGunHint.firstElementChild?.lastElementChild;
    if (lmb) lmb.textContent = spawnable ? 'Spawn' : 'Unavailable';
  }

  setSpread(radians: number): void {
    const px = Math.round(4 + radians * 340);
    if (px === this.lastSpread) return;
    this.lastSpread = px;
    this.crosshair.style.setProperty('--gap', `${px}px`);
  }

  setCrosshairMotion(speedRatio: number, hover: boolean, spawnReady: boolean): void {
    const moving = speedRatio > 0.12;
    const key = `${moving}|${hover}|${spawnReady}|${this.wheelOpen}`;
    if (key === this.lastCross) return;
    this.lastCross = key;
    this.crosshair.classList.toggle('moving', moving);
    this.crosshair.classList.toggle('hover', hover);
    this.crosshair.classList.toggle('ready', spawnReady);
    this.crosshair.classList.add('is-hidden');
  }

  setCrosshairVisible(_visible: boolean): void {
    this.crosshair.classList.add('is-hidden');
  }

  setScope(amount: number, kind: 'none' | 'optic' | 'ads'): void {
    const t = Math.max(0, Math.min(1, amount));
    this.scope.style.setProperty('--scope', t.toFixed(3));
    this.scope.classList.toggle('on', kind !== 'none' && t > 0.04);
    this.scope.classList.toggle('optic', kind === 'optic');
    this.scope.classList.toggle('ads', kind === 'ads');
    this.crosshair.classList.toggle('ads', kind === 'ads' && t > 0.4);
  }

  openWeaponWheel(activeSlot: number): void {
    this.wheelOpen = true;
    this.wheelCancel = false;
    this.wheelHighlight = activeSlot;
    this.wheel.classList.add('open');
    this.crosshair.classList.add('is-hidden');
    this.vitals.classList.add('dim');
    this.ammoPanel.classList.add('dim');
    this.weaponBar.classList.add('dim');
    this.setWheelHighlight(activeSlot);
    this.paintWheelCenter(activeSlot);
    this.wheelCursor.style.transform = 'translate(-50%, -50%)';
  }

  closeWeaponWheel(commit: boolean): number {
    this.wheelOpen = false;
    this.wheel.classList.remove('open');
    this.crosshair.classList.add('is-hidden');
    this.vitals.classList.remove('dim');
    this.ammoPanel.classList.remove('dim');
    this.weaponBar.classList.remove('dim');
    const slot = this.wheelCancel || !commit ? -1 : this.wheelHighlight;
    this.wheelCancel = false;
    this.lastWheel = '';
    return slot;
  }

  cancelWeaponWheel(): void {
    this.wheelCancel = true;
    this.closeWeaponWheel(false);
  }

  updateWeaponWheel(cursorX: number, cursorY: number, equippedSlot: number): void {
    if (!this.wheelOpen) return;
    const slot = slotFromCursor(cursorX, cursorY, WHEEL_SLOTS, WHEEL_DEADZONE);
    const highlight = slot < 0 ? equippedSlot : slot;
    this.setWheelHighlight(highlight);
    this.wheelCursor.style.transform = `translate(calc(-50% + ${cursorX * 0.42}px), calc(-50% + ${cursorY * 0.42}px))`;
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

  setLobbyInvite(code: string | null, wsUrl?: string | null): void {
    const next = code ?? '';
    const key = `${next}|${wsUrl ?? ''}`;
    if (key === this.lastLobby) return;
    this.lastLobby = key;
    this.lobbyCode = next;
    this.lobbyWsUrl = wsUrl || undefined;
    this.lobbyChip.hidden = next.length === 0;
    this.lobbyChip.textContent = next ? `LOBBY ${next}` : '';
  }

  private async copyLobbyInvite(): Promise<void> {
    if (!this.lobbyCode) return;
    const url = lobbyInviteUrl(this.lobbyCode, this.lobbyWsUrl);
    const ok = await copyText(url);
    this.showToast(ok ? `Copied ${this.lobbyCode}` : this.lobbyCode);
  }

  setInteract(label: string | null): void {
    const text = label ?? '';
    if (text === this.lastInteract) return;
    this.lastInteract = text;
    const show = text.length > 0;
    this.interact.classList.toggle('show', show);
    if (!show) return;
    const split = text.match(/^(\S+)\s{2,}(.+)$/);
    if (split) {
      this.interactKey.hidden = false;
      this.interactKey.textContent = split[1]!;
      this.interactAction.textContent = split[2]!;
    } else {
      this.interactKey.hidden = true;
      this.interactAction.textContent = text;
    }
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
          `<tr${r.self ? ' class="self"' : ''}><td>${escapeHtml(r.name)}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.ping}</td></tr>`,
      )
      .join('');
    this.scoreboard.innerHTML = `<h3>Roster</h3>
      <table class="rl-table"><thead><tr><th>Player</th><th>K</th><th>D</th><th>Ping</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  addKill(killer: string, victim: string, weapon: string, head: boolean): void {
    const row = el('div', '');
    row.innerHTML = `${escapeHtml(killer)} <em>${escapeHtml(weapon)}${head ? ' · HS' : ''}</em> ${escapeHtml(victim)}`;
    this.killfeed.prepend(row);
    while (this.killfeed.childElementCount > 6) this.killfeed.lastElementChild?.remove();
    window.setTimeout(() => row.remove(), 5600);
  }

  addChat(name: string, message: string): void {
    this.chatLines.push(`<span>${escapeHtml(name)}</span> ${escapeHtml(message)}`);
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
    this.crosshair.classList.add('hit');
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
    this.bodycam.playDeathShutoff();
  }

  hideDeath(): void {
    if (!this.death.classList.contains('show')) {
      this.bodycam.clearDeath();
      return;
    }
    this.death.classList.remove('show');
    this.bodycam.clearDeath();
    this.bodycam.resetRecTimer();
  }

  private buildTips(): HTMLElement {
    const panel = el('aside', 'hud-tips');
    panel.setAttribute('aria-label', 'Controls tip');

    const head = el('div', 'hud-tips-head');
    head.append(el('span', 'hud-tips-title', 'TIPS'));
    const close = el('button', 'hud-tips-close', '×');
    close.type = 'button';
    close.title = 'Hide tips';
    close.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        localStorage.setItem(TIPS_DISMISS_KEY, '1');
      } catch {
        /* ignore */
      }
      this.refreshTipsVisibility();
    });
    head.append(close);

    const list = el('ul', 'hud-tips-list');
    for (const row of [
      ['ALT + T', 'Check magazine'],
      ['TAB', 'Inventory'],
      ['ENTER', 'Chat'],
      ['R', 'Reload'],
      ['E', 'Interact / pickup'],
      ['1–4', 'Weapons / Tool Gun'],
    ] as const) {
      const li = el('li');
      li.innerHTML = `<kbd>${row[0]}</kbd><span>${row[1]}</span>`;
      list.append(li);
    }

    panel.append(head, list);
    return panel;
  }

  private refreshTipsVisibility(): void {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(TIPS_DISMISS_KEY) === '1';
    } catch {
      dismissed = false;
    }
    this.tips.hidden = dismissed;
  }

  private updateDeath(now: number): void {
    const remain = Math.max(0, this.deathEndsAt - now);
    this.deathSub.textContent =
      remain > 0 ? `Respawn in ${(remain / 1000).toFixed(1)}s` : 'Click or jump to respawn';
  }

  setPaused(open: boolean): void {
    this.pause.classList.toggle('open', open);
    if (open) {
      this.buildPauseMain();
      if (this.wheelOpen) this.cancelWeaponWheel();
    } else {
      clearPause(this.pause);
    }
  }

  private buildPauseMain(): void {
    clearPause(this.pause);
    const card = el('div', 'pause-card');
    card.append(el('h2', '', 'Paused'));
    card.append(el('p', 'pause-hint', 'Match paused. Resume or return to the main menu.'));
    const resume = el('button', 'rl-btn primary', 'Resume');
    const settings = el('button', 'rl-btn', 'Settings');
    const leave = el('button', 'rl-btn', 'Main menu');
    resume.addEventListener('click', () => this.onResume?.());
    settings.addEventListener('click', () => this.buildPauseSettings());
    leave.addEventListener('click', () => this.onLeave?.());
    card.append(resume, settings, leave);
    this.pause.append(card);
  }

  private buildPauseSettings(): void {
    clearPause(this.pause);
    const card = el('div', 'pause-card');
    card.append(el('h2', '', 'Settings'));
    card.append(el('p', 'pause-hint', 'Quick options. Full settings live in the main menu.'));
    const body = el('div', 'pause-settings');
    const g = settingsStore.value.graphics;
    const a = settingsStore.value.audio;
    const c = settingsStore.value.controls;

    body.append(
      pauseSlider('FOV', g.fov, 70, 110, 1, (v) => settingsStore.patchGraphics({ fov: v })),
      pauseSlider('Sensitivity', c.sensitivity, 0.4, 6, 0.05, (v) =>
        settingsStore.patchControls({ sensitivity: v }),
      ),
      pauseSlider('Master volume', a.master, 0, 1, 0.01, (v) => settingsStore.patchAudio({ master: v })),
      pauseSlider('Effects', a.effects, 0, 1, 0.01, (v) => settingsStore.patchAudio({ effects: v })),
    );
    const back = el('button', 'rl-btn', 'Back');
    back.addEventListener('click', () => this.buildPauseMain());
    const resume = el('button', 'rl-btn primary', 'Resume');
    resume.addEventListener('click', () => this.onResume?.());
    card.append(body, back, resume);
    this.pause.append(card);
  }

  showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this.toastTimer = 2.4;
  }

  /** Mag check: large MAGAZINE CHECK + FULL / HALF / LOW / EMPTY — raised bottom-right. */
  showMagStatus(status: 'FULL' | 'HALF' | 'LOW' | 'EMPTY'): void {
    this.magStatus.innerHTML =
      `<span class="hud-mag-status-title">MAGAZINE CHECK</span>` +
      `<span class="hud-mag-status-value">${status}</span>`;
    this.magStatus.classList.remove('is-out');
    // Retrigger fade-in if already visible.
    this.magStatus.classList.remove('is-on');
    void this.magStatus.offsetWidth;
    this.magStatus.classList.add('is-on');
    this.magStatusTimer = 2;
  }

  update(dt: number, nowMs: number): void {
    this.bodyStatus.tick(dt);
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) {
        this.hitmarker.classList.remove('show');
        this.crosshair.classList.remove('hit');
      }
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
    if (this.magStatusTimer > 0) {
      this.magStatusTimer -= dt;
      if (this.magStatusTimer <= 0) {
        this.magStatusTimer = 0;
        this.magStatus.classList.add('is-out');
        this.magStatus.classList.remove('is-on');
      }
    }
    if (this.death.classList.contains('show')) this.updateDeath(nowMs);
  }

  private buildWheel(): HTMLElement {
    const root = el('div', 'weapon-wheel');
    const disc = el('div', 'ww-disc');
    disc.innerHTML = `<svg class="ww-ring" viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="78" />
      <circle cx="100" cy="100" r="36" />
    </svg>`;
    const cursor = el('div', 'ww-cursor');
    disc.append(cursor);
    for (let i = 0; i < WHEEL_SLOTS; i++) {
      const deg = -90 + i * 60;
      const slot = el('div', 'ww-slot');
      slot.style.setProperty('--deg', `${deg}deg`);
      const num = el('div', 'ww-num', String(i + 1));
      const icon = el('div', 'ww-icon');
      icon.innerHTML = slotGlyph(i === TOOL_GUN_UI_SLOT ? 'toolgun' : 'pistol');
      const name = el('div', 'ww-name', i === TOOL_GUN_UI_SLOT ? 'Tool Gun' : '—');
      slot.append(num, icon, name);
      disc.append(slot);
      this.wheelSlots.push(slot);
      this.wheelIcons.push(icon);
      this.wheelNames.push(name);
    }
    const center = el('div', 'ww-center');
    center.innerHTML =
      '<div class="ww-center-icon"></div><div class="ww-center-name">—</div><div class="ww-center-blurb"></div><div class="ww-center-ammo"></div>';
    disc.append(center);
    const hint = el('div', 'ww-hint', 'Release to equip  ·  Esc cancel');
    root.append(disc, hint);
    return root;
  }

  private setWheelHighlight(slot: number): void {
    if (slot === this.wheelHighlight && this.lastWheel === `h${slot}`) return;
    this.wheelHighlight = slot;
    this.lastWheel = `h${slot}`;
    for (let i = 0; i < this.wheelSlots.length; i++) {
      this.wheelSlots[i]!.classList.toggle('hot', i === slot);
    }
    this.paintWheelCenter(slot);
  }

  private paintWheelCenter(slot: number): void {
    const tool = slot === TOOL_GUN_UI_SLOT;
    const info = tool
      ? { id: 'toolgun', name: 'Tool Gun', blurb: 'Spawn, grab and inspect the sandbox.', mag: undefined, reserve: undefined }
      : this.loadout[slot];
    this.wheelCenterIcon.innerHTML = slotGlyph(info?.id || 'empty');
    this.wheelCenterName.textContent = info?.id ? info.name : 'Empty';
    this.wheelCenterBlurb.textContent = info?.blurb ?? (tool ? 'Sandbox manipulator.' : weaponBlurb(info?.id ?? ''));
    this.wheelCenterAmmo.textContent = '';
  }
}

function slotFromCursor(x: number, y: number, count: number, deadzone: number): number {
  if (Math.hypot(x, y) < deadzone) return -1;
  let ang = Math.atan2(x, -y);
  if (ang < 0) ang += Math.PI * 2;
  const slice = (Math.PI * 2) / count;
  return Math.round(ang / slice) % count;
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

function weaponBlurb(id: string): string {
  switch (id) {
    case 'pistol':
      return 'Desert Eagle. Heavy .50 sidearm.';
    case 'glock':
      return 'Glock 17. 17-round 9mm.';
    case 'usp':
      return 'USP Compact. Clean 9mm sidearm.';
    case 'makarov':
      return 'Makarov PM. Compact Soviet pistol.';
    case 'magnum':
      return 'DX-50 Hammer. Fat .50 hand cannon.';
    case 'pdw':
      return 'Vector PDW. Blistering close-range SMG.';
    case 'smg':
      return 'High cyclic rate. Close-range pressure.';
    case 'bizon':
      return 'PP-19 Bizon. Huge helical mag.';
    case 'assault':
      return 'AR-C Assault. Modern automatic.';
    case 'rifle':
      return 'M4A1 Carbine. Balanced automatic.';
    case 'ak':
      return 'AK-74. Hard-hitting 5.45 rifle.';
    case 'shotgun':
      return 'Pump shotgun. Devastating up close.';
    case 'autosg':
      return 'AA-12 Storm. Full-auto shotgun.';
    case 'saiga':
      return 'Saiga-12. Mag-fed combat shotgun.';
    case 'dmr':
      return 'M1A Scout. Semi-auto marksman.';
    case 'sniper':
      return 'Bolt-action. Long-range precision.';
    case 'toolgun':
      return 'Spawn, grab and inspect the sandbox.';
    case 'empty':
      return 'Empty slot. Spawn a gun with Tool Gun, then E to pick up.';
    default:
      return 'Equipped firearm.';
  }
}

function slotGlyph(id: string): string {
  const common =
    'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
  switch (id) {
    case 'toolgun':
      return `<svg ${common}><path d="M14 7l3-3 3 3-3 3"/><path d="M11 10L4 17v3h3l7-7"/><circle cx="16.5" cy="7.5" r="1"/></svg>`;
    case 'build':
      return `<svg ${common}><path d="M4 20V10l8-6 8 6v10"/><path d="M10 20v-6h4v6"/></svg>`;
    case 'hammer':
      return `<svg ${common}><path d="M14 5l5 5-2 2-5-5z"/><path d="M8 12l4 4"/><path d="M6 20l6-6"/></svg>`;
    case 'empty':
    case '':
      return `<svg ${common}><rect x="5" y="5" width="14" height="14" rx="2" stroke-dasharray="3 2"/></svg>`;
    case 'magnum':
      return `<svg ${common}><path d="M4 13h11l3-5h3"/><path d="M9 13v6H6"/><path d="M7 9h5"/><path d="M15 8v3"/></svg>`;
    case 'glock':
      return `<svg ${common}><path d="M8 13h8l2-4"/><path d="M10 13v6H8"/><path d="M7 9h4"/></svg>`;
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

function clearPause(host: HTMLElement): void {
  host.replaceChildren();
}

function pauseSlider(
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
  const readout = el('span', '', Number.isInteger(value) ? String(value) : value.toFixed(2));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    readout.textContent = Number.isInteger(v) ? String(v) : v.toFixed(2);
    onChange(v);
  });
  row.append(input, readout);
  wrap.append(row);
  return wrap;
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
