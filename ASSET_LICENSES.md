# Asset licenses

Third-party 3D assets shipped with RAGELAB. Only files under `client/public/` are bundled. Scratch downloads in `tmp-assets/` are not part of the game.

## Player / NPC character — `client/public/models/characters/soldier.glb`

- **Source:** three.js example `models/gltf/Soldier.glb` (Mixamo “Vanguard” by Adobe Mixamo).
- **Author:** Adobe Mixamo; redistributed as a three.js example asset.
- **URL:** https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/Soldier.glb
- **License:** Mixamo characters may be used **inside a game or real-time experience**. They must not be resold or redistributed as a standalone character pack. This repo ships a single runtime GLB for in-engine use only (player avatar + sandbox NPCs). See [Mixamo FAQ / terms](https://www.mixamo.com).
- **Contents:** PBR-textured rigged humanoid (~2.1 MB) with Idle, Walk, Run (and T-Pose) Mixamo clips. Loaded once through AssetManager and cloned per instance; not preloaded onto the NPC pool.
- **Use:** Local first-person body, remote player avatars, and the majority of spawned sandbox NPCs. Clothing tint, visor visibility, hair and cap overlays are original RAGELAB extras.

## NPC humanoid — `client/public/models/npc/humanoid.glb`

- **Source:** Quaternius — Universal Animation Library character (glTF mannequin).
- **Author:** Quaternius
- **URL:** https://quaternius.com
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
- **Use:** Browser sandbox NPCs. Animations were stripped and the mesh was quantized so the runtime file stays under ~500 KB / ~14k triangles. Materials are recolored per spawn (shirt / pants / skin variants). Procedural hair, collar and belt overlays are original RAGELAB geometry, not part of the Quaternius file.

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
