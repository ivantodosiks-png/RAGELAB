import {
  CALIBERS,
  MAGAZINE_DEFINITIONS,
  caliberName,
  magFillLevel,
  type InventoryItem,
  type PlayerInventoryState,
} from '@ragelab/shared';
import { el } from '../ui/dom';

const CELL = 38;
const RIG_COLS = 4;
const RIG_ROWS = 6;
const POCKET_COLS = 4;
const POCKET_ROWS = 1;
const PACK_COLS = 5;
const PACK_ROWS = 4;

/**
 * Compact Tarkov-like field inventory (TAB).
 * Magazines use physical grid size: pistols 1×1, rifles 1×2.
 */
export class InventoryPanel {
  readonly root: HTMLElement;
  private readonly board: HTMLElement;
  private readonly tip: HTMLElement;
  private open = false;
  private inventory: PlayerInventoryState = { items: [], chambered: {} };

  constructor(host: HTMLElement) {
    this.root = el('div', 'inv-panel');
    this.root.hidden = true;
    const card = el('div', 'inv-card');
    card.append(el('div', 'inv-kicker', 'ITEMS'), el('h2', 'inv-title', 'ИНВЕНТАРЬ'));
    this.board = el('div', 'inv-board');
    this.tip = el('div', 'inv-tip');
    this.tip.hidden = true;
    card.append(this.board);
    this.root.append(card, this.tip);
    host.append(this.root);

    this.root.addEventListener('mousemove', (e) => {
      if (this.tip.hidden) return;
      this.tip.style.left = `${e.clientX + 12}px`;
      this.tip.style.top = `${e.clientY + 12}px`;
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  setInventory(inv: PlayerInventoryState): void {
    this.inventory = inv;
    if (this.open) this.render();
  }

  toggle(): boolean {
    this.open = !this.open;
    this.root.hidden = !this.open;
    this.root.classList.toggle('open', this.open);
    if (this.open) this.render();
    else this.tip.hidden = true;
    return this.open;
  }

  setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.root.hidden = !open;
    this.root.classList.toggle('open', open);
    if (open) this.render();
    else this.tip.hidden = true;
  }

  private render(): void {
    this.board.replaceChildren();

    const chamberedIds = new Set(Object.values(this.inventory.chambered).filter(Boolean) as string[]);
    const mags = this.inventory.items.filter((i) => i.kind === 'magazine');
    const ammo = this.inventory.items.filter((i) => i.kind === 'ammo');
    const spareMags = mags.filter((i) => i.kind === 'magazine' && !chamberedIds.has(i.mag.instanceId));
    const pocketItems: InventoryItem[] = [...spareMags.slice(8, 12), ...ammo.slice(0, 2)];
    const packItems: InventoryItem[] = [...ammo, ...spareMags.slice(12)];

    const left = el('div', 'inv-col');
    left.append(this.section('ОРУЖИЕ / CHAMBERED', this.chamberedCells(), 2, 3));
    left.append(this.section('РАЗГРУЗКА', this.packCells(spareMags.slice(0, 8)), RIG_COLS, RIG_ROWS));
    left.append(this.section('КАРМАНЫ', this.packCells(pocketItems), POCKET_COLS, POCKET_ROWS));

    const right = el('div', 'inv-col');
    right.append(this.section('РЮКЗАК', this.packCells(packItems), PACK_COLS, PACK_ROWS));

    this.board.append(left, right);
  }

  private chamberedCells(): HTMLElement[] {
    const cells: HTMLElement[] = [];
    for (const [weaponId, magId] of Object.entries(this.inventory.chambered)) {
      if (!magId) continue;
      const magItem = this.inventory.items.find(
        (i) => i.kind === 'magazine' && i.mag.instanceId === magId,
      );
      if (!magItem) continue;
      const card = this.cardFor(magItem);
      card.classList.add('chambered');
      card.prepend(el('div', 'inv-badge', weaponId.toUpperCase()));
      cells.push(card);
    }
    return cells;
  }

  private packCells(items: InventoryItem[]): HTMLElement[] {
    return items.map((item) => this.cardFor(item));
  }

  private section(title: string, items: HTMLElement[], cols: number, rows: number): HTMLElement {
    const block = el('div', 'inv-section');
    block.append(el('div', 'inv-section-title', title));
    const grid = el('div', 'inv-grid-slots');
    grid.style.gridTemplateColumns = `repeat(${cols}, ${CELL}px)`;
    grid.style.gridAutoRows = `${CELL}px`;
    grid.style.minHeight = `${rows * CELL}px`;
    // Ghost cells for Tarkov feel
    for (let i = 0; i < cols * rows; i++) {
      const ghost = el('div', 'inv-ghost');
      ghost.style.gridColumn = `${(i % cols) + 1}`;
      ghost.style.gridRow = `${Math.floor(i / cols) + 1}`;
      grid.append(ghost);
    }
    // Simple left-to-right packing
    let cursor = 0;
    const occupied = new Set<number>();
    const mark = (c: number, r: number, w: number, h: number): boolean => {
      if (c + w > cols || r + h > rows) return false;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (occupied.has((r + y) * cols + (c + x))) return false;
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) occupied.add((r + y) * cols + (c + x));
      }
      return true;
    };
    for (const item of items) {
      const w = Number(item.style.getPropertyValue('--gw') || 1);
      const h = Number(item.style.getPropertyValue('--gh') || 1);
      let placed = false;
      for (let i = 0; i < cols * rows; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        if (mark(c, r, w, h)) {
          item.style.gridColumn = `${c + 1} / span ${w}`;
          item.style.gridRow = `${r + 1} / span ${h}`;
          grid.append(item);
          placed = true;
          cursor = i + 1;
          break;
        }
      }
      if (!placed) {
        // Overflow strip below
        item.style.gridColumn = `1 / span ${Math.min(w, cols)}`;
        grid.append(item);
      }
    }
    void cursor;
    block.append(grid);
    return block;
  }

  private cardFor(item: InventoryItem): HTMLElement {
    const card = el('button', 'inv-item');
    card.type = 'button';
    if (item.kind === 'magazine') {
      const m = item.mag;
      const def = MAGAZINE_DEFINITIONS[m.defId];
      const w = def?.width ?? 1;
      const h = def?.height ?? 2;
      card.style.setProperty('--gw', String(w));
      card.style.setProperty('--gh', String(h));
      const level = magFillLevel(m.currentAmmo, m.capacity);
      const ammoText = m.currentAmmo <= 0 ? 'EMPTY' : `${m.currentAmmo}/${m.capacity}`;
      card.append(
        el('div', 'inv-item-kind', 'MAG'),
        el('div', 'inv-item-name', shortName(def?.name ?? 'Mag')),
        el('div', 'inv-item-meta', caliberName(m.caliber)),
        el('div', `inv-item-ammo ${level}`, ammoText),
        el('div', `inv-fill ${level}`),
      );
      card.addEventListener('mouseenter', () => {
        this.tip.hidden = false;
        this.tip.innerHTML = `
          <strong>MAGAZINE</strong><br/>
          ${def?.name ?? 'Magazine'}<br/>
          Caliber: ${caliberName(m.caliber)}<br/>
          ${m.currentAmmo} / ${m.capacity}<br/>
          Size: ${w}×${h}<br/>
          ${m.compatibleWeapons.join(', ')}
        `;
      });
      card.addEventListener('mouseleave', () => {
        this.tip.hidden = true;
      });
    } else {
      const a = item.ammo;
      const name = CALIBERS[a.caliber]?.name ?? a.caliber;
      card.style.setProperty('--gw', '1');
      card.style.setProperty('--gh', '1');
      card.append(
        el('div', 'inv-item-kind', 'AMMO'),
        el('div', 'inv-item-name', shortName(name)),
        el('div', 'inv-item-meta', a.caliber),
        el('div', 'inv-item-ammo high', `×${a.quantity}`),
      );
      card.addEventListener('mouseenter', () => {
        this.tip.hidden = false;
        this.tip.innerHTML = `<strong>AMMO</strong><br/>${name}<br/>×${a.quantity}`;
      });
      card.addEventListener('mouseleave', () => {
        this.tip.hidden = true;
      });
    }
    return card;
  }
}

function shortName(name: string): string {
  return name.length > 14 ? `${name.slice(0, 13)}…` : name;
}

export function approxAmmoBars(level: ReturnType<typeof magFillLevel>): string {
  switch (level) {
    case 'full':
      return '████████';
    case 'high':
      return '██████░░';
    case 'medium':
      return '████░░░░';
    case 'low':
      return '██░░░░░░';
    case 'empty':
      return '░░░░░░░░';
  }
}

export { magFillLevel };
