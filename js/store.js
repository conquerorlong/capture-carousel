// Kalıcı depolama: projeler ve fotoğraflar cihazın kendi IndexedDB'sinde durur.
// Hiçbir şey sunucuya gönderilmez.

const DB_NAME = 'kaydir';
const DB_VER = 1;
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('assets')) {
          const s = d.createObjectStore('assets', { keyPath: 'id' });
          s.createIndex('projectId', 'projectId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const store = {
  listProjects() {
    return tx('projects', 'readonly', s => req2p(s.getAll()))
      .then(list => list.sort((a, b) => b.updatedAt - a.updatedAt));
  },
  getProject(id) { return tx('projects', 'readonly', s => req2p(s.get(id))); },
  saveProject(p) { return tx('projects', 'readwrite', s => { s.put(p); }); },
  async deleteProject(id) {
    await tx('projects', 'readwrite', s => { s.delete(id); });
    await tx('assets', 'readwrite', s => new Promise(res => {
      const r = s.index('projectId').openCursor(IDBKeyRange.only(id));
      r.onsuccess = () => { const c = r.result; if (c) { c.delete(); c.continue(); } else res(); };
    }));
  },
  putAsset(a) { return tx('assets', 'readwrite', s => { s.put(a); }); },
  getAsset(id) { return tx('assets', 'readonly', s => req2p(s.get(id))); },
  getProjectAssets(projectId) {
    return tx('assets', 'readonly', s => req2p(s.index('projectId').getAll(IDBKeyRange.only(projectId))));
  },
  deleteAsset(id) { return tx('assets', 'readwrite', s => { s.delete(id); }); },
};

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
