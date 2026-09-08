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
  type BodyPartId,
  type BodyPartState,
  type InventoryContainerId,
  type InventoryItem,
  type PlayerInventoryState,
} from '@ragelab/shared';
import { el } from '../ui/dom';
import { itemIconHtml } from './inventoryIcons';
import { BodyStatusView } from './bodyStatus';

/** Base cell size in px — scaled via CSS --inv-cell on smaller screens. */
const CELL = 52;

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

type EquipSlotDef = {
  id: string;
  label: string;
  /** CSS grid placement class */
  cls: string;
};

const EQUIP_SLOTS: EquipSlotDef[] = [
  { id: 'head', label: 'HEAD', cls: 'inv-eq-slot--head' },
  { id: 'face', label: 'FACE', cls: 'inv-eq-slot--face' },
  { id: 'armor', label: 'ARMOR', cls: 'inv-eq-slot--armor' },
  { id: 'backpack', label: 'PACK', cls: 'inv-eq-slot--pack' },
  { id: 'weapon', label: 'WEAPON', cls: 'inv-eq-slot--weapon' },
  { id: 'holster', label: 'HOLSTER', cls: 'inv-eq-slot--holster' },
];

/**
 * Fullscreen tactical inventory: character + equipment left, grids right.
 */
export class InventoryPanel {
  readonly root: HTMLElement;
  private readonly shell: HTMLElement;
  private readonly tip: HTMLElement;
  private open = false;
  private inventory: PlayerInventoryState = { items: [], chambered: {} };
  private drag: DragState | null = null;
  private containerEls = new Map<InventoryContainerId, HTMLElement>();
  private lastPointerX = 0;
  private lastPointerY = 0;
  private bodyView: BodyStatusView | null = null;
  private pendingParts: BodyPartState | null = null;
  private pendingHit: BodyPartId | null = null;

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
    this.shell = el('div', 'inv-shell');
    this.tip = el('div', 'inv-tip');
    this.tip.hidden = true;
    this.root.append(this.shell, this.tip);
    host.append(this.root);

    this.root.addEventListener('mousemove', (e) => this.onPointerMove(e));
    this.root.addEventListener('mouseup', (e) => this.onPointerUp(e));
    window.addEventListener('mousemove', (e) => {
      if (!this.drag) return;
      this.onPointerMove(e);
    });
    window.addEventListener('mouseup', (e) => {
      if (!this.drag) return;
      this.onPointerUp(e);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.open || !this.drag) return;
      if (e.code === 'KeyR') {
        this.drag.rotated = !this.drag.rotated;
        this.updateGhostVisual();
        this.syncDragPreview(this.lastPointerX, this.lastPointerY);
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

  setBodyParts(parts: BodyPartState, hit?: BodyPartId | null): void {
    this.pendingParts = parts;
    this.pendingHit = hit ?? null;
    if (this.bodyView) this.bodyView.setParts(parts, hit);
  }

  resetBodyParts(): void {
    this.bodyView?.reset();
    this.pendingParts = null;
    this.pendingHit = null;
  }

  toggle(): boolean {
    this.setOpen(!this.open);
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

  private cellSize(): number {
    const raw = getComputedStyle(this.root).getPropertyValue('--inv-cell').trim();
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : CELL;
  }

  private render(): void {
    this.shell.replaceChildren();
    this.containerEls.clear();

    const header = el('div', 'inv-header');
    header.innerHTML = `
      <div class="inv-header-left">
        <span class="inv-kicker">GEAR</span>
        <h2 class="inv-title">INVENTORY</h2>
      </div>
      <p class="inv-hint">LMB drag · R rotate · TAB close</p>`;
    this.shell.append(header);

    const layout = el('div', 'inv-layout');
    layout.append(this.buildCharacterColumn(), this.buildInventoryColumn());
    this.shell.append(layout);
  }

  private buildCharacterColumn(): HTMLElement {
    const col = el('div', 'inv-col inv-col--char');
    col.append(el('div', 'inv-col-label', 'BODY STATUS'));

    const stage = el('div', 'inv-char-stage');

    for (const slot of EQUIP_SLOTS) {
      const box = el('div', `inv-eq-slot ${slot.cls}`);
      box.innerHTML = `<span class="inv-eq-slot-label">${slot.label}</span><span class="inv-eq-slot-empty"></span>`;
      stage.append(box);
    }

    const figure = el('div', 'inv-figure inv-figure--body');
    this.bodyView = new BodyStatusView('detail');
    if (this.pendingParts) this.bodyView.setParts(this.pendingParts, this.pendingHit);
    figure.append(this.bodyView.root);
    stage.append(figure);

    col.append(stage);

    return col;
  }

  private buildInventoryColumn(): HTMLElement {
    const col = el('div', 'inv-col inv-col--gear');
    col.append(el('div', 'inv-col-label', 'STORAGE'));

    const backpack = INVENTORY_CONTAINERS.find((c) => c.id === 'backpack');
    const rig = INVENTORY_CONTAINERS.find((c) => c.id === 'rig');
    const pockets = INVENTORY_CONTAINERS.find((c) => c.id === 'pockets');

    if (backpack) col.append(this.buildGridSection(backpack));

    const lower = el('div', 'inv-lower-grids');
    if (rig) lower.append(this.buildGridSection(rig));
    if (pockets) lower.append(this.buildGridSection(pockets));
    col.append(lower);

    return col;
  }

  private buildGridSection(layout: (typeof INVENTORY_CONTAINERS)[number]): HTMLElement {
    const section = el('div', `inv-section inv-section--${layout.id}`);
    section.append(el('div', 'inv-section-head', layout.label));

    const cell = this.cellSize();
    const grid = el('div', 'inv-grid');
    grid.dataset.container = layout.id;
    grid.style.setProperty('--cols', String(layout.cols));
    grid.style.setProperty('--rows', String(layout.rows));
    grid.style.gridTemplateColumns = `repeat(${layout.cols}, ${cell}px)`;
    grid.style.gridTemplateRows = `repeat(${layout.rows}, ${cell}px)`;
    grid.style.width = `${layout.cols * cell}px`;
    grid.style.height = `${layout.rows * cell}px`;

    for (let i = 0; i < layout.cols * layout.rows; i++) {
      const c = el('div', 'inv-cell');
      c.dataset.gx = String(i % layout.cols);
      c.dataset.gy = String(Math.floor(i / layout.cols));
      grid.append(c);
    }

    const chamberedIds = new Set(Object.values(this.inventory.chambered).filter(Boolean) as string[]);
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
    return section;
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
      icon.innerHTML = itemIconHtml(def?.icon ?? 'mag_stanag');
      tile.append(icon);
      const fill = el('div', `inv-fill ${level}`);
      fill.style.setProperty('--fill', String(ratio));
      tile.append(fill);
    } else {
      const def = AMMO_DEFINITIONS[item.ammo.defId];
      const icon = el('div', 'inv-icon');
      icon.innerHTML = itemIconHtml(def?.icon ?? 'ammo_box');
      tile.append(icon);
      tile.append(el('div', 'inv-ammo-qty', `×${item.ammo.quantity}`));
    }

    tile.addEventListener('mouseenter', (e) => {
      if (this.drag) return;
      this.showTip(item, e as MouseEvent);
    });
    tile.addEventListener('mouseleave', () => {
      this.tip.hidden = true;
    });

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
        <div class="inv-tip-cal">${caliberName(m.caliber)}</div>
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
        <div class="inv-tip-cal">${caliberName(a.caliber)}</div>
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
    const cell = this.cellSize();
    const ghost = el('div', 'inv-ghost-drag');
    const cloneIcon = this.makeTile(item, false);
    cloneIcon.style.pointerEvents = 'none';
    ghost.append(cloneIcon);
    document.body.append(ghost);

    const src = this.root.querySelector(`[data-instance-id="${p.instanceId}"]`) as HTMLElement | null;
    const srcRect = src?.getBoundingClientRect();
    const grabOx = srcRect ? e.clientX - srcRect.left : cell * 0.5;
    const grabOy = srcRect ? e.clientY - srcRect.top : cell * 0.5;

    this.drag = {
      instanceId: p.instanceId,
      item,
      fromContainer: p.containerId,
      fromGx: p.gx,
      fromGy: p.gy,
      fromRotated: p.rotated,
      rotated: p.rotated,
      grabOx,
      grabOy,
      ghost,
    };

    src?.classList.add('is-dragging-src');
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.updateGhostVisual();
    this.syncDragPreview(e.clientX, e.clientY);
  }

  private updateGhostVisual(): void {
    if (!this.drag) return;
    const cell = this.cellSize();
    const probe: InventoryItem =
      this.drag.item.kind === 'magazine'
        ? { kind: 'magazine', mag: { ...this.drag.item.mag, rotated: this.drag.rotated } }
        : { kind: 'ammo', ammo: { ...this.drag.item.ammo, rotated: this.drag.rotated } };
    const { w, h } = getItemFootprint(probe);
    this.drag.ghost.style.width = `${w * cell}px`;
    this.drag.ghost.style.height = `${h * cell}px`;
  }

  private positionGhostFree(x: number, y: number): void {
    if (!this.drag) return;
    this.drag.ghost.style.left = `${x - this.drag.grabOx}px`;
    this.drag.ghost.style.top = `${y - this.drag.grabOy}px`;
  }

  private snapGhostToCell(
    containerId: InventoryContainerId,
    gx: number,
    gy: number,
  ): void {
    if (!this.drag) return;
    const grid = this.containerEls.get(containerId);
    if (!grid) {
      return;
    }
    const rect = grid.getBoundingClientRect();
    const cell = this.cellSize();
    this.drag.ghost.style.left = `${Math.round(rect.left + gx * cell)}px`;
    this.drag.ghost.style.top = `${Math.round(rect.top + gy * cell)}px`;
  }

  private syncDragPreview(clientX: number, clientY: number): void {
    if (!this.drag) return;
    const hit = this.hitTest(clientX, clientY);
    this.clearHighlights();
    if (!hit) {
      this.positionGhostFree(clientX, clientY);
      this.drag.ghost.classList.add('is-invalid');
      this.drag.ghost.classList.remove('is-valid');
      return;
    }
    this.snapGhostToCell(hit.containerId, hit.gx, hit.gy);
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

  private onPointerMove(e: MouseEvent): void {
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    if (this.tip && !this.tip.hidden && !this.drag) {
      this.tip.style.left = `${e.clientX + 14}px`;
      this.tip.style.top = `${e.clientY + 14}px`;
    }
    if (!this.drag) return;
    this.syncDragPreview(e.clientX, e.clientY);
  }

  private onPointerUp(e: MouseEvent): void {
    if (!this.drag) return;
    const drag = this.drag;
    const hit = this.hitTest(e.clientX, e.clientY);
    if (hit) {
      const moved = moveInventoryItem(
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
  }

  private hitTest(
    clientX: number,
    clientY: number,
  ): { containerId: InventoryContainerId; gx: number; gy: number } | null {
    if (!this.drag) return null;
    const cell = this.cellSize();
    const probe: InventoryItem =
      this.drag.item.kind === 'magazine'
        ? { kind: 'magazine', mag: { ...this.drag.item.mag, rotated: this.drag.rotated } }
        : { kind: 'ammo', ammo: { ...this.drag.item.ammo, rotated: this.drag.rotated } };
    const { w, h } = getItemFootprint(probe);

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

      // Top-left of item = nearest cell to ghost top-left; cursor drives intent.
      const rawLeft = clientX - this.drag.grabOx;
      const rawTop = clientY - this.drag.grabOy;
      let gx = Math.round((rawLeft - rect.left) / cell);
      let gy = Math.round((rawTop - rect.top) / cell);
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
