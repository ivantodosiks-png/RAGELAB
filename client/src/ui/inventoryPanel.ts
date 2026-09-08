import {
  CALIBERS,
  MAGAZINE_DEFINITIONS,
  caliberName,
  magFillLabel,
  magFillLevel,
  type InventoryItem,
  type PlayerInventoryState,
} from '@ragelab/shared';
import { el } from '../ui/dom';

/**
 * Tarkov-style tactical inventory opened with TAB.
 */
export class InventoryPanel {
  readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly tip: HTMLElement;
  private open = false;
  private inventory: PlayerInventoryState = { items: [], chambered: {} };

  constructor(host: HTMLElement) {
    this.root = el('div', 'inv-panel');
    this.root.hidden = true;
    const card = el('div', 'inv-card');
    card.append(
      el('div', 'inv-kicker', 'Field Inventory'),
      el('h2', 'inv-title', 'INVENTORY'),
      el('p', 'inv-sub', 'Physical magazines & ammo. Exact counts shown here only.'),
    );
    this.grid = el('div', 'inv-grid');
    this.tip = el('div', 'inv-tip');
    this.tip.hidden = true;
    card.append(this.grid);
    this.root.append(card, this.tip);
    host.append(this.root);

    this.root.addEventListener('mousemove', (e) => {
      if (this.tip.hidden) return;
      this.tip.style.left = `${e.clientX + 14}px`;
      this.tip.style.top = `${e.clientY + 14}px`;
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
    this.grid.replaceChildren();
    const sections: Array<{ title: string; items: InventoryItem[] }> = [
      { title: 'Magazines', items: this.inventory.items.filter((i) => i.kind === 'magazine') },
      { title: 'Ammo', items: this.inventory.items.filter((i) => i.kind === 'ammo') },
    ];

    for (const section of sections) {
      const block = el('div', 'inv-section');
      block.append(el('div', 'inv-section-title', section.title));
      const row = el('div', 'inv-row');
      if (section.items.length === 0) {
        row.append(el('div', 'inv-empty', '—'));
      }
      for (const item of section.items) {
        row.append(this.cardFor(item));
      }
      block.append(row);
      this.grid.append(block);
    }

    const chambered = el('div', 'inv-section');
    chambered.append(el('div', 'inv-section-title', 'Chambered'));
    const crow = el('div', 'inv-row');
    for (const [weaponId, magId] of Object.entries(this.inventory.chambered)) {
      if (!magId) continue;
      const magItem = this.inventory.items.find(
        (i) => i.kind === 'magazine' && i.mag.instanceId === magId,
      );
      if (!magItem || magItem.kind !== 'magazine') continue;
      const card = this.cardFor(magItem);
      card.classList.add('chambered');
      const badge = el('div', 'inv-badge', weaponId.toUpperCase());
      card.prepend(badge);
      crow.append(card);
    }
    if (!crow.childElementCount) crow.append(el('div', 'inv-empty', '—'));
    chambered.append(crow);
    this.grid.append(chambered);
  }

  private cardFor(item: InventoryItem): HTMLElement {
    const card = el('button', 'inv-item');
    card.type = 'button';
    if (item.kind === 'magazine') {
      const m = item.mag;
      const def = MAGAZINE_DEFINITIONS[m.defId];
      const level = magFillLevel(m.currentAmmo, m.capacity);
      const ammoText = m.currentAmmo <= 0 ? 'EMPTY' : `${m.currentAmmo} / ${m.capacity}`;
      card.append(
        el('div', 'inv-item-kind', 'MAGAZINE'),
        el('div', 'inv-item-name', def?.name ?? 'Magazine'),
        el('div', 'inv-item-meta', caliberName(m.caliber)),
        el('div', `inv-item-ammo ${level}`, ammoText),
      );
      card.addEventListener('mouseenter', () => {
        this.tip.hidden = false;
        this.tip.innerHTML = `
          <strong>MAGAZINE</strong><br/>
          Caliber: ${caliberName(m.caliber)}<br/>
          Capacity: ${m.capacity}<br/>
          Current: ${m.currentAmmo} / ${m.capacity}<br/>
          Weight: ${(def?.weight ?? 0.3).toFixed(2)} kg<br/>
          Compatible: ${m.compatibleWeapons.join(', ')}
        `;
      });
      card.addEventListener('mouseleave', () => {
        this.tip.hidden = true;
      });
    } else {
      const a = item.ammo;
      const name = CALIBERS[a.caliber]?.name ?? a.caliber;
      card.append(
        el('div', 'inv-item-kind', 'AMMO'),
        el('div', 'inv-item-name', name),
        el('div', 'inv-item-meta', a.caliber),
        el('div', 'inv-item-ammo high', `× ${a.quantity}`),
      );
      card.addEventListener('mouseenter', () => {
        this.tip.hidden = false;
        this.tip.innerHTML = `<strong>AMMO</strong><br/>${name}<br/>Quantity: ${a.quantity}`;
      });
      card.addEventListener('mouseleave', () => {
        this.tip.hidden = true;
      });
    }
    return card;
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

export { magFillLabel, magFillLevel };
