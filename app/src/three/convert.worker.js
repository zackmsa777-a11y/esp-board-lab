/* Classic worker: load the unmodified, replaceable LGPL library only on demand.
 * Never store or ship the STEP file in the application distribution. */
self.onmessage = async ({ data: { url, sha256 } }) => {
  const progress = (label, value) => self.postMessage({ type: 'progress', label, value });
  try {
    progress('Downloading from LilyGO GitHub…', 0);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}). Try again when online.`);
    const reader = response.body.getReader(), chunks = [];
    const length = Number(response.headers.get('content-length')) || 2129391;
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > 16 * 1024 * 1024) throw new Error('The model download exceeds the allowed size.');
      chunks.push(value);
      progress('Downloading from LilyGO GitHub…', Math.min(70, received / length * 70));
    }
    const bytes = new Uint8Array(received); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    progress('Verifying SHA-256…', 72);
    const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('');
    if (actual !== sha256) throw new Error('SHA-256 mismatch. The model was rejected; no mesh was cached.');
    progress('Loading STEP converter…', 76);
    importScripts('/model-converter/occt-import-js.js');
    const occt = await occtimportjs({ locateFile: file => `/model-converter/${file}` });
    progress('Converting STEP to mesh…', 82);
    const result = occt.ReadStepFile(bytes, { linearUnit: 'millimeter' });
    if (!result.success || !result.meshes?.length) throw new Error('STEP conversion failed. Use the built-in model or retry.');
    const meshes = result.meshes.map(m => ({
      name: m.name, color: m.color,
      positions: new Float32Array(m.attributes.position.array),
      normals: m.attributes.normal ? new Float32Array(m.attributes.normal.array) : undefined,
      indices: new Uint32Array(m.index.array),
      faces: m.brep_faces,
    }));
    const transfers = meshes.flatMap(m => [m.positions.buffer, m.indices.buffer, ...(m.normals ? [m.normals.buffer] : [])]);
    self.postMessage({ type: 'complete', meshes }, transfers);
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
