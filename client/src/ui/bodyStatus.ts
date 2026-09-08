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
  healthy: '#5f7a56',
  damaged: '#c49e34',
  critical: '#b03a30',
  destroyed: '#121212',
};

/** Front-facing tactical operator silhouette — one path per hit zone. */
const PART_PATHS: Record<BodyPartId, string> = {
  head:
    'M47.5 8.5c0-4.2 5.4-7.5 12.5-7.5s12.5 3.3 12.5 7.5c0 1.8-.6 3.4-1.6 4.8 3.2 1.4 5.4 4.2 5.6 7.6.2 4.8-3.6 9-8.8 10.2v3.4H52.3v-3.4c-5.2-1.2-9-5.4-8.8-10.2.2-3.4 2.4-6.2 5.6-7.6-1-1.4-1.6-3-1.6-4.8zm4.2 1.2c1.4 2.8 4.2 4.6 8.3 4.6s6.9-1.8 8.3-4.6c-2.2-1.4-5-2.2-8.3-2.2s-6.1.8-8.3 2.2z',
  chest:
    'M35 42.2c-1.4 0-2.6.8-3.2 2L25.6 56c-.8 1.4-.4 3.2.8 4.2l7.2 5.6c.8.6 1.8.9 2.8.9h47.2c1 0 2-.3 2.8-.9l7.2-5.6c1.2-1 1.6-2.8.8-4.2L88.2 44.2c-.6-1.2-1.8-2-3.2-2H35zm6.5 6.5h37c1.6 0 2.9 1.2 3 2.8l.8 7.4c.2 1.5-1 2.8-2.5 2.8H40.2c-1.5 0-2.7-1.3-2.5-2.8l.8-7.4c.1-1.6 1.4-2.8 3-2.8z',
  stomach:
    'M37 67c0-1.6 1.2-2.9 2.8-3h40.4c1.6.1 2.8 1.4 2.8 3v15.8c0 1.8-1.4 3.2-3.2 3.4H40.2c-1.8-.2-3.2-1.6-3.2-3.4V67zm7.8 4.2c-.7 0-1.3.6-1.3 1.3v7.6c0 .7.6 1.3 1.3 1.3h29c.7 0 1.3-.6 1.3-1.3v-7.6c0-.7-.6-1.3-1.3-1.3h-29z',
  armL:
    'M33.8 43.6c-1.1-.9-2.7-.8-3.7.3L16.4 57.8c-1.5 1.7-1.5 4.3.1 5.9l9.4 9.6c1.1 1.1 2.8 1.3 4.1.5l5.4-3.2c1.5-.9 2-2.8 1.1-4.3l-2.6-4.4c-.4-.7-.3-1.5.2-2.1l6.8-7.4c1.1-1.2 1-3.1-.2-4.2l-6.9-6.6zm-9.4 17.8 5.6-6.1c.5-.6 1.4-.6 1.9 0l1.8 1.8c.5.5.5 1.4 0 1.9l-5.6 6.1c-.5.6-1.4.6-1.9 0l-1.8-1.8c-.5-.5-.5-1.4 0-1.9z',
  armR:
    'M86.2 43.6c1.1-.9 2.7-.8 3.7.3l13.7 13.9c1.5 1.7 1.5 4.3-.1 5.9l-9.4 9.6c-1.1 1.1-2.8 1.3-4.1.5l-5.4-3.2c-1.5-.9-2-2.8-1.1-4.3l2.6-4.4c.4-.7.3-1.5-.2-2.1l-6.8-7.4c-1.1-1.2-1-3.1.2-4.2l6.9-6.6zm9.4 17.8-5.6-6.1c-.5-.6-1.4-.6-1.9 0l-1.8 1.8c-.5.5-.5 1.4 0 1.9l5.6 6.1c.5.6 1.4.6 1.9 0l1.8-1.8c.5-.5.5-1.4 0-1.9z',
  legL:
    'M43.5 86.8c-1.7-.1-3.1 1.1-3.3 2.8L36.8 128c-.3 2.6 1.5 5 4.1 5.4l7.6 1.1c2.4.3 4.6-1.3 5-3.7l3.8-27.4c.2-1.3-.5-2.6-1.7-3.2l-9.4-4.8c-1-.5-2.2-.7-3.3-.6zm1.8 8.6c.4 0 .7.3.7.7l-2.1 26.8c0 .4-.3.7-.7.7h-2c-.4 0-.7-.3-.7-.7l1.9-26.8c0-.4.3-.7.7-.7h2.2z',
  legR:
    'M76.5 86.8c1.7-.1 3.1 1.1 3.3 2.8L83.2 128c.3 2.6-1.5 5-4.1 5.4l-7.6 1.1c-2.4.3-4.6-1.3-5-3.7l-3.8-27.4c-.2-1.3.5-2.6 1.7-3.2l9.4-4.8c1-.5 2.2-.7 3.3-.6zm-1.8 8.6c-.4 0-.7.3-.7.7l2.1 26.8c0 .4.3.7.7.7h2c.4 0 .7-.3.7-.7l-1.9-26.8c0-.4-.3-.7-.7-.7h-2.2z',
};

/**
 * Shared limb status — HUD + TAB. Colors are persistent conditions, not timed FX.
 */
export class BodyStatusView {
  readonly root: HTMLElement;
  private readonly sil: HTMLElement;
  private readonly list: HTMLElement | null;
  private readonly partEls = new Map<BodyPartId, SVGElement>();
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
    this.sil.append(this.buildSvg());
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

  private buildSvg(): SVGSVGElement {
    const uid = `bs${Math.random().toString(36).slice(2, 9)}`;
    const softId = `${uid}-soft`;
    const edgeId = `${uid}-edge`;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 120 140');
    svg.setAttribute('class', 'body-status-svg');
    svg.setAttribute('role', 'img');

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <filter id="${softId}" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-color="#000" flood-opacity="0.45"/>
      </filter>
      <linearGradient id="${edgeId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.25"/>
      </linearGradient>
    `;
    svg.append(defs);

    const under = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    under.setAttribute('cx', '60');
    under.setAttribute('cy', '132');
    under.setAttribute('rx', '28');
    under.setAttribute('ry', '4');
    under.setAttribute('fill', 'rgba(0,0,0,0.35)');
    svg.append(under);

    const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    layer.setAttribute('filter', `url(#${softId})`);

    for (const id of BODY_PART_IDS) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', PART_PATHS[id]);
      path.setAttribute('class', `bs-part bs-${id}`);
      path.dataset.part = id;
      path.setAttribute('stroke', 'rgba(220,226,200,0.28)');
      path.setAttribute('stroke-width', '1.1');
      path.setAttribute('stroke-linejoin', 'round');
      layer.append(path);
      this.partEls.set(id, path);
    }
    svg.append(layer);

    const gloss = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    gloss.setAttribute(
      'd',
      'M46 48h28c1.2 0 2.2.8 2.4 2l.6 5.2c.2 1.2-.6 2.2-1.8 2.4H45c-1.2.2-2.2-.8-2-2l.6-5.6c.2-1.2 1.2-2 2.4-2z',
    );
    gloss.setAttribute('fill', `url(#${edgeId})`);
    gloss.setAttribute('opacity', '0.35');
    gloss.setAttribute('pointer-events', 'none');
    svg.append(gloss);

    return svg;
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
      zone.setAttribute('fill', color);
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
        swatch.style.background = color;
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
