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
  healthy: 'transparent',
  damaged: 'rgba(196, 158, 52, 0.72)',
  critical: 'rgba(176, 58, 48, 0.78)',
  destroyed: 'rgba(8, 8, 8, 0.88)',
};

const CONDITION_SWATCH: Record<BodyPartCondition, string> = {
  healthy: '#5f7a56',
  damaged: '#c49e34',
  critical: '#b03a30',
  destroyed: '#121212',
};

const BASE = `${import.meta.env.BASE_URL}hud/body`;
const BODY_ASSET_VER = '2';

function partUrl(id: string): string {
  return `${BASE}/${id}.png?v=${BODY_ASSET_VER}`;
}

/**
 * Shared limb status — HUD + TAB.
 * Silhouette is cut from assets/hud/ud.png and reassembled into hit zones.
 */
export class BodyStatusView {
  readonly root: HTMLElement;
  private readonly sil: HTMLElement;
  private readonly list: HTMLElement | null;
  private readonly partEls = new Map<BodyPartId, HTMLElement>();
  private readonly tintEls = new Map<BodyPartId, HTMLElement>();
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
    this.sil.append(this.buildFigure());
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
          el('span', 'body-status-name', BODY_PART_LABEL[id]),
          el('span', 'body-status-hp', `${BODY_PART_MAX[id]}/${BODY_PART_MAX[id]}`),
          el('span', 'body-status-state', 'OK'),
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

  private buildFigure(): HTMLElement {
    const figure = el('div', 'body-status-figure');
    // Stack zones: legs under torso under arms under head for clean overlaps.
    const order: BodyPartId[] = [
      'legL',
      'legR',
      'stomach',
      'chest',
      'armL',
      'armR',
      'head',
    ];
    for (const id of order) {
      const part = el('div', `bs-part bs-${id}`);
      part.dataset.part = id;
      const tex = document.createElement('img');
      tex.className = 'bs-tex';
      tex.src = partUrl(id);
      tex.alt = '';
      tex.draggable = false;
      const tint = el('span', 'bs-tint');
      const mask = `url(${partUrl(id)})`;
      part.style.setProperty('--bs-mask', mask);
      tint.style.setProperty('--bs-mask', mask);
      part.append(tex, tint);
      figure.append(part);
      this.partEls.set(id, part);
      this.tintEls.set(id, tint);
    }
    return figure;
  }

  private paint(force: boolean): void {
    const key =
      BODY_PART_IDS.map((id) => `${id}:${this.parts[id]}:${bodyPartCondition(this.parts, id)}`).join('|') +
      `|${this.hitPart ?? ''}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;

    for (const id of BODY_PART_IDS) {
      const condition = bodyPartCondition(this.parts, id);
      const zone = this.partEls.get(id)!;
      const tint = this.tintEls.get(id)!;
      tint.style.background = CONDITION_COLOR[condition];
      zone.dataset.condition = condition;
      zone.classList.toggle('is-hit', this.hitPart === id);
      zone.classList.toggle('is-damaged', condition === 'damaged');
      zone.classList.toggle('is-critical', condition === 'critical');
      zone.classList.toggle('is-destroyed', condition === 'destroyed');

      const row = this.rowEls.get(id);
      if (row) {
        const swatch = row.querySelector('.body-status-swatch') as HTMLElement;
        const hp = row.querySelector('.body-status-hp') as HTMLElement;
        const state = row.querySelector('.body-status-state') as HTMLElement;
        swatch.style.background = CONDITION_SWATCH[condition];
        swatch.dataset.condition = condition;
        const cur = Math.round(this.parts[id]);
        hp.textContent = `${cur}/${BODY_PART_MAX[id]}`;
        state.textContent = BODY_PART_CONDITION_LABEL[condition];
        row.dataset.condition = condition;
        row.classList.toggle('is-hit', this.hitPart === id);
        row.classList.toggle('is-damaged', condition === 'damaged');
        row.classList.toggle('is-critical', condition === 'critical');
        row.classList.toggle('is-destroyed', condition === 'destroyed');
      }
    }
  }
}
