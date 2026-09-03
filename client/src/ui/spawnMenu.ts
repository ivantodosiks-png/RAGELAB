import { el } from './dom';
import {
  DEFAULT_SPAWN_ENTRY,
  NPC_MENU_ENABLED,
  SPAWN_CATALOG,
  entriesFor,
  isPropCategory,
  propKindFromEntry,
  spawnEntryById,
  type SpawnCategory,
  type SpawnEntry,
} from '../sandbox/spawnCatalog';
import { propIconUrl, warmupPropIcons } from '../sandbox/propIcons';

const TABS: Array<[SpawnCategory, string]> = [
  ['npc', 'NPC'],
  ['props', 'PROPS'],
  ['fun', 'FUN'],
  ['physics', 'PHYSICS'],
  ['interactive', 'INTERACTIVE'],
  ['tools', 'TOOLS'],
  ['weapons', 'WEAPONS'],
];

const CATEGORY_LABEL: Record<SpawnCategory, string> = {
  npc: 'NPC',
  props: 'PROP',
  fun: 'FUN',
  physics: 'PHYSICS',
  interactive: 'GADGET',
  tools: 'TOOL',
  weapons: 'WEAPON',
};

export class SpawnMenu {
  readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly notice: HTMLElement;
  private readonly confirm: HTMLElement;
  private readonly tabs = new Map<SpawnCategory, HTMLButtonElement>();
  private readonly cards = new Map<string, HTMLButtonElement>();
  private category: SpawnCategory = NPC_MENU_ENABLED ? 'npc' : 'props';
  private selectedId = DEFAULT_SPAWN_ENTRY.id;
  private query = '';
  private openTimer = 0;
  private gridKey = '';

  constructor(host: HTMLElement) {
    this.root = el('div', 'spawn-menu hit');
    this.root.setAttribute('aria-hidden', 'true');

    const panel = el('div', 'spawn-panel');
    const head = el('header', 'spawn-head');
    const titles = el('div', 'spawn-head-copy');
    titles.append(el('div', 'spawn-title', 'SPAWN MENU'), el('div', 'spawn-sub', 'Tool Gun · pick something chaotic'));
    const close = el('button', 'spawn-close', 'X');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close spawn menu');
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      this.requestClose();
    });
    head.append(titles, close);

    const tabs = el('nav', 'spawn-tabs');
    for (const [id, label] of TABS) {
      if (id === 'npc' && !NPC_MENU_ENABLED) continue;
      const btn = el('button', 'spawn-tab', label);
      btn.type = 'button';
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        this.setCategory(id);
      });
      this.tabs.set(id, btn);
      tabs.append(btn);
    }

    const tools = el('div', 'spawn-tools');
    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.className = 'spawn-search';
    this.search.placeholder = 'Search props, fun, physics…';
    this.search.autocomplete = 'off';
    this.search.addEventListener('input', () => {
      this.query = this.search.value.trim().toLowerCase();
      this.renderGrid();
    });
    this.search.addEventListener('keydown', (event) => event.stopPropagation());
    tools.append(this.search);

    this.notice = el('div', 'spawn-notice', 'Weapons are not spawnable with Tool Gun');
    this.notice.hidden = true;

    this.grid = el('div', 'spawn-grid');

    const foot = el('footer', 'spawn-foot');
    const clear = el('button', 'spawn-clear', 'Clear Scene');
    clear.type = 'button';
    clear.addEventListener('click', (event) => {
      event.stopPropagation();
      this.showConfirm(true);
    });
    foot.append(el('span', 'spawn-foot-hint', 'X to close · selection stays active'), clear);

    this.confirm = el('div', 'spawn-confirm');
    this.confirm.hidden = true;
    this.confirm.append(
      el('p', '', 'Clear entire scene? NPCs, props and sandbox weapons will be removed.'),
    );
    const row = el('div', 'spawn-confirm-row');
    const cancel = el('button', 'spawn-ghost', 'Cancel');
    const yes = el('button', 'spawn-danger', 'Clear');
    cancel.type = 'button';
    yes.type = 'button';
    cancel.addEventListener('click', (event) => {
      event.stopPropagation();
      this.showConfirm(false);
    });
    yes.addEventListener('click', (event) => {
      event.stopPropagation();
      this.showConfirm(false);
      this.onClearScene?.();
    });
    row.append(cancel, yes);
    this.confirm.append(row);

    panel.append(head, tabs, tools, this.notice, this.grid, foot, this.confirm);
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
    this.setCategory(NPC_MENU_ENABLED ? 'npc' : 'props');
  }

  onSelect: ((entry: SpawnEntry) => void) | null = null;
  onClose: (() => void) | null = null;
  onClearScene: (() => void) | null = null;

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  get selected(): SpawnEntry {
    return spawnEntryById(this.selectedId) ?? DEFAULT_SPAWN_ENTRY;
  }

  open(): void {
    if (this.isOpen) return;
    this.showConfirm(false);
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    window.clearTimeout(this.openTimer);
    this.openTimer = window.setTimeout(() => this.root.classList.add('shown'), 16);
    window.addEventListener('keydown', this.onKey, true);
    warmupPropIcons();
    this.renderGrid();
  }

  close(): void {
    if (!this.root.classList.contains('open')) return;
    this.root.classList.remove('shown');
    this.showConfirm(false);
    this.search.blur();
    window.removeEventListener('keydown', this.onKey, true);
    window.clearTimeout(this.openTimer);
    this.openTimer = window.setTimeout(() => {
      this.root.classList.remove('open');
      this.root.setAttribute('aria-hidden', 'true');
    }, 180);
  }

  private requestClose(): void {
    if (this.onClose) this.onClose();
    else this.close();
  }

  setSelected(id: string): void {
    const entry = spawnEntryById(id);
    if (!entry) return;
    if (entry.category === 'npc' && !NPC_MENU_ENABLED) return;
    this.selectedId = id;
    this.highlight();
  }

  private setCategory(category: SpawnCategory): void {
    this.category = category;
    for (const [id, btn] of this.tabs) btn.classList.toggle('active', id === category);
    this.notice.hidden = category !== 'weapons';
    this.renderGrid();
  }

  private renderGrid(): void {
    const pool = this.query
      ? SPAWN_CATALOG.filter((entry) => entry.category !== 'npc' || NPC_MENU_ENABLED)
      : entriesFor(this.category);
    const entries = pool.filter((entry) => matchesQuery(entry, this.query));
    const key = `${this.category}|${this.query}|${entries.map((e) => e.id).join(',')}`;
    if (key === this.gridKey) {
      this.highlight();
      return;
    }
    this.gridKey = key;
    this.cards.clear();
    this.grid.replaceChildren();
    if (entries.length === 0) {
      this.grid.append(el('div', 'spawn-empty', 'No objects match that search.'));
      return;
    }
    for (const entry of entries) {
      const card = el('button', 'spawn-card');
      card.type = 'button';
      card.classList.toggle('locked', !entry.spawnable);
      const thumb = el('div', 'spawn-thumb');
      const kind = isPropCategory(entry.category) ? propKindFromEntry(entry.id) : null;
      if (kind) {
        const img = document.createElement('img');
        img.className = 'spawn-thumb-img';
        img.alt = entry.name;
        img.draggable = false;
        img.src = propIconUrl(kind);
        thumb.append(img);
      } else {
        thumb.style.background = `#${entry.swatch.toString(16).padStart(6, '0')}`;
        thumb.append(el('span', '', entry.glyph));
      }
      card.append(
        thumb,
        el('div', 'spawn-cat', CATEGORY_LABEL[entry.category]),
        el('div', 'spawn-name', entry.name),
        el('div', 'spawn-info', entry.info),
      );
      card.addEventListener('click', (event) => {
        event.stopPropagation();
        this.selectedId = entry.id;
        this.onSelect?.(entry);
        this.highlight();
      });
      this.cards.set(entry.id, card);
      this.grid.append(card);
    }
    this.highlight();
  }

  private highlight(): void {
    for (const [id, card] of this.cards) {
      card.classList.toggle('active', id === this.selectedId);
    }
  }

  private showConfirm(open: boolean): void {
    this.confirm.hidden = !open;
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (event.code !== 'KeyX' && event.code !== 'Escape') return;
    if (event.code === 'KeyX' && isTypingTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    this.requestClose();
  };

  dispose(): void {
    window.clearTimeout(this.openTimer);
    window.removeEventListener('keydown', this.onKey, true);
    this.root.remove();
  }
}

function matchesQuery(entry: SpawnEntry, query: string): boolean {
  if (!query) return true;
  return (
    entry.name.toLowerCase().includes(query) ||
    entry.info.toLowerCase().includes(query) ||
    entry.category.includes(query) ||
    entry.glyph.toLowerCase().includes(query)
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}
