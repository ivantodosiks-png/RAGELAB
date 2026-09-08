/** Procedural SVG magazine / ammo icons for Tarkov-style inventory. */

export function magazineIconSvg(iconKey: string, fillLevel = 1): string {
  switch (iconKey) {
    case 'mag_pistol':
      return pistolMag(fillLevel);
    case 'mag_smg':
      return smgMag(fillLevel);
    case 'mag_stanag':
      return stanagMag(fillLevel);
    case 'mag_ak':
      return akMag(fillLevel);
    case 'mag_50bmg':
      return bmgMag(fillLevel);
    case 'mag_drum':
      return drumMag(fillLevel);
    case 'mag_shotgun':
      return shotgunMag(fillLevel);
    case 'ammo_box':
      return ammoBox();
    default:
      return stanagMag(fillLevel);
  }
}

function shell(body: string, vb = '0 0 48 96'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
}

function fillBar(level: number, x: number, y: number, w: number, h: number): string {
  const clamped = Math.max(0, Math.min(1, level));
  const fh = Math.max(0, h * clamped);
  const color =
    clamped <= 0 ? '#3a3c36' : clamped < 0.35 ? '#c45a2a' : clamped < 0.65 ? '#c4a03a' : '#6a9a4a';
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="#1a1c16" opacity="0.85"/>
    <rect x="${x}" y="${y + h - fh}" width="${w}" height="${fh}" rx="1" fill="${color}"/>`;
}

function pistolMag(level: number): string {
  return shell(`
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#2a2c26"/>
        <stop offset="0.45" stop-color="#5a5e52"/>
        <stop offset="1" stop-color="#2e3028"/>
      </linearGradient>
    </defs>
    <rect x="16" y="6" width="16" height="10" rx="2" fill="url(#g)" stroke="#8a8e80" stroke-width="1"/>
    <path d="M15 16 h18 v58 c0 6-4 10-9 10h0c-5 0-9-4-9-10z" fill="url(#g)" stroke="#9aa090" stroke-width="1.2"/>
    <path d="M18 22 h12 M18 34 h12 M18 46 h12 M18 58 h10" stroke="#1c1e18" stroke-width="1.4" opacity="0.55"/>
    <rect x="19" y="18" width="10" height="4" rx="1" fill="#c8c4a8" opacity="0.35"/>
    ${fillBar(level, 20, 78, 8, 10)}
  `);
}

function smgMag(level: number): string {
  return shell(`
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#242620"/>
        <stop offset="0.5" stop-color="#4e5248"/>
        <stop offset="1" stop-color="#262820"/>
      </linearGradient>
    </defs>
    <path d="M17 8 h14 v8 h2 v62 c0 7-5 12-9 12s-9-5-9-12 V16 h2z" fill="url(#g)" stroke="#a8ac9e" stroke-width="1.2"/>
    <path d="M20 22 h8 M20 36 h8 M20 50 h8 M20 64 h7" stroke="#141610" stroke-width="1.5" opacity="0.5"/>
    ${fillBar(level, 20, 78, 8, 10)}
  `);
}

function stanagMag(level: number): string {
  return shell(`
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#1e2218"/>
        <stop offset="0.4" stop-color="#4a5240"/>
        <stop offset="1" stop-color="#22261c"/>
      </linearGradient>
    </defs>
    <path d="M18 5 h12 l3 8 v58 c0 8-4 14-9 14s-9-6-9-14 V13z" fill="url(#g)" stroke="#b0b8a4" stroke-width="1.25"/>
    <path d="M20 18 h10 M19 30 h11 M19 42 h11 M19 54 h10 M20 66 h8" stroke="#0e100c" stroke-width="1.6" opacity="0.55"/>
    <rect x="21" y="8" width="6" height="3" fill="#d0d4c4" opacity="0.4"/>
    ${fillBar(level, 20, 80, 8, 10)}
  `);
}

function akMag(level: number): string {
  return shell(`
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#2a2418"/>
        <stop offset="0.45" stop-color="#6a5a3a"/>
        <stop offset="1" stop-color="#2e281c"/>
      </linearGradient>
    </defs>
    <path d="M17 6 h14 v10 l4 8 v40 c2 10-2 20-10 22-8-2-12-12-10-22 V24 l4-8z" fill="url(#g)" stroke="#c4b490" stroke-width="1.2"/>
    <path d="M20 22 h10 M19 34 h12 M18 46 h12 M19 58 h10" stroke="#1a140c" stroke-width="1.5" opacity="0.5"/>
    ${fillBar(level, 20, 80, 8, 10)}
  `);
}

function bmgMag(level: number): string {
  return shell(
    `
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#1a1c18"/>
        <stop offset="0.5" stop-color="#4a4e44"/>
        <stop offset="1" stop-color="#1e201a"/>
      </linearGradient>
    </defs>
    <path d="M14 4 h20 v12 h4 v88 c0 10-6 16-14 16s-14-6-14-16 V16 h4z" fill="url(#g)" stroke="#c8ccc0" stroke-width="1.4"/>
    <path d="M18 24 h12 M17 40 h14 M17 56 h14 M17 72 h14 M18 88 h12" stroke="#0c0e0a" stroke-width="2" opacity="0.5"/>
    <rect x="20" y="8" width="8" height="4" fill="#e0e4d4" opacity="0.35"/>
    ${fillBar(level, 19, 112, 10, 12)}
  `,
    '0 0 48 144',
  );
}

function drumMag(level: number): string {
  return shell(
    `
    <defs>
      <radialGradient id="g" cx="50%" cy="45%" r="55%">
        <stop offset="0" stop-color="#6a6e62"/>
        <stop offset="1" stop-color="#2a2c26"/>
      </radialGradient>
    </defs>
    <circle cx="48" cy="48" r="36" fill="url(#g)" stroke="#b8bcb0" stroke-width="2"/>
    <circle cx="48" cy="48" r="14" fill="#1a1c16" stroke="#8a8e82" stroke-width="1.5"/>
    <path d="M48 12 v12 M48 72 v12 M12 48 h12 M72 48 h12" stroke="#0e100c" stroke-width="3" opacity="0.45"/>
    ${fillBar(level, 38, 78, 20, 8)}
  `,
    '0 0 96 96',
  );
}

function shotgunMag(level: number): string {
  return shell(`
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#262820"/>
        <stop offset="0.5" stop-color="#52564a"/>
        <stop offset="1" stop-color="#282a22"/>
      </linearGradient>
    </defs>
    <rect x="15" y="8" width="18" height="72" rx="3" fill="url(#g)" stroke="#a8ac9e" stroke-width="1.2"/>
    <circle cx="24" cy="22" r="4" fill="#1a1c16" stroke="#888" stroke-width="1"/>
    <circle cx="24" cy="40" r="4" fill="#1a1c16" stroke="#888" stroke-width="1"/>
    <circle cx="24" cy="58" r="4" fill="#1a1c16" stroke="#888" stroke-width="1"/>
    ${fillBar(level, 20, 78, 8, 10)}
  `);
}

function ammoBox(): string {
  return shell(
    `
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#6a5a2a"/>
        <stop offset="1" stop-color="#3a3018"/>
      </linearGradient>
    </defs>
    <rect x="6" y="10" width="36" height="28" rx="2" fill="url(#g)" stroke="#c4b060" stroke-width="1.2"/>
    <rect x="10" y="14" width="28" height="8" fill="#1a180c" opacity="0.35"/>
    <text x="24" y="30" text-anchor="middle" font-size="7" fill="#e8d888" font-family="sans-serif">AMMO</text>
  `,
    '0 0 48 48',
  );
}
