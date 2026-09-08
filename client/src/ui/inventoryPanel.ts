import {
  AMMO_DEFINITIONS,
  INVENTORY_CONTAINERS,
  MAGAZINE_DEFINITIONS,
  caliberName,
  canPlaceItem,
  getItemFootprint,
  itemPlacement,
  magFillLevel,
  moveInventoryItem,
  normalizeInventoryPlacements,
  type InventoryContainerId,
  type InventoryItem,
  type PlayerInventoryState,
} from '@ragelab/shared';
import { el } from '../ui/dom';
import { magazineIconSvg } from './inventoryIcons';

const CELL = 44;

type DragState = {
  instanceId: string;
  item: InventoryItem;
  fromContainer: InventoryContainerId;
  fromGx: number;
  fromGy: number;
  fromRotated: boolean;
  rotated: boolean;
  grabOx: number;
  grabOy: number;
  ghost: HTMLElement;
};

/**
 * Tarkov-style grid inventory: physical magazine icons, containers, drag & drop.
 */
export class InventoryPanel {
  readonly root: HTMLElement;
  private readonly board: HTMLElement;
  private readonly tip: HTMLElement;
  private open = false;
  private inventory: PlayerInventoryState = { items: [], chambered: {} };
  private drag: DragState | null = null;
  private containerEls = new Map<InventoryContainerId, HTMLElement>();

  /** Called after a successful local move (client applies; online may sync). */
  onMoveItem:
    | ((payload: {
        instanceId: string;
        containerId: InventoryContainerId;
        gx: number;
        gy: number;
        rotated: boolean;
      }) => void)
    | null = null;

  constructor(host: HTMLElement) {
    this.root = el('div', 'inv-panel');
    this.root.hidden = true;
    const card = el('div', 'inv-card');
    card.append(el('div', 'inv-kicker', 'ITEMS'), el('h2', 'inv-title', 'ИНВЕНТАРЬ'));
    card.append(el('p', 'inv-hint', 'ЛКМ — перетащить · R — повернуть'));
    this.board = el('div', 'inv-board');
    this.tip = el('div', 'inv-tip');
    this.tip.hidden = true;
    card.append(this.board);
    this.root.append(card, this.tip);
    host.append(this.root);

    this.root.addEventListener('mousemove', (e) => this.onPointerMove(e));
    this.root.addEventListener('mouseup', (e) => this.onPointerUp(e));
    window.addEventListener('keydown', (e) => {
      if (!this.open || !this.drag) return;
      if (e.code === 'KeyR') {
        this.drag.rotated = !this.drag.rotated;
        this.updateGhostVisual();
        this.onPointerMove(e as unknown as MouseEvent);
        e.preventDefault();
      }
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  setInventory(inv: PlayerInventoryState): void {
    this.inventory = inv;
    normalizeInventoryPlacements(this.inventory);
    if (this.open) this.render();
  }

  toggle(): boolean {
    this.open = !this.open;
    this.root.hidden = !this.open;
    this.root.classList.toggle('open', this.open);
    if (this.open) {
      normalizeInventoryPlacements(this.inventory);
      this.render();
    } else {
      this.cancelDrag();
      this.tip.hidden = true;
    }
    return this.open;
  }

  setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.root.hidden = !open;
    this.root.classList.toggle('open', open);
    if (open) {
      normalizeInventoryPlacements(this.inventory);
      this.render();
    } else {
      this.cancelDrag();
      this.tip.hidden = true;
    }
  }

  private render(): void {
    this.board.replaceChildren();
    this.containerEls.clear();

    const equipped = el('div', 'inv-equipped');
    equipped.append(el('div', 'inv-section-title', 'В ОРУЖИИ'));
    const eqRow = el('div', 'inv-equipped-row');
    const chamberedIds = new Set(Object.values(this.inventory.chambered).filter(Boolean) as string[]);
    for (const [weaponId, magId] of Object.entries(this.inventory.chambered)) {
      if (!magId) continue;
      const item = this.inventory.items.find(
        (i) => i.kind === 'magazine' && i.mag.instanceId === magId,
      );
      if (!item) continue;
      const tile = this.makeTile(item, true);
      tile.prepend(el('div', 'inv-eq-label', weaponId.toUpperCase()));
      eqRow.append(tile);
    }
    if (!eqRow.childElementCount) eqRow.append(el('div', 'inv-empty-note', '—'));
    equipped.append(eqRow);
    this.board.append(equipped);

    const grids = el('div', 'inv-grids');
    for (const layout of INVENTORY_CONTAINERS) {
      const section = el('div', 'inv-section');
      section.append(el('div', 'inv-section-title', layout.label));
      const grid = el('div', 'inv-grid');
      grid.dataset.container = layout.id;
      grid.style.gridTemplateColumns = `repeat(${layout.cols}, ${CELL}px)`;
      grid.style.gridTemplateRows = `repeat(${layout.rows}, ${CELL}px)`;
      grid.style.width = `${layout.cols * CELL}px`;
      grid.style.height = `${layout.rows * CELL}px`;

      for (let i = 0; i < layout.cols * layout.rows; i++) {
        const cell = el('div', 'inv-cell');
        cell.dataset.gx = String(i % layout.cols);
        cell.dataset.gy = String(Math.floor(i / layout.cols));
        grid.append(cell);
      }

      for (const item of this.inventory.items) {
        const p = itemPlacement(item);
        if (p.containerId !== layout.id) continue;
        if (item.kind === 'magazine' && chamberedIds.has(item.mag.instanceId)) continue;
        const tile = this.makeTile(item, false);
        const { w, h } = getItemFootprint(item);
        tile.style.gridColumn = `${p.gx + 1} / span ${w}`;
        tile.style.gridRow = `${p.gy + 1} / span ${h}`;
        grid.append(tile);
      }

      this.containerEls.set(layout.id, grid);
      section.append(grid);
      grids.append(section);
    }
    this.board.append(grids);
  }

  private makeTile(item: InventoryItem, equipped: boolean): HTMLElement {
    const tile = el('button', equipped ? 'inv-tile is-equipped' : 'inv-tile');
    tile.type = 'button';
    const p = itemPlacement(item);
    tile.dataset.instanceId = p.instanceId;

    if (item.kind === 'magazine') {
      const def = MAGAZINE_DEFINITIONS[item.mag.defId];
      const level = magFillLevel(item.mag.currentAmmo, item.mag.capacity);
      const ratio = item.mag.capacity > 0 ? item.mag.currentAmmo / item.mag.capacity : 0;
      const icon = el('div', 'inv-icon');
      icon.innerHTML = magazineIconSvg(def?.icon ?? 'mag_stanag', ratio);
      tile.append(icon);
      tile.append(el('div', `inv-fill-strip ${level}`));
      tile.addEventListener('mouseenter', (e) => {
        if (this.drag) return;
        this.showTip(item, e as MouseEvent);
      });
      tile.addEventListener('mouseleave', () => {
        this.tip.hidden = true;
      });
    } else {
      const def = AMMO_DEFINITIONS[item.ammo.defId];
      const icon = el('div', 'inv-icon');
      icon.innerHTML = magazineIconSvg(def?.icon ?? 'ammo_box', 1);
      tile.append(icon);
      tile.append(el('div', 'inv-ammo-qty', `×${item.ammo.quantity}`));
      tile.addEventListener('mouseenter', (e) => {
        if (this.drag) return;
        this.showTip(item, e as MouseEvent);
      });
      tile.addEventListener('mouseleave', () => {
        this.tip.hidden = true;
      });
    }

    if (!equipped) {
      tile.addEventListener('mousedown', (e) => this.beginDrag(item, e));
    }
    return tile;
  }

  private showTip(item: InventoryItem, e: MouseEvent): void {
    this.tip.hidden = false;
    if (item.kind === 'magazine') {
      const m = item.mag;
      const def = MAGAZINE_DEFINITIONS[m.defId];
      this.tip.innerHTML = `
        <strong>${def?.name ?? 'Magazine'}</strong>
        <div>${caliberName(m.caliber)}</div>
        <div class="inv-tip-row"><span>Capacity</span><b>${m.capacity}</b></div>
        <div class="inv-tip-row"><span>Loaded</span><b>${m.currentAmmo} / ${m.capacity}</b></div>
        <div class="inv-tip-row"><span>Weight</span><b>${(def?.weight ?? 0.3).toFixed(2)} kg</b></div>
        <div class="inv-tip-row"><span>Size</span><b>${def?.width ?? 1}×${def?.height ?? 2}</b></div>
        <div class="inv-tip-compat">${m.compatibleWeapons.join(', ')}</div>`;
    } else {
      const a = item.ammo;
      const def = AMMO_DEFINITIONS[a.defId];
      this.tip.innerHTML = `
        <strong>${def?.name ?? a.caliber}</strong>
        <div class="inv-tip-row"><span>Quantity</span><b>×${a.quantity}</b></div>`;
    }
    this.tip.style.left = `${e.clientX + 14}px`;
    this.tip.style.top = `${e.clientY + 14}px`;
  }

  private beginDrag(item: InventoryItem, e: MouseEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.tip.hidden = true;
    const p = itemPlacement(item);
    const ghost = el('div', 'inv-ghost-drag');
    const cloneIcon = this.makeTile(item, false);
    cloneIcon.style.pointerEvents = 'none';
    ghost.append(cloneIcon);
    document.body.append(ghost);

    this.drag = {
      instanceId: p.instanceId,
      item,
      fromContainer: p.containerId,
      fromGx: p.gx,
      fromGy: p.gy,
      fromRotated: p.rotated,
      rotated: p.rotated,
      grabOx: CELL * 0.5,
      grabOy: CELL * 0.5,
      ghost,
    };

    const src = this.root.querySelector(`[data-instance-id="${p.instanceId}"]`);
    src?.classList.add('is-dragging-src');
    this.updateGhostVisual();
    this.positionGhost(e.clientX, e.clientY);
  }

  private updateGhostVisual(): void {
    if (!this.drag) return;
    const probe: InventoryItem =
      this.drag.item.kind === 'magazine'
        ? { kind: 'magazine', mag: { ...this.drag.item.mag, rotated: this.drag.rotated } }
        : { kind: 'ammo', ammo: { ...this.drag.item.ammo, rotated: this.drag.rotated } };
    const { w, h } = getItemFootprint(probe);
    this.drag.ghost.style.width = `${w * CELL}px`;
    this.drag.ghost.style.height = `${h * CELL}px`;
  }

  private positionGhost(x: number, y: number): void {
    if (!this.drag) return;
    this.drag.ghost.style.left = `${x - this.drag.grabOx}px`;
    this.drag.ghost.style.top = `${y - this.drag.grabOy}px`;
  }

  private onPointerMove(e: MouseEvent): void {
    if (this.tip && !this.tip.hidden && !this.drag) {
      this.tip.style.left = `${e.clientX + 14}px`;
      this.tip.style.top = `${e.clientY + 14}px`;
    }
    if (!this.drag) return;
    this.positionGhost(e.clientX, e.clientY);
    const hit = this.hitTest(e.clientX, e.clientY);
    this.clearHighlights();
    if (!hit) {
      this.drag.ghost.classList.add('is-invalid');
      this.drag.ghost.classList.remove('is-valid');
      return;
    }
    const ok = canPlaceItem(
      this.inventory,
      this.drag.item,
      hit.containerId,
      hit.gx,
      hit.gy,
      this.drag.rotated,
      this.drag.instanceId,
    );
    this.drag.ghost.classList.toggle('is-valid', ok);
    this.drag.ghost.classList.toggle('is-invalid', !ok);
    this.highlightPlacement(hit.containerId, hit.gx, hit.gy, ok);
  }

  private onPointerUp(e: MouseEvent): void {
    if (!this.drag) return;
    const drag = this.drag;
    const hit = this.hitTest(e.clientX, e.clientY);
    let moved = false;
    if (hit) {
      moved = moveInventoryItem(
        this.inventory,
        drag.instanceId,
        hit.containerId,
        hit.gx,
        hit.gy,
        drag.rotated,
      );
      if (moved) {
        this.onMoveItem?.({
          instanceId: drag.instanceId,
          containerId: hit.containerId,
          gx: hit.gx,
          gy: hit.gy,
          rotated: drag.rotated,
        });
      }
    }
    this.cancelDrag();
    this.render();
    void moved;
  }

  private hitTest(
    clientX: number,
    clientY: number,
  ): { containerId: InventoryContainerId; gx: number; gy: number } | null {
    if (!this.drag) return null;
    for (const layout of INVENTORY_CONTAINERS) {
      const grid = this.containerEls.get(layout.id);
      if (!grid) continue;
      const rect = grid.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        continue;
      }
      const probe: InventoryItem =
        this.drag.item.kind === 'magazine'
          ? { kind: 'magazine', mag: { ...this.drag.item.mag, rotated: this.drag.rotated } }
          : { kind: 'ammo', ammo: { ...this.drag.item.ammo, rotated: this.drag.rotated } };
      const { w, h } = getItemFootprint(probe);
      let gx = Math.floor((clientX - rect.left) / CELL);
      let gy = Math.floor((clientY - rect.top) / CELL);
      gx = Math.max(0, Math.min(layout.cols - w, gx));
      gy = Math.max(0, Math.min(layout.rows - h, gy));
      return { containerId: layout.id, gx, gy };
    }
    return null;
  }

  private highlightPlacement(
    containerId: InventoryContainerId,
    gx: number,
    gy: number,
    ok: boolean,
  ): void {
    if (!this.drag) return;
    const grid = this.containerEls.get(containerId);
    if (!grid) return;
    const probe: InventoryItem =
      this.drag.item.kind === 'magazine'
        ? { kind: 'magazine', mag: { ...this.drag.item.mag, rotated: this.drag.rotated } }
        : { kind: 'ammo', ammo: { ...this.drag.item.ammo, rotated: this.drag.rotated } };
    const { w, h } = getItemFootprint(probe);
    for (const cell of grid.querySelectorAll('.inv-cell')) {
      const cx = Number((cell as HTMLElement).dataset.gx);
      const cy = Number((cell as HTMLElement).dataset.gy);
      if (cx >= gx && cx < gx + w && cy >= gy && cy < gy + h) {
        cell.classList.add(ok ? 'is-valid' : 'is-invalid');
      }
    }
  }

  private clearHighlights(): void {
    for (const grid of this.containerEls.values()) {
      for (const cell of grid.querySelectorAll('.inv-cell')) {
        cell.classList.remove('is-valid', 'is-invalid');
      }
    }
  }

  private cancelDrag(): void {
    if (this.drag) {
      this.drag.ghost.remove();
      this.drag = null;
    }
    this.clearHighlights();
    for (const node of this.root.querySelectorAll('.is-dragging-src')) {
      node.classList.remove('is-dragging-src');
    }
  }
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
