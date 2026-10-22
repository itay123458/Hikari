import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const name of ['hikari-midnight', 'hikari-lantern', 'hikari-grimoire']) {
  test(`${name}: self-contained glTF has a real eight-second animation and one scene`, async () => {
    const bytes = await readFile(new URL(`../site/assets/${name}.glb`, import.meta.url));
    assert.equal(bytes.readUInt32LE(0), 0x46546c67);
    assert.equal(bytes.readUInt32LE(4), 2);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    assert(bytes.length < 8_000_000, 'Keep the optional model below 8 MB');
    const length = bytes.readUInt32LE(12);
    const gltf = JSON.parse(bytes.subarray(20, 20 + length).toString());
    assert.equal(gltf.scenes.length, 1, 'Do not export unrelated Blender scenes');
    assert(gltf.meshes.length > 20, 'The asset must contain the detailed scene');
    assert(gltf.buffers.every(buffer => !buffer.uri));
    assert((gltf.images || []).every(image => !image.uri));
    assert.equal(gltf.animations.length, 1, 'Merge the moving parts into one synchronized clip');
    const animation = gltf.animations[0];
    assert(animation.channels.length >= 5);
    let moving = false;
    const bin = 20 + length + 8;
    for (const sampler of animation.samplers) {
      const times = gltf.accessors[sampler.input];
      assert.equal(times.min[0], 0, 'Loop playback must begin at time zero');
      assert(Math.abs(times.max[0] - 8) < .01);
      const output = gltf.accessors[sampler.output];
      assert.equal(output.componentType, 5126);
      const view = gltf.bufferViews[output.bufferView];
      const count = { VEC3: 3, VEC4: 4 }[output.type];
      assert(count);
      const start = bin + (view.byteOffset || 0) + (output.byteOffset || 0);
      const values = Array.from({length: output.count * count}, (_, i) => bytes.readFloatLE(start + i * 4));
      assert(values.every(Number.isFinite));
      for (let i = count; i < values.length; i++) if (Math.abs(values[i] - values[i % count]) > .001) moving = true;
    }
    assert(moving, 'An animation label alone is insufficient: transforms must change');
  });
}
