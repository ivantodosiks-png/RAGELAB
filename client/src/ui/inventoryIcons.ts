/** Inventory item icons — PNG assets in /inventory/, SVG fallback. */

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

let uid = 0;

export function magazineIconHtml(iconKey: string, fillLevel = 1): string {
  const src = ICON_FILES[iconKey] ?? ICON_FILES.mag_stanag!;
  const clamped = Math.max(0, Math.min(1, fillLevel));
  const fillClass =
    clamped <= 0 ? 'empty' : clamped < 0.35 ? 'low' : clamped < 0.65 ? 'medium' : 'high';
  return `<span class="inv-ico-wrap"><img class="inv-ico-img" src="${src}" alt="" draggable="false"/><i class="inv-ico-fill ${fillClass}" style="--fill:${clamped}"></i></span>`;
}

/** @deprecated use magazineIconHtml */
export function magazineIconSvg(iconKey: string, fillLevel = 1): string {
  return magazineIconHtml(iconKey, fillLevel);
}

export function uniqueSvgId(prefix: string): string {
  uid += 1;
  return `${prefix}_${uid}`;
}
