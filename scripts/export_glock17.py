"""Export assets/glock17/Glock17.fbx → client/public/models/weapons/glock.glb (embedded textures + anims)."""
import bpy
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FBX = os.path.join(ROOT, "assets", "glock17", "Glock17.fbx")
TEX = os.path.join(ROOT, "assets", "glock17", "Textures")
OUT = os.path.join(ROOT, "client", "public", "models", "weapons", "glock.glb")
OUT_LOD1 = os.path.join(ROOT, "client", "public", "models", "weapons", "glock.lod1.glb")
OUT_LOD2 = os.path.join(ROOT, "client", "public", "models", "weapons", "glock.lod2.glb")

bpy.ops.wm.read_factory_settings(use_empty=True)

bpy.ops.import_scene.fbx(
    filepath=FBX,
    automatic_bone_orientation=True,
    use_anim=True,
    ignore_leaf_bones=True,
)

# Hook PBR textures onto materials that lost paths.
base = os.path.join(TEX, "Glock17_BaseColor.png")
metal = os.path.join(TEX, "Glock17_Metalness.png")
rough = os.path.join(TEX, "Glock17_Roughness.png")
normal = os.path.join(TEX, "Glock17_Normal.png")


def load_image(path):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = "sRGB" if "BaseColor" in path or "base" in path.lower() else "Non-Color"
    if "BaseColor" in path:
        img.colorspace_settings.name = "sRGB"
    else:
        img.colorspace_settings.name = "Non-Color"
    return img


img_base = load_image(base)
img_metal = load_image(metal)
img_rough = load_image(rough)
img_normal = load_image(normal)

for mat in bpy.data.materials:
    mat.use_nodes = True
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    tex_base = nodes.new("ShaderNodeTexImage")
    tex_base.image = img_base
    links.new(tex_base.outputs["Color"], bsdf.inputs["Base Color"])

    tex_metal = nodes.new("ShaderNodeTexImage")
    tex_metal.image = img_metal
    links.new(tex_metal.outputs["Color"], bsdf.inputs["Metallic"])

    tex_rough = nodes.new("ShaderNodeTexImage")
    tex_rough.image = img_rough
    links.new(tex_rough.outputs["Color"], bsdf.inputs["Roughness"])

    tex_n = nodes.new("ShaderNodeTexImage")
    tex_n.image = img_normal
    nmap = nodes.new("ShaderNodeNormalMap")
    links.new(tex_n.outputs["Color"], nmap.inputs["Color"])
    links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

# Clean helper empties / isolate sets; keep mesh objects with useful names.
for obj in list(bpy.data.objects):
    name = obj.name.lower()
    if "temp_texture" in name or "isolate" in name:
        bpy.data.objects.remove(obj, do_unlink=True)

# Normalize part names for runtime (magazine / slide).
for obj in bpy.data.objects:
    low = obj.name.lower()
    if "magazine" in low:
        obj.name = "magazine"
    elif "slide" in low:
        obj.name = "slide"
    elif "trigger" in low:
        obj.name = "trigger"
    elif obj.type == "MESH" and "glock" in low and "slide" not in low and "magazine" not in low:
        obj.name = "frame"

# FBX often lands in centimeters with uneven parent scales — bake to meters.
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
for obj in bpy.data.objects:
    if obj.parent:
        mw = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = mw
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

# Uniform cm → m if still oversized.
import mathutils

bbox = [mathutils.Vector(c) for o in bpy.data.objects if o.type == "MESH" for c in o.bound_box]
if bbox:
    xs = [v.x for v in bbox]
    ys = [v.y for v in bbox]
    zs = [v.z for v in bbox]
    size = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    if size > 2.0:
        s = 0.01
        for obj in bpy.data.objects:
            obj.scale *= s
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_animations=True,
    export_apply=True,
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
    export_image_format="AUTO",
    export_yup=True,
)

# Lightweight copies for world LOD until a proper simplify pass exists.
import shutil

shutil.copyfile(OUT, OUT_LOD1)
shutil.copyfile(OUT, OUT_LOD2)

anims = [a.name for a in bpy.data.actions]
meshes = [o.name for o in bpy.data.objects if o.type == "MESH"]
print("EXPORT_OK", OUT)
print("ACTIONS", anims)
print("MESHES", meshes)
print("SIZE", os.path.getsize(OUT))
