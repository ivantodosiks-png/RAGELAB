"""Export Quaternius Animated Guns FBX → client/public/models/weapons/*.glb"""
import bpy
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "_dl" / "animated_guns" / "FBX"
OUT = ROOT / "client" / "public" / "models" / "weapons"

# Map Quaternius files onto sandbox weapon ids (and a couple of aliases).
MAP = {
    "Rifle.fbx": ["rifle", "assault"],
    "Pistol.fbx": ["pistol", "usp", "makarov"],
    "Shotgun.fbx": ["shotgun", "autosg", "saiga"],
    "SniperRifle.fbx": ["sniper", "dmr"],
    "P90.fbx": ["smg", "pdw", "bizon"],
    "Revolver.fbx": ["magnum"],
}


def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        bpy.data.meshes.remove(block)
    for block in bpy.data.materials:
        bpy.data.materials.remove(block)
    for block in bpy.data.armatures:
        bpy.data.armatures.remove(block)
    for block in bpy.data.actions:
        bpy.data.actions.remove(block)


def export_one(fbx_name: str, dest_stems: list[str]):
    clear()
    fbx = SRC / fbx_name
    if not fbx.exists():
        print("MISSING", fbx)
        return
    bpy.ops.import_scene.fbx(filepath=str(fbx), automatic_bone_orientation=True)
    # Darken / unify materials a bit toward tactical look.
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                base = node.inputs.get("Base Color")
                if base and not base.is_linked:
                    c = base.default_value
                    base.default_value = (c[0] * 0.55, c[1] * 0.55, c[2] * 0.55, 1.0)
                rough = node.inputs.get("Roughness")
                if rough:
                    rough.default_value = max(0.45, rough.default_value)
                metal = node.inputs.get("Metallic")
                if metal:
                    metal.default_value = min(0.65, max(0.15, metal.default_value))

    OUT.mkdir(parents=True, exist_ok=True)
    for stem in dest_stems:
        # Keep Glock authored asset — skip overwriting glock.
        if stem == "glock":
            continue
        path = OUT / f"{stem}.glb"
        bpy.ops.export_scene.gltf(
            filepath=str(path),
            export_format="GLB",
            export_animations=True,
            export_apply=False,
            export_skins=True,
        )
        for lod in (1, 2):
            (OUT / f"{stem}.lod{lod}.glb").write_bytes(path.read_bytes())
        print("WROTE", path, path.stat().st_size)


def main():
    for fbx, stems in MAP.items():
        export_one(fbx, stems)
    print("DONE")


if __name__ == "__main__":
    main()
