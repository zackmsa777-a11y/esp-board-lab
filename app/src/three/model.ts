export interface ModelMesh {
  name: string;
  color?: [number, number, number];
  positions: Float32Array;
  normals?: Float32Array;
  indices: Uint32Array;
  faces: { first: number; last: number; color?: [number, number, number] | null }[];
}

// Version keys include both the converter schema and the pinned source hash.
// IndexedDB contains only user-downloaded, converted meshes, never source STEP.
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ebl-user-models', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('meshes');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function cachedModel(hash: string, meshes?: ModelMesh[]): Promise<ModelMesh[] | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('meshes', meshes ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('meshes'), key = `occt-0.0.23-v1:${hash}`;
      const request = meshes ? store.put(meshes, key) : store.get(key);
      transaction.oncomplete = () => resolve(meshes ?? request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Cache transaction aborted'));
    });
  } finally { db.close(); }
}
export function preference(key: string, fallback: string): string {
  try { return localStorage.getItem(`ebl:${key}`) ?? fallback; } catch { return fallback; }
}
export function savePreference(key: string, value: string): void {
  try { localStorage.setItem(`ebl:${key}`, value); } catch { /* Storage may be disabled. */ }
}
