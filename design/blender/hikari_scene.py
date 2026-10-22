"""Original Hikari moon-cat diorama. Run inside Blender; preserves other scenes."""
import bpy
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'site' / 'assets'
OUT.mkdir(parents=True, exist_ok=True)
scene = bpy.data.scenes.new('Hikari Mooncat Artwork')
bpy.context.window.scene = scene
scene.render.engine = next(s.render.engine for s in bpy.data.scenes if s != scene)

def material(name, color, metallic=0.0, glow=0.0):
    mat = bpy.data.materials.new('HK_' + name)
    mat.use_nodes = True
    shader = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = 0.34
    shader.inputs['Metallic'].default_value = metallic
    if glow:
        shader.inputs['Emission Color'].default_value = (*color, 1)
        shader.inputs['Emission Strength'].default_value = glow
    return mat

cream = material('porcelain', (0.91, 0.86, 0.79))
white = material('cloud', (0.99, 0.96, 0.91))
lavender = material('lavender', (0.48, 0.32, 0.72))
plum = material('plum', (0.16, 0.09, 0.23))
pink = material('sakura', (0.92, 0.43, 0.55))
peach = material('gate', (0.79, 0.35, 0.34))
gold = material('moon', (0.97, 0.69, 0.27), 0.25, 0.12)
mint = material('island', (0.38, 0.58, 0.53))

def finish(obj, name, mat):
    obj.name = 'HK_' + name
    obj.data.materials.append(mat)
    if obj.type == 'MESH':
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj

def sphere(name, pos, scale, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, location=pos)
    obj = finish(bpy.context.object, name, mat)
    obj.scale = scale
    return obj

def box(name, pos, scale, mat, bevel=0.06):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = finish(bpy.context.object, name, mat)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    kinds = bpy.types.Modifier.bl_rna.properties['type'].enum_items
    mod = obj.modifiers.new('Soft edges', next(k.identifier for k in kinds if k.identifier == 'BEVEL'))
    mod.width = bevel
    mod.segments = 4
    return obj

def curve(name, points, radius, mat):
    data = bpy.data.curves.new('HK_' + name, 'CURVE')
    data.dimensions = '3D'
    data.bevel_depth = radius
    data.bevel_resolution = 4
    spline = data.splines.new('BEZIER')
    spline.bezier_points.add(len(points)-1)
    for p, co in zip(spline.bezier_points, points):
        p.co = co
        p.handle_left_type = p.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new('HK_' + name, data)
    scene.collection.objects.link(obj)
    data.materials.append(mat)
    return obj

def flat_shape(name, points, y, thickness, mat):
    n = len(points)
    vertices = [(x, y+dy, z) for dy in [-thickness/2, thickness/2] for x,z in points]
    faces = [tuple(reversed(range(n))), tuple(range(n,2*n))]
    faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
    mesh = bpy.data.meshes.new('HK_' + name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new('HK_' + name, mesh)
    scene.collection.objects.link(obj)
    mesh.materials.append(mat)
    return obj

# A floating, porcelain-topped island and a tiny reading sanctuary.
sphere('floating island', (0,0,-0.19), (2.18,1.58,0.55), mint)
sphere('porcelain island top', (0,0,0.03), (2.15,1.55,0.22), cream)
for x in [-1.02, 1.02]:
    box('gate pillar', (x,0.69,1.39), (0.20,0.22,2.42), peach)
    box('pillar foot', (x,0.69,0.28), (0.35,0.38,0.2), plum)
box('crossbeam', (0,0.69,2.12), (2.65,0.22,0.19), peach)
curve('swept gate roof', [(-1.57,0.69,2.69),(-0.8,0.69,2.56),(0,0.69,2.52),(0.8,0.69,2.56),(1.57,0.69,2.69)],0.14,plum)
box('gate plaque', (0,0.48,2.24), (0.29,0.12,0.42), lavender)
sphere('plaque charm', (0,0.397,2.26), (0.055,0.024,0.07), gold)
box('bottom book cover', (-0.19,-0.5,0.25), (1.52,1.0,0.12), lavender)
box('book pages', (-0.19,-0.5,0.36), (1.39,0.91,0.18), white)
box('top book cover', (-0.19,-0.5,0.49), (1.52,1.0,0.1), lavender)
sphere('cat body', (-0.19,-0.5,1.04), (0.47,0.38,0.62), white)
sphere('cat head', (-0.19,-0.52,1.72), (0.60,0.43,0.49), white)
for x in [-0.59,0.21]:
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.26, radius2=0.035, depth=0.55, location=(x,-0.5,2.12), rotation=(0,0,math.pi/4))
    finish(bpy.context.object,'cat ear',white)
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.14, radius2=0.015, depth=0.33, location=(x,-0.64,2.14), rotation=(0,0,math.pi/4))
    finish(bpy.context.object,'pink inner ear',pink)
for x in [-0.40,0.02]:
    sphere('bright eye', (x,-0.931,1.77), (0.037,0.025,0.082), plum)
    sphere('eye catchlight', (x-0.009,-0.957,1.8), (0.012,0.009,0.019), white)
for x in [-0.60,0.22]:
    sphere('blushing cheek', (x,-0.852,1.62), (0.09,0.02,0.04), pink)
sphere('nose', (-0.19,-0.965,1.65), (0.038,0.025,0.025), pink)
curve('smile', [(-0.28,-0.953,1.59),(-0.19,-0.974,1.56),(-0.10,-0.953,1.59)],0.012,plum)
for x in [-0.43,0.06]:
    sphere('little paw', (x,-0.75,0.64), (0.21,0.20,0.12), white)
sphere('resting arm',(-0.61,-0.59,1.00),(0.14,0.16,0.28),white)
sphere('waving arm',(0.30,-0.53,1.22),(0.15,0.16,0.30),white)
sphere('waving paw',(0.36,-0.56,1.48),(0.18,0.14,0.18),white)
sphere('paw bean',(0.36,-0.697,1.48),(0.074,0.02,0.065),pink)
curve('collar',[(-0.55,-0.62,1.38),(-0.19,-0.89,1.30),(0.17,-0.62,1.38)],0.045,lavender)
sphere('gold bell',(-0.19,-0.91,1.23),(0.105,0.07,0.105),gold)
curve('curled tail',[(0.11,-0.18,0.75),(0.7,-0.08,0.65),(0.77,-0.22,0.95),(0.6,-0.29,1.02)],0.105,white)

# Original crescent sculpture, blossoms and candy-like cloud forms.
outer=[(0.57*math.cos(math.radians(a)),0.57*math.sin(math.radians(a))) for a in range(50,311,10)]
inner=[(0.28+0.47*math.cos(math.radians(a)),0.49*math.sin(math.radians(a))) for a in range(-80,-281,-10)]
moon=flat_shape('crescent moon',[(x+0.92,z+3.12) for x,z in outer+inner],0.92,0.15,gold)
curve('sakura trunk',[(1.45,0.25,0.13),(1.38,0.37,0.9),(1.63,0.48,1.45)],0.07,plum)
for i,(x,y,z) in enumerate([(1.3,.40,1.45),(1.65,.5,1.63),(1.93,.5,1.4),(1.58,.25,1.32)]):
    for p in range(5):
        a=p*math.tau/5
        sphere('sakura petal',(x+math.cos(a)*.17,y+math.sin(a)*.12,z),(0.20,0.15,0.10),pink)
    sphere('flower heart',(x,y,z+.075),(.07,.07,.04),gold)
for x,y,z,r in [(-1.45,-.12,.56,.33),(-1.7,-.08,.44,.27),(-1.15,.04,.44,.28),(1.57,-.58,.32,.23),(1.82,-.55,.28,.18)]:
    sphere('soft cloud',(x,y,z),(r,r*.68,r*.65),white)
for x,z,r in [(-1.45,2.32,.14),(-.64,3.06,.10),(1.75,2.38,.12),(-1.83,1.13,.1)]:
    pts=[(x+math.cos(i*math.pi/4)*r*(1 if i%2==0 else .27),z+math.sin(i*math.pi/4)*r*(1 if i%2==0 else .27)) for i in range(8)]
    flat_shape('sparkle',pts,-.05,.08,gold)

world=bpy.data.worlds.new('HK_soft lavender world')
world.use_nodes=True
background=next(n for n in world.node_tree.nodes if n.type=='BACKGROUND')
background.inputs[0].default_value=(0.53,0.45,0.68,1)
background.inputs[1].default_value=.6
scene.world=world
for name,pos,power,size,color in [('key',(-3,-4,7),850,5,(1,.89,.80)),('fill',(4,-2,4),600,4,(.83,.85,1)),('rim',(0,4,6),1000,3,(1,.69,.74))]:
    data=bpy.data.lights.new('HK_'+name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color
    light=bpy.data.objects.new('HK_'+name,data);scene.collection.objects.link(light);light.location=pos
    light.rotation_euler=(Vector((0,0,1.2))-light.location).to_track_quat('-Z','Y').to_euler()
camera_data=bpy.data.cameras.new('HK_camera');camera=bpy.data.objects.new('HK_camera',camera_data);scene.collection.objects.link(camera)
camera.location=(5,-8,4.8);camera.rotation_euler=(Vector((0,0,1.55))-camera.location).to_track_quat('-Z','Y').to_euler()
camera_data.type='ORTHO';camera_data.ortho_scale=5.9;scene.camera=camera
scene.render.resolution_x=1280;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
scene.render.film_transparent=True
formats=scene.render.image_settings.bl_rna.properties['file_format'].enum_items
scene.render.image_settings.file_format=next(i.identifier for i in formats if i.identifier=='WEBP')
scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.quality=92
scene.render.filepath=str(OUT/'hikari-palace.webp')
for obj in scene.objects:
    obj.select_set(obj.type in {'MESH','CURVE'})
# glTF uses a dynamic enum in Blender 5.2; GLB was verified through the operator.
bpy.ops.export_scene.gltf(filepath=str(OUT/'hikari-palace.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_apply=True,export_cameras=False,export_lights=False)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'design'/'hikari-palace.blend'),copy=True)
bpy.ops.render.render(write_still=True)
print({'poster':str(OUT/'hikari-palace.webp'),'model':str(OUT/'hikari-palace.glb'),'objects':len(scene.objects)})
