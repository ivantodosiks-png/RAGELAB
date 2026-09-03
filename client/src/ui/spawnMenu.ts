import { el } from './dom';
import {
  DEFAULT_SPAWN_ENTRY,
  entriesFor,
  spawnEntryById,
  type SpawnCategory,
  type SpawnEntry,
} from '../sandbox/spawnCatalog';

const TABS: Array<[SpawnCategory, string]> = [
  ['npc', 'NPC'],
  ['props', 'PROPS'],
  ['tools', 'TOOLS'],
  ['weapons', 'WEAPONS'],
];

export class SpawnMenu {
  readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly tabs = new Map<SpawnCategory, HTMLButtonElement>();
  private category: SpawnCategory = 'npc';
  private selectedId = DEFAULT_SPAWN_ENTRY.id;
  private openTimer = 0;

  constructor(host: HTMLElement) {
    this.root = el('div', 'spawn-menu hit');
    this.root.setAttribute('aria-hidden', 'true');

    const panel = el('div', 'spawn-panel');
    const head = el('header', 'spawn-head');
    head.append(el('div', 'spawn-title', 'SPAWN MENU'));
    const close = el('button', 'spawn-close', 'X');
    close.type = 'button';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      this.requestClose();
    });
    head.append(close);

    const tabs = el('nav', 'spawn-tabs');
    for (const [id, label] of TABS) {
      const btn = el('button', 'spawn-tab', label);
      btn.type = 'button';
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        this.setCategory(id);
      });
      this.tabs.set(id, btn);
      tabs.append(btn);
    }

    this.grid = el('div', 'spawn-grid');
    panel.append(head, tabs, this.grid);
    this.root.append(panel);

    this.root.addEventListener('mousedown', (event) => event.stopPropagation());
    this.root.addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.target === this.root) this.requestClose();
    });
    this.root.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    host.append(this.root);
    this.setCategory('npc');
  }

  onSelect: ((entry: SpawnEntry) => void) | null = null;
  onClose: (() => void) | null = null;

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  get selected(): SpawnEntry {
    return spawnEntryById(this.selectedId) ?? DEFAULT_SPAWN_ENTRY;
  }

  open(): void {
    if (this.isOpen) return;
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    window.clearTimeout(this.openTimer);
    this.openTimer = window.setTimeout(() => this.root.classList.add('shown'), 16);
    this.renderGrid();
  }

  close(): void {
    if (!this.root.classList.contains('open')) return;
    this.root.classList.remove('shown');
    window.clearTimeout(this.openTimer);
    this.openTimer = window.setTimeout(() => {
      this.root.classList.remove('open');
      this.root.setAttribute('aria-hidden', 'true');
    }, 160);
  }

  private requestClose(): void {
    if (this.onClose) this.onClose();
    else this.close();
  }

  setSelected(id: string): void {
    if (!spawnEntryById(id)) return;
    this.selectedId = id;
    this.renderGrid();
  }

  private setCategory(category: SpawnCategory): void {
    this.category = category;
    for (const [id, btn] of this.tabs) btn.classList.toggle('active', id === category);
    this.renderGrid();
  }

  private renderGrid(): void {
    this.grid.replaceChildren();
    for (const entry of entriesFor(this.category)) {
      const card = el('button', 'spawn-card');
      card.type = 'button';
      card.classList.toggle('active', entry.id === this.selectedId);
      card.classList.toggle('locked', !entry.spawnable);
      const thumb = el('div', 'spawn-thumb');
      thumb.style.background = `#${entry.swatch.toString(16).padStart(6, '0')}`;
      thumb.append(el('span', '', entry.glyph));
      card.append(thumb, el('div', 'spawn-name', entry.name), el('div', 'spawn-info', entry.info));
      card.addEventListener('click', (event) => {
        event.stopPropagation();
        this.selectedId = entry.id;
        this.onSelect?.(entry);
        this.renderGrid();
      });
      this.grid.append(card);
    }
  }

  dispose(): void {
    window.clearTimeout(this.openTimer);
    this.root.remove();
  }
}
