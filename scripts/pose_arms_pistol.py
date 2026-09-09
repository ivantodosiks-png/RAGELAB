"""Pose WRAD arms into a two-handed pistol grip and export viewmodel GLB."""
import bpy
import math
import os
from mathutils import Euler

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "client", "public", "models", "viewmodel", "arms.glb")
TEX = os.path.join(ROOT, "client", "public", "models", "viewmodel", "arm_albedo_dark.png")
OUT = os.path.join(ROOT, "client", "public", "models", "viewmodel", "arms_pistol.glb")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)


def bone(arm, name):
    return arm.pose.bones.get(name)


def set_euler(pb, x=0.0, y=0.0, z=0.0):
    if not pb:
        return
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = Euler((x, y, z), "XYZ")


arms = None
for obj in bpy.data.objects:
    if obj.type == "ARMATURE":
        arms = obj
        break
if arms is None:
    raise SystemExit("no armature")

bpy.context.view_layer.objects.active = arms
bpy.ops.object.mode_set(mode="POSE")

# Right hand — primary wrap around the grip (local radians).
set_euler(bone(arms, "wrist.r"), x=0.55, y=0.25, z=-0.4)
set_euler(bone(arms, "forearm.r"), x=0.85, y=0.1, z=-0.2)
set_euler(bone(arms, "bicep.r"), x=0.35, y=0.55, z=-0.25)
set_euler(bone(arms, "shoulder.r"), x=0.05, y=0.75, z=-0.35)

# Curl all right fingers into a grip.
for finger in ("index", "middle", "ring", "pinky"):
    set_euler(bone(arms, f"finger_{finger}1.r"), x=1.15)
    set_euler(bone(arms, f"finger_{finger}2.r"), x=1.35)
    set_euler(bone(arms, f"finger_{finger}3.r"), x=0.95)
set_euler(bone(arms, "finger_thumb1.r"), x=0.55, y=0.75, z=0.55)
set_euler(bone(arms, "finger_thumb2.r"), x=0.75)
set_euler(bone(arms, "finger_thumb3.r"), x=0.45)

# Left support hand — cups the grip from the front / off-side.
set_euler(bone(arms, "wrist.l"), x=0.6, y=-0.35, z=0.5)
set_euler(bone(arms, "forearm.l"), x=0.95, y=-0.2, z=0.35)
set_euler(bone(arms, "bicep.l"), x=0.4, y=-0.65, z=0.35)
set_euler(bone(arms, "shoulder.l"), x=0.05, y=-0.85, z=0.4)
for finger in ("index", "middle", "ring", "pinky"):
    set_euler(bone(arms, f"finger_{finger}1.l"), x=1.05)
    set_euler(bone(arms, f"finger_{finger}2.l"), x=1.25)
    set_euler(bone(arms, f"finger_{finger}3.l"), x=0.9)
set_euler(bone(arms, "finger_thumb1.l"), x=0.4, y=-0.65, z=-0.5)
set_euler(bone(arms, "finger_thumb2.l"), x=0.65)

bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode="OBJECT")

# Darker glove-ish albedo if present.
if os.path.isfile(TEX):
    img = bpy.data.images.load(TEX, check_existing=True)
    img.colorspace_settings.name = "sRGB"
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type == "TEX_IMAGE":
                node.image = img

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_animations=False,
    export_apply=True,
    export_skins=False,
    export_morph=False,
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
    export_image_format="AUTO",
    export_yup=True,
)
print("EXPORT_OK", OUT, os.path.getsize(OUT))
