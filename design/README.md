# Hikari's original 3D artwork

`hikari-palace.blend` contains the moon-cat, book, torii, crescent moon, and
sakura diorama built for the public Hikari hub. No third-party character models
or paid asset generators were used. Artwork follows this repository's MIT license.

To reproduce in Blender, run `blender/hikari_scene.py` in its Python workspace.
The script creates a new scene and exports the WebP poster and GLB model into
`site/assets/`. It preserves existing scenes; use a clean file for release exports.
Generated scene and render settings were verified in Blender 5.2.1 LTS.

The hub initially downloads only the ~64 KB WebP. The ~1.5 MB GLB and pinned
model-viewer library load only after the visitor chooses **Explore in 3D**.
