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

## CS Arena — `client/public/models/maps/arena.glb`

Full-map mesh for the **CS Arena** playlist entry (replaces the old Test Box).

- **File:** `fps_shooter_game_arena_map_v4.glb` (source under `assets/map cs/`)
- **Use:** Client-only scenery. Invisible brush hulls in `shared/src/maps/arena.ts` provide collision.

## Desert Arena — `client/public/models/maps/desert.glb`

Full-map mesh for the **Desert Arena** playlist entry.

- **File:** `desert_arena_environment__low_poly_game_asset.glb` (source under `assets/map cs/`)
- **Use:** Client-only scenery. Invisible brush hulls in `shared/src/maps/desert.ts` provide collision.

## Aim Pit props — `client/public/models/aimpit/*.glb`

Range / cover dressing for the Aim Pit 1v1 map (crates, cardboard targets, prop grenade). Colormap is embedded in each GLB.

| Files | Pack |
| --- | --- |
| `crate-*.glb`, `target-*.glb`, `grenade-a.glb` | Kenney Blaster Kit |

- **Author:** Kenney
- **URL:** https://kenney.nl/assets/blaster-kit
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
- **Use:** Client-only decoration. Barriers, cones, lamps and fences reuse City Kit Roads / Suburban models under `models/city/`.

## Player / NPC characters — `client/public/models/characters/*.glb`

Civilian humans (not fantasy classes). Each file is self-contained (embedded textures + Idle / Walk / Run).

| File | Mesh | Locomotion |
| --- | --- | --- |
| `man.glb` | Ready Player Me full-body example avatar (from three.js examples) | Ready Player Me Animation Library clips, baked in |
| `woman.glb` | Mixamo Michelle | Mixamo Idle / Walk / Run (clips only; the Vanguard visor mesh is not shipped) |

- **Ready Player Me avatar:** https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/readyplayer.me.glb — use in games is allowed under Ready Player Me terms.
- **Ready Player Me animations:** https://github.com/readyplayerme/animation-library — licensed for use with Ready Player Me avatars; clips are baked into `man.glb`, not redistributed as a library.
- **Mixamo Michelle + locomotion:** Adobe Mixamo characters/animations may be used in games. Mesh from three.js `Michelle.glb`; Idle/Walk/Run tracks copied from three.js `Soldier.glb` (same Mixamo skeleton).
- **Use:** Local first-person body (gameplay camera uses a dedicated layer so the head never fills the view), remote player avatars, and sandbox NPCs.

KayKit Adventurers (knight / mage / rogue / barbarian) are no longer shipped. The Mixamo Vanguard visor mesh and UE mannequin are not shipped.

## Weapons — `client/public/models/weapons/*.glb`

| File | Source model | Notes |
| --- | --- | --- |
| `pistol.glb` | Flat Guns West — Pistol Full | Desert Eagle frame |
| `glock.glb` | Flat Guns West — Pistol Compact | Glock 17 |
| `usp.glb` | Flat Guns East — Pistol Compact | USP Compact |
| `makarov.glb` | Flat Guns East — Pistol Full | Makarov PM |
| `smg.glb` | Flat Guns West — SMG Full | VX-4 Ripper |
| `pdw.glb` | Flat Guns West — SMG Compact | Vector PDW |
| `bizon.glb` | Flat Guns East — SMG Full | PP-19 Bizon |
| `rifle.glb` | Flat Guns West — Rifle Battle | M4A1 Carbine |
| `assault.glb` | Flat Guns West — Rifle Assault | AR-C Assault |
| `ak.glb` | Flat Guns East — Rifle Assault | AK-74 |
| `shotgun.glb` | Flat Guns West — Shotgun Pump | BR-12 Breaker |
| `autosg.glb` | Flat Guns West — Shotgun Auto | AA-12 Storm |
| `saiga.glb` | Flat Guns East — Shotgun Auto | Saiga-12 |
| `sniper.glb` | Flat Guns West — Sniper Rifle | LR-88 Verdict |
| `dmr.glb` | Flat Guns West — Sniper Material | M1A Scout |
| `melee.glb` | Pichuliru — Katana | Flat Shaded Melee |

### Firearms — Flat Guns West / East

- **Author:** Pichuliru
- **URL:** https://opengameart.org/content/cc0-flat-guns-west · https://opengameart.org/content/cc0-flat-guns-east
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) — commercial use allowed, attribution not required.
- **Processing:** skins/weights stripped, meshes joined, welded, quantized (`KHR_mesh_quantization`). No image textures (vertex/material colors only). Runtime LOD uses the full mesh up close, a cheaper material copy at mid range, and a box proxy far away.

### Magnum (special)

- `assets/hammer/desert-eagle.glb` — AdamKokrito / Poly Pizza, CC BY 3.0 — used only for the DX-50 Hammer world/view model.

### Melee

- **Pack:** CC0 Flat Shaded Melee Weapons
- **Author:** Pichuliru
- **URL:** https://opengameart.org/content/cc0-flat-shaded-melee-weapons
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
- **Processing:** Katana converted from OBJ to GLB, palette texture omitted (PBR steel material), quantized.

## Weapon sounds — `client/public/sounds/` (+ `assets/`)

| Sample | Source |
| --- | --- |
| `glock_17_*.wav`, `m4a1_*.wav`, `remington_870_*.wav` | Recorded field packs under `assets/` |
| `usp_shot.wav`, `assault_shot.wav`, `autosg_shot.wav`, `smg_shot.wav` | Michel Baradari — [Chaingun, pistol, rifle, shotgun shots](https://opengameart.org/content/chaingun-pistol-rifle-shotgun-shots) (CC-BY 3.0) |
| AWM / Deagle MP3s | `assets/awm/`, `assets/hammer/` |

Synth fallbacks cover any key without a recording.

## Evaluated, not shipped

- **Kenney Animated Characters 3** — [CC0](https://creativecommons.org/publicdomain/zero/1.0/), https://kenney.nl. FBX-only; not converted for the browser client.
- **Kenney Blocky / Mini Characters** — CC0. Too stylized / tiny for this FPS; not shipped.
- **three.js Xbot.glb** — Mixamo Xbot (~2.9 MB, untextured). Heavier than Soldier with a worse look; not shipped.
- **FantasySword.glb** — evaluated as a melee option; replaced by Pichuliru’s matching katana (no large texture).

## Original RAGELAB content

Procedural view-model fallbacks (used if a GLB fails to load), particle/decal textures, HUD, maps and audio remain original project assets unless noted elsewhere in this repository.
