/* Builds rock meshes off the main thread with the design's own library (three.js r128 + rocks.js,
   loaded unchanged with importScripts). Returns the geometry buffers and the cut distance the
   material needs; the page wraps them in a mesh. A detailed rock takes 0.1–1 s of CPU: here it never
   blocks scrolling or taps. */
/* global importScripts, RK */
let ready = false;

self.onmessage = e => {
  const { id, opts, urls } = e.data;
  try {
    if (!ready) { importScripts(urls.three, urls.rocks); ready = true; }
    const m = RK.rock(opts);
    const g = m.geometry;
    // The material keeps the normalised cut distance in its compile hook: read it with a stub shader.
    const sh = { uniforms: {}, vertexShader: '', fragmentShader: '' };
    m.material.onBeforeCompile(sh);
    const pos = g.attributes.position.array, nor = g.attributes.normal.array;
    const chip = g.attributes.aChip.array, edge = g.attributes.aEdge.array, idx = g.index.array;
    self.postMessage({ id, pos, nor, chip, edge, idx, cutD: sh.uniforms.uCutD.value }, [pos.buffer, nor.buffer, chip.buffer, edge.buffer, idx.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
