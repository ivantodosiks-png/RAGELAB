import type { BodycamSettings } from '@ragelab/shared';
import { el } from './dom';

/**
 * Minimal digital bodycam recording HUD only — no lens circle / dim frame.
 */
export class BodycamOverlay {
  readonly root: HTMLElement;
  private readonly rec: HTMLElement;
  private readonly recTimer: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly batteryFill: HTMLElement;
  private settings: BodycamSettings;
  private recStartedAt = performance.now();
  private raf = 0;
  private visible = false;

  constructor(settings: BodycamSettings) {
    this.settings = { ...settings };
    this.root = el('div', 'bc-overlay');
    this.root.setAttribute('aria-hidden', 'true');

    this.rec = el('div', 'bc-rec');
    this.rec.innerHTML = `<span class="bc-rec-dot"></span><span class="bc-rec-label">REC</span>`;
    this.recTimer = el('span', 'bc-rec-timer', '00:00:00');
    this.rec.append(this.recTimer);

    this.meta = el('div', 'bc-meta');
    this.meta.innerHTML = `<span class="bc-meta-res">1080P 60</span>`;
    const bat = el('span', 'bc-battery');
    bat.innerHTML = `<i class="bc-battery-fill"></i>`;
    this.batteryFill = bat.querySelector('.bc-battery-fill') as HTMLElement;
    this.meta.append(bat);

    this.root.append(this.rec, this.meta);
    this.apply(settings);
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.root.classList.toggle('is-on', on && this.settings.enabled);
    if (on && this.settings.enabled && this.settings.showRec) this.startRecClock();
    else this.stopRecClock();
  }

  apply(settings: BodycamSettings): void {
    this.settings = { ...settings };
    const on = this.visible && settings.enabled;
    this.root.classList.toggle('is-on', on);
    this.rec.hidden = !settings.showRec;
    this.meta.hidden = !settings.showMeta;
    if (on && settings.showRec) this.startRecClock();
    else this.stopRecClock();
  }

  resetRecTimer(): void {
    this.recStartedAt = performance.now();
    this.paintTimer();
    this.batteryFill.style.width = '86%';
  }

  dispose(): void {
    this.stopRecClock();
    this.root.remove();
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
    const sec = Math.max(0, Math.floor((performance.now() - this.recStartedAt) / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    this.recTimer.textContent = `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
    // Slow drain for flavour (resets each match).
    const drain = Math.max(0.18, 0.86 - sec / 20000);
    this.batteryFill.style.width = `${(drain * 100).toFixed(1)}%`;
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
