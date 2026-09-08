import {
  BODY_PART_IDS,
  BODY_PART_LABEL_RU,
  BODY_PART_MAX,
  bodyPartRatio,
  cloneBodyParts,
  createFullBodyParts,
  type BodyPartId,
  type BodyPartState,
} from '@ragelab/shared';
import { el } from './dom';

export type BodyStatusMode = 'hud' | 'detail';

/** Olive → amber → red by remaining ratio. */
export function bodyPartFillColor(ratio: number): string {
  const t = Math.max(0, Math.min(1, ratio));
  if (t >= 0.72) return `rgb(${Math.round(72 + (1 - t) * 40)}, ${Math.round(110 + t * 28)}, ${Math.round(70 + t * 18)})`;
  if (t >= 0.38) {
    const u = (t - 0.38) / 0.34;
    return `rgb(${Math.round(190 - u * 40)}, ${Math.round(140 + u * 20)}, ${Math.round(48 + u * 20)})`;
  }
  if (t > 0.02) {
    const u = t / 0.38;
    return `rgb(${Math.round(168 + (1 - u) * 40)}, ${Math.round(48 + u * 60)}, ${Math.round(42 + u * 10)})`;
  }
  return 'rgb(48, 22, 22)';
}

/**
 * Shared limb-HP silhouette used by in-game HUD and TAB inventory.
 * Zones mirror OPERATOR_PART_CAPSULES on the madtrollstudio Soldier mesh
 * (head / chest / stomach / armL / armR / legL / legR).
 */
export class BodyStatusView {
  readonly root: HTMLElement;
  private readonly sil: HTMLElement;
  private readonly list: HTMLElement | null;
  private readonly partEls = new Map<BodyPartId, HTMLElement>();
  private readonly rowEls = new Map<BodyPartId, HTMLElement>();
  private parts: BodyPartState = createFullBodyParts();
  private hitTimer = 0;
  private hitPart: BodyPartId | null = null;
  private lastKey = '';

  constructor(mode: BodyStatusMode) {
    this.root = el('div', `body-status body-status--${mode}`);
    this.sil = el('div', 'body-status-sil');
    this.sil.setAttribute('aria-hidden', 'true');

    for (const id of BODY_PART_IDS) {
      const zone = el('span', `bs-part bs-${id}`);
      zone.dataset.part = id;
      this.sil.append(zone);
      this.partEls.set(id, zone);
    }
    this.root.append(this.sil);

    if (mode === 'detail') {
      this.list = el('ul', 'body-status-list');
      for (const id of BODY_PART_IDS) {
        const row = el('li', 'body-status-row');
        row.dataset.part = id;
        row.append(
          el('span', 'body-status-swatch'),
          el('span', 'body-status-line', `${BODY_PART_LABEL_RU[id]} ${BODY_PART_MAX[id]}/${BODY_PART_MAX[id]} HP`),
        );
        this.list.append(row);
        this.rowEls.set(id, row);
      }
      this.root.append(this.list);
    } else {
      this.list = null;
    }

    this.paint(null, true);
  }

  get state(): BodyPartState {
    return this.parts;
  }

  setParts(parts: BodyPartState, hit?: BodyPartId | null): void {
    this.parts = cloneBodyParts(parts);
    if (hit) {
      this.hitPart = hit;
      this.hitTimer = 0.55;
    }
    this.paint(hit ?? null, false);
  }

  reset(): void {
    this.parts = createFullBodyParts();
    this.hitPart = null;
    this.hitTimer = 0;
    this.paint(null, true);
  }

  tick(dt: number): void {
    if (this.hitTimer <= 0) return;
    this.hitTimer = Math.max(0, this.hitTimer - dt);
    if (this.hitTimer <= 0 && this.hitPart) {
      this.hitPart = null;
      this.paint(null, false);
    }
  }

  private paint(flash: BodyPartId | null, force: boolean): void {
    const key = BODY_PART_IDS.map((id) => `${id}:${Math.round(this.parts[id])}`).join('|') + `|${this.hitPart ?? ''}`;
    if (!force && key === this.lastKey && !flash) return;
    this.lastKey = key;

    for (const id of BODY_PART_IDS) {
      const ratio = bodyPartRatio(this.parts, id);
      const color = bodyPartFillColor(ratio);
      const zone = this.partEls.get(id)!;
      zone.style.background = color;
      zone.style.opacity = ratio <= 0.02 ? '0.35' : '0.92';
      zone.classList.toggle('is-hit', this.hitPart === id);
      zone.classList.toggle('is-critical', ratio > 0 && ratio <= 0.28);
      zone.classList.toggle('is-destroyed', ratio <= 0.02);

      const row = this.rowEls.get(id);
      if (row) {
        const swatch = row.querySelector('.body-status-swatch') as HTMLElement;
        const line = row.querySelector('.body-status-line') as HTMLElement;
        swatch.style.background = color;
        const cur = Math.round(this.parts[id]);
        line.textContent = `${BODY_PART_LABEL_RU[id]} ${cur}/${BODY_PART_MAX[id]} HP`;
        row.classList.toggle('is-hit', this.hitPart === id);
        row.classList.toggle('is-critical', ratio > 0 && ratio <= 0.28);
        row.classList.toggle('is-destroyed', ratio <= 0.02);
      }
    }
  }
}
