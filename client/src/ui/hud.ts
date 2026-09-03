import { el } from './dom';

export interface HudScoreRow {
  id: number;
  name: string;
  kills: number;
  deaths: number;
  ping: number;
  self: boolean;
}

export class Hud {
  readonly root: HTMLElement;

  private readonly healthFill: HTMLElement;
  private readonly healthText: HTMLElement;
  private readonly ammoFill: HTMLElement;
  private readonly ammoText: HTMLElement;
  private readonly weaponName: HTMLElement;
  private readonly ammoBig: HTMLElement;
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
  private readonly hairL: HTMLElement;
  private readonly hairR: HTMLElement;
  private readonly hairT: HTMLElement;
  private readonly hairB: HTMLElement;
  private readonly toolGunHud: HTMLElement;
  private readonly toolGunSelected: HTMLElement;
  private readonly toolGunHint: HTMLElement;

  private hitTimer = 0;
  private hurtTimer = 0;
  private toastTimer = 0;
  private deathEndsAt = 0;
  private chatLines: string[] = [];

  constructor(host: HTMLElement) {
    this.root = el('div', 'hud');
    host.append(this.root);

    this.crosshair = el('div', 'crosshair');
    this.hairL = el('i', 'h l');
    this.hairR = el('i', 'h r');
    this.hairT = el('i', 'v t');
    this.hairB = el('i', 'v b');
    this.crosshair.append(this.hairL, this.hairR, this.hairT, this.hairB);

    this.toolGunHud = el('div', 'toolgun-hud');
    this.toolGunHud.append(el('div', 'toolgun-title', 'TOOL GUN'));
    this.toolGunSelected = el('div', 'toolgun-selected', 'Selected: Humanoid');
    this.toolGunHint = el('div', 'toolgun-hint', 'LMB — Spawn    RMB — Spawn Menu');
    this.toolGunHud.append(this.toolGunSelected, this.toolGunHint);
    this.toolGunHud.hidden = true;

    this.hitmarker = el('div', 'hitmarker');
    this.hitmarker.append(el('i', 'a'), el('i', 'b'));

    this.hurt = el('div', 'hurt');
    this.dirHit = el('div', 'dir-hit');
    this.dirHit.append(el('i'));

    const vitals = el('div', 'hud-vitals');
    const hpRow = el('div', 'vital-meta');
    hpRow.append(el('span', '', 'ARMOR / VITALS'), (this.healthText = el('span', '', '100')));
    const hpBar = el('div', 'bar');
    this.healthFill = el('span');
    hpBar.append(this.healthFill);
    const apRow = el('div', 'vital-meta');
    apRow.append(el('span', '', 'MAGAZINE'), (this.ammoText = el('span', '', '0 / 0')));
    const apBar = el('div', 'bar ammo');
    this.ammoFill = el('span');
    apBar.append(this.ammoFill);
    vitals.append(hpRow, hpBar, apRow, apBar);

    const weapon = el('div', 'hud-weapon');
    this.weaponName = el('div', 'name', '—');
    this.ammoBig = el('div', 'ammo', '0');
    weapon.append(this.weaponName, this.ammoBig);

    this.killfeed = el('div', 'killfeed');
    this.chatLog = el('div', 'chat-log');
    this.chatBox = el('div', 'chat-box');
    this.chatInput = document.createElement('input');
    this.chatInput.maxLength = 160;
    this.chatInput.placeholder = 'say something';
    this.chatBox.append(this.chatInput);

    this.net = el('div', 'hud-net', '');
    this.interact = el('div', 'interact', '');
    this.debug = el('div', 'debug-overlay');
    this.toast = el('div', 'toast');

    this.death = el('div', 'death');
    this.death.append(el('h2', '', 'ELIMINATED'));
    this.deathSub = el('p', '', '');
    this.death.append(this.deathSub);

    this.scoreboard = el('div', 'scoreboard');

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
      weapon,
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
    const t = Math.max(0, Math.min(1, current / max));
    this.healthFill.style.transform = `scaleX(${t})`;
    this.healthText.textContent = String(Math.round(current));
  }

  setAmmo(mag: number, reserve: number, magSize: number): void {
    this.ammoFill.style.transform = `scaleX(${magSize > 0 ? mag / magSize : 0})`;
    this.ammoText.textContent = `${mag} / ${reserve}`;
    this.ammoBig.innerHTML = `${mag}<small> / ${reserve}</small>`;
  }

  setWeapon(name: string): void {
    this.weaponName.textContent = name;
  }

  setToolGun(active: boolean, selectedName: string, spawnable: boolean): void {
    this.toolGunHud.hidden = !active;
    this.crosshair.classList.toggle('toolgun', active);
    if (!active) return;
    this.toolGunSelected.textContent = `Selected: ${selectedName}`;
    this.toolGunHint.textContent = spawnable
      ? 'LMB — Spawn    RMB — Spawn Menu'
      : 'Weapons cannot be spawned    RMB — Spawn Menu';
  }

  setSpread(radians: number): void {
    const px = 8 + radians * 420;
    this.hairL.style.right = `${px}px`;
    this.hairR.style.left = `${px}px`;
    this.hairT.style.bottom = `${px}px`;
    this.hairB.style.top = `${px}px`;
  }

  setNet(fps: number, ping: number, showFps: boolean, showPing: boolean): void {
    const parts: string[] = [];
    if (showFps) parts.push(`${Math.round(fps)} FPS`);
    if (showPing) parts.push(`${Math.round(ping)} ms`);
    this.net.textContent = parts.join('   ');
  }

  setInteract(label: string | null): void {
    this.interact.textContent = label ?? '';
  }

  setDebug(text: string, open: boolean): void {
    this.debug.textContent = text;
    this.debug.classList.toggle('open', open);
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
