# Hikari's original Blender artwork

## The Midnight Collection

`hikari-midnight.blend` contains three detailed scenes, built procedurally with
original geometry and materials. Each GLB includes a synchronized eight-second
`Midnight Loop` animation, exported from Blender with time zero as its origin.

| Scene | Details | Animation |
| --- | --- | --- |
| Moonlit sanctuary | 370 modeled/rig objects, engraved gate pillars, roof seams, braided shrine rope, folded wishes, gilded book corners, individual pages, cat whiskers and paw beans, a moonwater pool, cupped blossoms and ribbed lanterns | Cat wave and blink, lantern sway, floating crescent, drifting petals and orbiting fireflies |
| Astral lantern | Twelve curved brass ribs, luminous glass, silk tassels, turned onyx base, orbital rings and crystals | Lantern sway and moving crystal charms |
| Celestial grimoire | Separate vellum leaves, gilded inscriptions, cabochons, a sculpted spine, silk bookmark, celestial rings and a levitating star map | Floating book and individually hovering crystals |

Run `blender/midnight_collection.py` inside Blender to rebuild the scenes and
export the three WebP posters and animated GLB files into `site/assets/`.
Existing scenes are preserved; use a clean Blender file for release exports.

For the hero preview, run Blender in background mode with
`hikari-midnight.blend` and `blender/render_midnight_preview.py`. This renders
96 transparent PNG frames into the ignored `.cache/midnight-frames/` directory.
Encode the eight-second, 12 fps alpha preview with FFmpeg:

```sh
ffmpeg -framerate 12 -i .cache/midnight-frames/%03d.png -c:v libvpx-vp9 -pix_fmt yuva420p -crf 34 -b:v 0 -row-mt 1 -deadline good -cpu-used 4 -auto-alt-ref 0 site/assets/hikari-midnight-loop.webm
```

The ~275 KB preview respects reduced motion and data-saver preferences. All
motion has pause controls and stops on hidden pages. The optional models are
~6.4 MB, ~1.4 MB and ~0.9 MB and load only after **Explore in 3D** is selected.
Posters remain available when media cannot load. Browser animation playback,
GLB transforms and timing are verified alongside responsive and accessibility
checks. Blender source was created and rendered in 5.2.1 LTS.

## Original daytime scene

`hikari-palace.blend` contains the moon-cat, book, torii, crescent moon, and
sakura diorama built for the public Hikari hub. No third-party character models
or paid asset generators were used. Artwork follows this repository's MIT license.

To reproduce in Blender, run `blender/hikari_scene.py` in its Python workspace.
The script creates a new scene and exports the WebP poster and GLB model into
`site/assets/`. It preserves existing scenes; use a clean file for release exports.
Generated scene and render settings were verified in Blender 5.2.1 LTS.

The original daytime assets (~57 KB WebP and ~1.5 MB GLB) are retained as the
first version of Hikari's artwork. The current hub uses the Midnight Collection.
