"""Export Quaternius Animated Guns Rifle.fbx → client/public/models/weapons/rifle.glb"""
import bpy
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "assets", "_dl", "animated_guns", "FBX", "Rifle.fbx")
OUT = os.path.join(ROOT, "client", "public", "models", "weapons", "rifle.glb")
OUT1 = os.path.join(ROOT, "client", "public", "models", "weapons", "rifle.lod1.glb")
OUT2 = os.path.join(ROOT, "client", "public", "models", "weapons", "rifle.lod2.glb")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC, automatic_bone_orientation=True, use_anim=True)

# Sensible names for runtime.
for obj in bpy.data.objects:
    low = obj.name.lower()
    if "mag" in low:
        obj.name = "magazine"
    elif obj.type == "MESH" and "rifle" in low:
        obj.name = "rifle"

# Flat tactical paint (pack is untextured).
for mat in bpy.data.materials:
    mat.use_nodes = True
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.08, 0.09, 0.1, 1)
    bsdf.inputs["Metallic"].default_value = 0.55
    bsdf.inputs["Roughness"].default_value = 0.42
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_animations=True,
    export_apply=False,
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
    export_yup=True,
)
import shutil

shutil.copyfile(OUT, OUT1)
shutil.copyfile(OUT, OUT2)
print("EXPORT_OK", OUT, os.path.getsize(OUT))
print("ACTIONS", [a.name for a in bpy.data.actions])
print("MESHES", [o.name for o in bpy.data.objects if o.type == "MESH"])
