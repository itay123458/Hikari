"""Render the Blender loop as 96 PNGs for an eight-second, 12 fps web preview."""
import bpy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'.cache'/'midnight-frames'
OUT.mkdir(parents=True,exist_ok=True)
scene=next(s for s in bpy.data.scenes if s.name=='Hikari Midnight Sanctuary')
bpy.context.window.scene=scene
scene.render.resolution_x=700;scene.render.resolution_y=600
scene.render.resolution_percentage=100;scene.eevee.taa_render_samples=64
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
for index in range(96):
    scene.frame_set(1+index*2)
    scene.render.filepath=str(OUT/f'{index:03d}.png')
    bpy.ops.render.render(write_still=True)
print('Rendered 96 original Blender animation frames.')
