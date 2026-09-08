import {
  BODY_PART_IDS,
  BODY_PART_LABEL,
  BODY_PART_MAX,
  BODY_PART_CONDITION_LABEL,
  bodyPartCondition,
  cloneBodyParts,
  createFullBodyParts,
  type BodyPartCondition,
  type BodyPartId,
  type BodyPartState,
} from '@ragelab/shared';
import { el } from './dom';

export type BodyStatusMode = 'hud' | 'detail';

const CONDITION_COLOR: Record<BodyPartCondition, string> = {
  healthy: 'rgb(86, 108, 78)',
  damaged: 'rgb(196, 158, 52)',
  critical: 'rgb(176, 58, 48)',
  destroyed: 'rgb(18, 18, 18)',
};

/**
 * Shared limb status — HUD + TAB. Colors are persistent conditions, not timed FX.
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
    if (mode === 'hud') {
      this.root.append(el('div', 'body-status-kicker', 'BODY'));
    }

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
      const panel = el('div', 'body-status-detail');
      panel.append(el('div', 'body-status-detail-title', 'OPERATOR STATUS'));
      this.list = el('ul', 'body-status-list');
      for (const id of BODY_PART_IDS) {
        const row = el('li', 'body-status-row');
        row.dataset.part = id;
        row.append(
          el('span', 'body-status-swatch'),
          el('span', 'body-status-line', `${BODY_PART_LABEL[id]}  ${BODY_PART_MAX[id]}/${BODY_PART_MAX[id]}  ·  OK`),
        );
        this.list.append(row);
        this.rowEls.set(id, row);
      }
      const legend = el('div', 'body-status-legend');
      legend.innerHTML =
        '<span data-c="damaged">Damaged</span>' +
        '<span data-c="critical">Critical</span>' +
        '<span data-c="destroyed">Destroyed</span>';
      panel.append(this.list, legend);
      this.root.append(panel);
    } else {
      this.list = null;
    }

    this.paint(true);
  }

  get state(): BodyPartState {
    return this.parts;
  }

  setParts(parts: BodyPartState, hit?: BodyPartId | null): void {
    this.parts = cloneBodyParts(parts);
    if (hit) {
      this.hitPart = hit;
      this.hitTimer = 0.4;
    }
    this.paint(false);
  }

  reset(): void {
    this.parts = createFullBodyParts();
    this.hitPart = null;
    this.hitTimer = 0;
    this.paint(true);
  }

  tick(dt: number): void {
    if (this.hitTimer <= 0) return;
    this.hitTimer = Math.max(0, this.hitTimer - dt);
    if (this.hitTimer <= 0 && this.hitPart) {
      this.hitPart = null;
      this.paint(false);
    }
  }

  private paint(force: boolean): void {
    const key =
      BODY_PART_IDS.map((id) => `${id}:${this.parts[id]}:${bodyPartCondition(this.parts, id)}`).join('|') +
      `|${this.hitPart ?? ''}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;

    for (const id of BODY_PART_IDS) {
      const condition = bodyPartCondition(this.parts, id);
      const color = CONDITION_COLOR[condition];
      const zone = this.partEls.get(id)!;
      zone.style.background = color;
      zone.dataset.condition = condition;
      zone.classList.toggle('is-hit', this.hitPart === id);
      zone.classList.toggle('is-damaged', condition === 'damaged');
      zone.classList.toggle('is-critical', condition === 'critical');
      zone.classList.toggle('is-destroyed', condition === 'destroyed');

      const row = this.rowEls.get(id);
      if (row) {
        const swatch = row.querySelector('.body-status-swatch') as HTMLElement;
        const line = row.querySelector('.body-status-line') as HTMLElement;
        swatch.style.background = color;
        swatch.dataset.condition = condition;
        const cur = Math.round(this.parts[id]);
        line.textContent = `${BODY_PART_LABEL[id]}  ${cur}/${BODY_PART_MAX[id]}  ·  ${BODY_PART_CONDITION_LABEL[condition]}`;
        row.dataset.condition = condition;
        row.classList.toggle('is-hit', this.hitPart === id);
        row.classList.toggle('is-damaged', condition === 'damaged');
        row.classList.toggle('is-critical', condition === 'critical');
        row.classList.toggle('is-destroyed', condition === 'destroyed');
      }
    }
  }
}
