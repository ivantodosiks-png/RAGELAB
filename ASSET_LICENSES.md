# Asset licenses

Third-party 3D assets shipped with RAGELAB. Only files under `client/public/` are bundled. Scratch downloads in `tmp-assets/` are not part of the game.

## Harbor Lane city kit — `client/public/models/city/*.glb`

Compact downtown scenery for the Harbor Lane sandbox map. Kenney tiles are scaled ×10 at runtime (1 unit → 10 m) so roads are two-lane and buildings match player scale.

| Files | Pack | Count |
| --- | --- | --- |
| `building-*.glb`, `skyscraper-*.glb` | City Kit (Commercial) 2.1 | 10 |
| `house-*.glb`, `tree-*.glb`, `fence*.glb`, `planter.glb`, `driveway.glb`, `path-*.glb`, `parasol.glb` | City Kit (Suburban) 2.0 + Commercial details | 12 |
| `road-*.glb`, `lamp*.glb`, `light-square.glb`, `sign*.glb`, `cone.glb`, `barrier.glb`, `construction-light.glb` | City Kit (Roads) | 21 |

- **Author:** Kenney
- **URL:** https://kenney.nl/assets/city-kit-commercial · https://kenney.nl/assets/city-kit-suburban · https://kenney.nl/assets/city-kit-roads
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) — commercial use allowed, attribution not required.
- **Use:** Client-only decoration. Collision is cheap box/cylinder brushes cooked on both client and server; GLBs are never loaded by physics.

## Player / NPC character — `client/public/models/characters/soldier.glb`

- **Source:** three.js example `models/gltf/Soldier.glb` (Mixamo “Vanguard” by Adobe Mixamo).
- **Author:** Adobe Mixamo; redistributed as a three.js example asset.
- **URL:** https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/Soldier.glb
- **License:** Mixamo characters may be used **inside a game or real-time experience**. They must not be resold or redistributed as a standalone character pack. This repo ships a single runtime GLB for in-engine use only (player avatar + sandbox NPCs). See [Mixamo FAQ / terms](https://www.mixamo.com).
- **Contents:** PBR-textured rigged humanoid (~2.1 MB) with Idle, Walk, Run (and T-Pose) Mixamo clips. Loaded once through AssetManager and cloned per instance; not preloaded onto the NPC pool.
- **Use:** Local first-person body (hidden from the gameplay camera via a dedicated render layer), remote player avatars, and sandbox NPCs. Clothing tint, visor visibility, hair and cap overlays vary per NPC so the same rig reads as several people. The first-person camera does not draw this mesh, so it cannot clip the near plane.

## NPC humanoid — `client/public/models/npc/humanoid.glb`

- **Source:** Quaternius — Universal Animation Library character (glTF mannequin).
- **Author:** Quaternius
- **URL:** https://quaternius.com
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
- **Use:** Unused at runtime (kept as a fallback file). Live NPCs use the Mixamo soldier with clothing/hair variants.

## Weapons — `client/public/models/weapons/*.glb`

| File | Source model | Tris (baked) | Size |
| --- | --- | --- | --- |
| `pistol.glb` | Pichuliru — Pistol Compact West | ~1.2k | ~50 KB |
| `smg.glb` | Pichuliru — SMG Full West | ~2.0k | ~77 KB |
| `rifle.glb` | Pichuliru — Rifle Battle West | ~3.1k | ~117 KB |
| `shotgun.glb` | Pichuliru — Shotgun Pump West | ~1.1k | ~43 KB |
| `sniper.glb` | Pichuliru — Sniper Rifle West | ~3.1k | ~114 KB |
| `melee.glb` | Pichuliru — Katana (Flat Shaded Melee) | ~1.0k | ~12 KB |

### Firearms

- **Pack:** CC0 Flat Guns West
- **Author:** Pichuliru
- **URL:** https://opengameart.org/content/cc0-flat-guns-west
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) — commercial use allowed, attribution not required.
- **Processing:** skins/weights stripped, meshes joined, welded, quantized (`KHR_mesh_quantization`). No image textures (vertex/material colors only). Runtime LOD uses the full mesh up close, a cheaper material copy at mid range, and a box proxy far away.

### Melee

- **Pack:** CC0 Flat Shaded Melee Weapons
- **Author:** Pichuliru
- **URL:** https://opengameart.org/content/cc0-flat-shaded-melee-weapons
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) — commercial use allowed, attribution not required.
- **Processing:** Katana converted from OBJ to GLB, palette texture omitted (PBR steel material), quantized.

## Evaluated, not shipped

- **Kenney Animated Characters 3** — [CC0](https://creativecommons.org/publicdomain/zero/1.0/), https://kenney.nl. FBX-only; not converted for the browser client.
- **Kenney Blocky / Mini Characters** — CC0. Too stylized / tiny for this FPS; not shipped.
- **three.js Xbot.glb** — Mixamo Xbot (~2.9 MB, untextured). Heavier than Soldier with a worse look; not shipped.
- **Kenney Blaster Kit** — CC0 sci-fi blasters. Lower poly than the gun pack, but a worse fit for this FPS; kept as a fallback candidate only.
- **FantasySword.glb** — evaluated as a melee option; replaced by Pichuliru’s matching katana (no large texture).

## Original RAGELAB content

Procedural view-model fallbacks (used if a GLB fails to load), particle/decal textures, HUD, maps and audio remain original project assets unless noted elsewhere in this repository.
