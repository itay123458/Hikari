"""Hikari Midnight Collection: three original detailed models and baked animations.

Run in Blender. Creates new scenes without clearing the user's existing work.
"""
import bpy
import math
import random
import contextlib
import io
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'site' / 'assets'
# Reuse the original sculpt and its helpers, preserving its editable source.
base = (ROOT/'design'/'blender'/'hikari_scene.py').read_text(encoding='utf8')
exec(compile(base[:base.index('world=bpy.data.worlds.new')], str(ROOT/'design'/'blender'/'hikari_scene.py'), 'exec'))
scene.name = 'Hikari Midnight Sanctuary'
random.seed(44)

def recolor(mat, color, roughness=.4, metallic=0, glow=0):
    shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value=(*color,1)
    shader.inputs['Roughness'].default_value=roughness
    shader.inputs['Metallic'].default_value=metallic
    shader.inputs['Emission Color'].default_value=(*color,1)
    shader.inputs['Emission Strength'].default_value=glow

recolor(cream,(.08,.10,.18),.3,.25)
recolor(white,(.68,.65,.82),.35)
recolor(lavender,(.23,.09,.45),.28,.3)
recolor(plum,(.025,.015,.065),.35,.2)
recolor(pink,(.62,.13,.36),.36)
recolor(peach,(.17,.045,.13),.3,.35)
recolor(gold,(.85,.47,.12),.25,.7,.4)
recolor(mint,(.025,.055,.10),.3,.5)
cyan=material('moonwater',(.025,.33,.38),.5,.2)
light=material('lantern light',(1,.39,.07),.1,2)
starlight=material('violet starlight',(.47,.16,1),.3,2)
paper=material('vellum',(.63,.50,.38),0,0)

def group(name,objects,pivot=(0,0,0)):
    root=bpy.data.objects.new(name,None);scene.collection.objects.link(root);root.location=pivot
    bpy.context.view_layer.update()
    for obj in objects:
        matrix=obj.matrix_world.copy();obj.parent=root;obj.matrix_world=matrix
    return root

def ring(name,center,radius,mat,thickness=.018,plane='XY'):
    points=[]
    for i in range(65):
        a=i*math.tau/64
        xyz=(radius*math.cos(a),radius*math.sin(a),0) if plane=='XY' else (radius*math.cos(a),0,radius*math.sin(a))
        points.append(tuple(center[j]+xyz[j] for j in range(3)))
    return curve(name,points,thickness,mat)

def animate(obj,kind,amplitude=.08,phase=0):
    origin=obj.location.copy();rot=obj.rotation_euler.copy()
    for frame in range(1,194,8):
        t=(frame-1)/192*math.tau
        if kind=='float':obj.location.z=origin.z+amplitude*(math.sin(t+phase)-math.sin(phase))
        elif kind=='sway':obj.rotation_euler.y=rot.y+amplitude*math.sin(t)
        elif kind=='turn':obj.rotation_euler.z=rot.z+t
        elif kind=='blink':obj.scale.z=0.12 if frame in [65,73,161] else 1
        obj.keyframe_insert(data_path='location' if kind=='float' else 'scale' if kind=='blink' else 'rotation_euler',frame=frame)
    if obj.animation_data and obj.animation_data.action:
        obj.animation_data.action.name='Hikari_'+obj.name

def lantern(name,center,size=1):
    before=set(scene.objects)
    x,y,z=center
    sphere(name+' luminous glass',(x,y,z),(.24*size,.24*size,.34*size),light)
    for dz in [-.34,.34]:
        ring(name+' brass rim',(x,y,z+dz*size),.22*size,gold,.028*size)
        sphere(name+' cap',(x,y,z+dz*size),(.25*size,.25*size,.055*size),plum)
    for i in range(12):
        a=i*math.tau/12
        curve(name+' curved rib',[(x+math.cos(a)*r*size,y+math.sin(a)*r*size,z+h*size) for r,h in [(.19,-.32),(.26,-.16),(.27,0),(.26,.16),(.19,.32)]],.009*size,gold)
    ring(name+' hanging loop',(x,y,z+.44*size),.08*size,gold,.014*size,'XZ')
    for i in range(7):
        a=i*math.tau/7
        curve(name+' silk tassel',[(x,y,z-.36*size),(x+math.cos(a)*.035*size,y+math.sin(a)*.035*size,z-.56*size),(x+math.cos(a)*.09*size,y+math.sin(a)*.06*size,z-.78*size)],.009*size,pink)
    root=group(name,set(scene.objects)-before,(x,y,z+.5*size));animate(root,'sway',.10)
    return root

# Sculpted plinth: concentric brass inlay, stone joints, a small moonwater pool.
for radius in [1.72,1.91,2.08]:
    obj=ring('plinth celestial inlay',(0,0,.155),radius,gold,.012);obj.scale.y=.70
for i in range(24):
    a=i*math.tau/24
    curve('plinth radial seam',[(r*math.cos(a),r*.7*math.sin(a),.171) for r in [1.77,1.87]],.009,plum)
pool=sphere('moonwater pool',(1.13,-.69,.18),(.57,.4,.045),cyan)
for r in [.25,.40,.54]:
    o=ring('pool luminous ripple',(1.13,-.69,.22),r,starlight,.006);o.scale.y=.7
for i in range(7):
    a=i*2.3;sphere('river stone',(-1.5+i*.16,-.88+.14*math.sin(a),.2),(.12,.09,.035),cream)

# Roof tiles, carved panels, pillar collars, and real braided rope/shide details.
for x in [-1.02,1.02]:
    for z in [.39,.5,1.98,2.03]:box('pillar brass collar',(x,.69,z),(.23,.25,.025),gold,.008)
    for dx in [-.06,0,.06]:curve('pillar vertical carving',[(x+dx,.565,.61),(x+dx,.565,1.83)],.006,gold)
for i in range(19):
    x=-1.45+i*.161
    curve('roof tile seam',[(x,.58,2.59+.06*(x*x)),(x,.80,2.59+.06*(x*x))],.009,gold)
for offset in [0,math.pi]:
    curve('braided shrine rope',[(x,.43+.018*math.cos(i*.8+offset),2.01-.13*(1-(x/1.04)**2)+.018*math.sin(i*.8+offset)) for i,x in enumerate([-1.04+j*.026 for j in range(81)])],.018,gold)
for x in [-.70,-.36,.36,.70]:
    flat_shape('folded paper wish',[(x,1.96),(x+.055,1.89),(x+.015,1.82),(x+.07,1.75),(x+.02,1.69),(x-.035,1.78),(x+.003,1.86),(x-.04,1.92)],.40,.015,paper)

# Book binding has individual leaves, a gilded spine, corners and an inset crest.
for i in range(11):box('individual gilded page',(-.19,-.5,.285+i*.015),(1.4,.92,.008),paper,.004)
for x in [-.85,.47]:
    for y in [-.92,-.08]:box('book corner protector',(x,y,.548),(.17,.13,.016),gold,.015)
for x in [-.73,.35]:box('binding band',(x,-.5,.55),(.025,.94,.015),gold,.004)
for y in [-.8,-.2]:box('spine stud',(-.963,y,.35),(.027,.08,.11),gold,.008)
curve('silk bookmark',[(.3,-.65,.55),(.32,-1.02,.53),(.28,-1.11,.37),(.36,-1.16,.24)],.025,pink)

# Cat details: sculpted whiskers, tiny paw toes, a filigree crescent collar charm.
for side in [-1,1]:
    for i in range(3):
        curve('fine whisker',[(side*.27-.19,-.929,1.63-i*.025),(side*.58-.19,-.94,1.67-i*.07)],.006,paper)
for x in [-.43,.06]:
    for dx in [-.075,0,.075]:sphere('paw toe bean',(x+dx,-.914,.65),(.026,.012,.021),pink)
ring('bell engraved band',(-.19,-.91,1.23),.09,gold,.008,'XZ')
curve('bell slit',[(-.19,-.979,1.17),(-.19,-.99,1.23)],.008,plum)
for x in [-.58,.2]:sphere('ear piercing star',(x,-.69,2.04),(.025,.018,.025),gold)
for obj in list(scene.objects):
    if 'bright eye' in obj.name:
        # Keep the original eye proportions when blinking.
        root=group('blink eyelid',[obj],obj.location);animate(root,'blink')
wave=[o for o in scene.objects if any(n in o.name for n in ['waving arm','waving paw','paw bean'])]
animate(group('waving paw joint',wave,(.23,-.5,.99)),'sway',.24)

# Replace the simple moon by an evenly sampled crescent with a constellation rim.
old=[o for o in scene.objects if 'crescent moon' in o.name]
for o in old:bpy.data.objects.remove(o,do_unlink=True)
points=[(.66*math.cos(math.radians(a)),.66*math.sin(math.radians(a))) for a in range(52,309,4)]
top,bottom=points[0],points[-1]
points += [(bottom[0]-.37*math.sin(t*math.pi),bottom[1]+t*(top[1]-bottom[1])) for t in [i/64 for i in range(65)]]
moon=flat_shape('sculpted crescent',[(x+.93,z+3.14) for x,z in points],.89,.10,gold)
animate(group('floating crescent',[moon],(.93,.89,3.14)),'float',.07)
for i in range(18):
    a=i*math.tau/18
    sphere('moon constellation bead',(.93+.78*math.cos(a),.94,3.14+.78*math.sin(a)),(.018,.018,.018),starlight)

# Many separate cupped petals and branching stems, rather than flat flower blobs.
for o in [o for o in scene.objects if 'sakura petal' in o.name or 'flower heart' in o.name]:bpy.data.objects.remove(o,do_unlink=True)
for i in range(12):
    a=i*2.4;x=1.57+.40*math.cos(a);y=.38+.24*math.sin(a);z=1.25+(i%4)*.14
    curve('sakura branchlet',[(1.43,.37,.8),(1.55,.4,1.25),(x,y,z)],.015,peach)
    for p in range(5):
        angle=p*math.tau/5
        o=sphere('cupped blossom petal',(x+.085*math.cos(angle),y+.085*math.sin(angle),z),(.09,.065,.025),pink);o.rotation_euler=(.25*math.sin(angle),.25*math.cos(angle),angle)
    for p in range(3):sphere('gold flower stamen',(x+(p-1)*.022,y,z+.033),(.009,.009,.025),gold)
for x,y in [(-1.4,.1),(.92,.51)]:
    curve('lantern suspension',[(x,.69,2.15),(x,y,1.90)],.012,gold)
    lantern('hanging ribbed lantern',(x,y,1.57),.53)

# Eight seconds of baked object animation: falling petals and orbiting fireflies.
for i in range(16):
    x=random.uniform(-1.8,1.8);y=random.uniform(-.1,1.0);z=random.uniform(.8,2.9)
    petal=sphere('drifting sakura',(x,y,z),(.065,.035,.015),pink)
    for frame in range(1,194,8):
        t=(frame-1)/192*math.tau
        petal.location=(x+.16*math.sin(t+i),y+.10*math.cos(t+i),z+.16*math.cos(t+i))
        petal.rotation_euler=(t*.3,t*.25,t+i);petal.keyframe_insert(data_path='location',frame=frame);petal.keyframe_insert(data_path='rotation_euler',frame=frame)
for i in range(10):
    dot=sphere('orbiting firefly',(0,0,0),(.018,.018,.018),starlight)
    for frame in range(1,194,8):
        t=(frame-1)/192*math.tau+i*math.tau/10
        dot.location=(1.9*math.cos(t),1.15*math.sin(t),1.4+.55*math.sin(2*t+i));dot.keyframe_insert(data_path='location',frame=frame)

def setup(target,center,scale):
    global scene
    scene=target;bpy.context.window.scene=scene
    scene.frame_start=1;scene.frame_end=193;scene.render.fps=24
    world=bpy.data.worlds.new('Midnight indigo environment');world.use_nodes=True
    bg=next(n for n in world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs[0].default_value=(.035,.02,.10,1);bg.inputs[1].default_value=.35;scene.world=world
    for name,pos,power,size,color in [('moonkey',(-3,-4,6),700,5,(.67,.69,1)),('pinkrim',(3,3,4),1000,4,(.85,.2,.6)),('softfront',(1,-5,3),400,4,(.8,.67,1))]:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color
        o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector(center)-o.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.cameras.new('Midnight editorial camera');camera=bpy.data.objects.new('Midnight camera',data);scene.collection.objects.link(camera)
    camera.location=Vector(center)+Vector((4,-8,3.8));camera.rotation_euler=(Vector(center)-camera.location).to_track_quat('-Z','Y').to_euler();data.type='ORTHO';data.ortho_scale=scale;scene.camera=camera
    scene.render.resolution_x=1400;scene.render.resolution_y=1200;scene.render.resolution_percentage=100;scene.render.film_transparent=True
    scene.eevee.taa_render_samples=128
    scene.render.image_settings.file_format='WEBP';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.quality=92
    scene.frame_set(1)

def export(name):
    for o in scene.objects:
        if o.type=='CURVE':o.data.resolution_u=3;o.data.bevel_resolution=3
    for o in scene.objects:o.select_set(o.type in {'MESH','CURVE','EMPTY'})
    with contextlib.redirect_stdout(io.StringIO()):
        bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.glb')),export_format='GLB',use_selection=True,use_active_scene=True,export_apply=True,export_cameras=False,export_lights=False,export_animations=True,export_frame_range=True,export_animation_mode='ACTIVE_ACTIONS',export_anim_slide_to_zero=True,export_nla_strips_merged_animation_name='Midnight Loop')
    scene.render.filepath=str(OUT/(name+'.webp'));bpy.ops.render.render(write_still=True)
    print(name,'objects',len(scene.objects),'animated',sum(bool(o.animation_data) for o in scene.objects))

sanctuary=scene;setup(scene,(0,0,1.65),6.2);export('hikari-midnight')

# Collectible 02: a filigree lantern on an astronomical, hand-built brass stand.
scene=bpy.data.scenes.new('Hikari Astral Lantern');scene.render.engine=sanctuary.render.engine;bpy.context.window.scene=scene
lantern('astral lantern',(0,0,1.55),1.5)
for r in [.58,.73]:ring('astral orbit',(0,0,1.55),r,gold,.018,'XZ')
for i in range(12):
    a=i*math.tau/12
    sphere('orbital crystal',(.73*math.cos(a),0,1.55+.73*math.sin(a)),(.035,.035,.035),starlight)
for r,z in [(.65,.1),(.56,.16),(.42,.22)]:sphere('turned onyx base',(0,0,z),(r,r,.07),plum);ring('base brass inlay',(0,0,z+.04),r*.95,gold,.014)
curve('swept lantern stand',[(.4,.12,.2),(.65,.12,1.2),(.52,.12,2.55),(0,.12,2.65),(0,0,2.35)],.035,gold)
for i in range(8):
    a=i*math.tau/8
    root=group('orbiting lantern charm',[sphere('star charm',(.9*math.cos(a),.15,1.5+.9*math.sin(a)),(.045,.045,.045),starlight)],(0,.15,1.5));animate(root,'sway',.16,i)
setup(scene,(0,0,1.4),3.8);export('hikari-lantern')

# Collectible 03: floating grimoire, separate curved leaves, binding and star map.
scene=bpy.data.scenes.new('Hikari Celestial Grimoire');scene.render.engine=sanctuary.render.engine;bpy.context.window.scene=scene
book_start=set(scene.objects)
for side in [-1,1]:
    cover=box('embossed grimoire cover',(side*.44,0,1.1),(.91,1.25,.11),lavender,.05);cover.rotation_euler.y=side*-.14
    for i in range(15):
        z=1.16+i*.011
        leaf=box('separate vellum leaf',(side*.43,0,z),(.84,1.17,.009),paper,.007);leaf.rotation_euler.y=side*-.11
    for x in [side*.13,side*.79]:
        for y in [-.49,.49]:sphere('corner cabochon',(x,y,1.39),(.045,.045,.025),cyan)
    for k in range(8):
        y=-.43+k*.12
        curve('gilded page inscription',[(side*x,y,1.355+.045*x) for x in [.12,.3,.50,.7]],.006,gold)
box('gilded book spine',(0,0,1.16),(.12,1.28,.25),plum,.04)
book=group('floating grimoire',set(scene.objects)-book_start,(0,0,1.2));animate(book,'float',.10)
for r in [1.10,1.25]:ring('celestial brass orbit',(0,0,.65),r,gold,.012)
for i in range(16):
    a=i*math.tau/16
    curve('star map radial tick',[(r*math.cos(a),r*math.sin(a),.65) for r in [1.14,1.23]],.009,gold)
for i in range(5):
    x=-.58+i*.29;y=.15*math.sin(i*1.8);z=1.9+.18*math.cos(i)
    o=sphere('levitating star map crystal',(x,y,z),(.055,.055,.10),starlight);animate(o,'float',.12,i)
curve('constellation thread',[(-.58+i*.29,.15*math.sin(i*1.8),1.9+.18*math.cos(i)) for i in range(5)],.008,gold)
curve('long silk bookmark',[(0,-.4,1.3),(.1,-.8,1.12),(-.1,-.9,.7),(.1,-.7,.48)],.025,pink)
setup(scene,(0,0,1.1),3.6);export('hikari-grimoire')

bpy.context.window.scene=sanctuary
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'design'/'hikari-midnight.blend'),copy=True)
print('Midnight collection complete: 3 models with eight-second baked animation loops.')
