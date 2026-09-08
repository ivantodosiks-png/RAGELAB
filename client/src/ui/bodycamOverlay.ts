import type { BodycamSettings } from '@ragelab/shared';
import { el } from './dom';

/**
 * Minimal digital bodycam recording HUD — Axon/Bodycam-footage style chrome.
 */
export class BodycamOverlay {
  readonly root: HTMLElement;
  private readonly rec: HTMLElement;
  private readonly recTimer: HTMLElement;
  private readonly stamp: HTMLElement;
  private readonly camId: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly batteryFill: HTMLElement;
  private readonly camOff: HTMLElement;
  private settings: BodycamSettings;
  private recStartedAt = performance.now();
  private raf = 0;
  private visible = false;
  private camOffActive = false;

  constructor(settings: BodycamSettings) {
    this.settings = { ...settings };
    this.root = el('div', 'bc-overlay');
    this.root.setAttribute('aria-hidden', 'true');

    this.rec = el('div', 'bc-rec');
    this.rec.innerHTML = `<span class="bc-rec-dot"></span><span class="bc-rec-label">REC</span>`;
    this.recTimer = el('span', 'bc-rec-timer', '00:00:00');
    this.rec.append(this.recTimer);

    this.stamp = el('div', 'bc-stamp', '');
    this.camId = el('div', 'bc-cam-id', 'CAM-01 · BODY');

    this.meta = el('div', 'bc-meta');
    this.meta.innerHTML = `<span class="bc-meta-res">1080P 30</span>`;
    const bat = el('span', 'bc-battery');
    bat.innerHTML = `<i class="bc-battery-fill"></i>`;
    this.batteryFill = bat.querySelector('.bc-battery-fill') as HTMLElement;
    this.meta.append(bat);

    this.camOff = el('div', 'bc-cam-off');
    this.camOff.innerHTML =
      `<span class="bc-cam-off-label">CAM OFF</span><span class="bc-cam-off-sub">SIGNAL LOST</span>`;
    this.camOff.hidden = true;

    this.root.append(this.rec, this.stamp, this.camId, this.meta, this.camOff);
    this.apply(settings);
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.syncVisibility();
  }

  /** Freeze recording UI and show CAM OFF (local player death). */
  setCamOff(off: boolean): void {
    this.camOffActive = off;
    this.root.classList.toggle('is-cam-off', off);
    this.camOff.hidden = !off;
    this.rec.classList.toggle('is-off', off);
    const label = this.rec.querySelector('.bc-rec-label');
    if (label) label.textContent = off ? 'OFF' : 'REC';
    if (off) this.stopRecClock();
    else if (this.visible && this.settings.enabled && this.settings.showRec) this.startRecClock();
    this.syncVisibility();
  }

  apply(settings: BodycamSettings): void {
    this.settings = { ...settings };
    this.rec.hidden = !settings.showRec;
    this.meta.hidden = !settings.showMeta;
    this.stamp.hidden = !settings.showMeta;
    this.camId.hidden = !settings.showMeta;
    this.syncVisibility();
  }

  resetRecTimer(): void {
    this.recStartedAt = performance.now();
    this.paintTimer();
    this.batteryFill.style.width = '78%';
  }

  dispose(): void {
    this.stopRecClock();
    this.root.remove();
  }

  private syncVisibility(): void {
    const on = this.visible && this.settings.enabled;
    this.root.classList.toggle('is-on', on);
    if (on && this.settings.showRec && !this.camOffActive) this.startRecClock();
    else this.stopRecClock();
  }

  private startRecClock(): void {
    if (this.raf) return;
    const tick = (): void => {
      this.paintTimer();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopRecClock(): void {
    if (!this.raf) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private paintTimer(): void {
    const now = performance.now();
    const sec = Math.max(0, Math.floor((now - this.recStartedAt) / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    this.recTimer.textContent = `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
    const drain = Math.max(0.12, 0.78 - sec / 16000);
    this.batteryFill.style.width = `${(drain * 100).toFixed(1)}%`;
    this.stamp.textContent = formatBodycamStamp(new Date());
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatBodycamStamp(d: Date): string {
  const y = d.getFullYear();
  const mo = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const h = pad2(d.getHours());
  const m = pad2(d.getMinutes());
  const s = pad2(d.getSeconds());
  return `${y}-${mo}-${day}  ${h}:${m}:${s}`;
}
