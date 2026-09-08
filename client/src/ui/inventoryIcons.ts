/** Inventory item icons — PNG assets in /inventory/ with transparent backgrounds. */

const ICON_FILES: Record<string, string> = {
  mag_pistol: '/inventory/mag_pistol.png',
  mag_smg: '/inventory/mag_smg.png',
  mag_stanag: '/inventory/mag_stanag.png',
  mag_ak: '/inventory/mag_ak.png',
  mag_50bmg: '/inventory/mag_50bmg.png',
  mag_drum: '/inventory/mag_drum.png',
  mag_shotgun: '/inventory/mag_shotgun.png',
  ammo_box: '/inventory/ammo_box.png',
};

export function itemIconSrc(iconKey: string): string {
  return ICON_FILES[iconKey] ?? ICON_FILES.mag_stanag!;
}

/** Pure icon image — no text. Fill bar is separate DOM. */
export function itemIconHtml(iconKey: string): string {
  const src = itemIconSrc(iconKey);
  return `<img class="inv-ico-img" src="${src}" alt="" draggable="false" />`;
}

/** @deprecated */
export function magazineIconHtml(iconKey: string, _fillLevel = 1): string {
  return itemIconHtml(iconKey);
}

/** @deprecated */
export function magazineIconSvg(iconKey: string, fillLevel = 1): string {
  return magazineIconHtml(iconKey, fillLevel);
}
