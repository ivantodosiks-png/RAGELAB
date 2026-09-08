import type { BodycamSettings } from '@ragelab/shared';
import { el } from './dom';

/**
 * Cheap DOM bodycam framing: circular lens hole, dim outside, grain, REC badge.
 * Optical distortion (fisheye / CA) lives in the WebGL pass — no second camera.
 */
export class BodycamOverlay {
  readonly root: HTMLElement;
  private readonly dim: HTMLElement;
  private readonly rim: HTMLElement;
  private readonly grain: HTMLElement;
  private readonly rec: HTMLElement;
  private readonly recTimer: HTMLElement;
  private settings: BodycamSettings;
  private recStartedAt = performance.now();
  private raf = 0;
  private visible = false;

  constructor(settings: BodycamSettings) {
    this.settings = { ...settings };
    this.root = el('div', 'bc-overlay');
    this.root.setAttribute('aria-hidden', 'true');

    this.dim = el('div', 'bc-dim');
    this.rim = el('div', 'bc-rim');
    this.grain = el('div', 'bc-grain');

    this.rec = el('div', 'bc-rec');
    this.rec.innerHTML = `<span class="bc-rec-dot"></span><span class="bc-rec-label">REC</span>`;
    this.recTimer = el('span', 'bc-rec-timer', '00:00:00');
    this.rec.append(this.recTimer);

    this.root.append(this.dim, this.rim, this.grain, this.rec);
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

    const size = `${(settings.lensSize * 100).toFixed(2)}vmin`;
    this.root.style.setProperty('--bc-size', size);
    this.root.style.setProperty('--bc-x', `${(settings.offsetX * 100).toFixed(2)}%`);
    this.root.style.setProperty('--bc-y', `${(settings.offsetY * 100).toFixed(2)}%`);
    this.root.style.setProperty('--bc-dim', String(settings.dimStrength));
    this.root.style.setProperty('--bc-noise', String(settings.noise));
    this.root.style.setProperty('--bc-blur', `${(settings.edgeBlur * 2.4).toFixed(2)}px`);

    this.rec.hidden = !settings.showRec;
    if (on && settings.showRec) this.startRecClock();
    else this.stopRecClock();
  }

  resetRecTimer(): void {
    this.recStartedAt = performance.now();
    this.paintTimer();
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
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
