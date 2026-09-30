// 原始视频仅以 FileSystemFileHandle 引用保存到 IndexedDB；字幕 cue 与 poster Blob 仍可缓存。

const DB_NAME = "lingo_local_study";
const STORE = "movies";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocalVideoHandle(id, videoHandle) {
  if (!videoHandle || videoHandle.kind !== "file" || typeof videoHandle.getFile !== "function") {
    throw new Error("浏览器未提供持久化文件引用，请使用“选择原文件”导入");
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      const record = { ...(request.result || {}), id, videoHandle, videoHandleSavedAt: Date.now(), createdAt: request.result?.createdAt || Date.now() };
      // Once the user has selected the original file, release the old copied Blob.
      delete record.videoBlob;
      store.put(record);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveLocalMediaAssets(id, assets) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const request = store.get(id);
    request.onsuccess = () => store.put({ ...(request.result || {}), ...assets, id, createdAt: request.result?.createdAt || Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeLocalMediaAssetFields(id, fields = []) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      const record = request.result;
      if (!record) return;
      for (const field of fields) delete record[field];
      if (Object.keys(record).some((key) => key !== "id")) store.put(record);
      else store.delete(id);
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getLocalMediaAssets(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getLocalMediaStorageStats() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).openCursor();
    const stats = { records: 0, legacyVideoBlobCount: 0, legacyVideoBlobBytes: 0, subtitleCueBytesApprox: 0, posterBlobBytes: 0, fileHandleCount: 0 };
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const row = cursor.value || {};
      stats.records += 1;
      if (row.videoBlob) stats.legacyVideoBlobCount += 1;
      stats.legacyVideoBlobBytes += Number(row.videoBlob?.size) || 0;
      stats.posterBlobBytes += Number(row.posterBlob?.size) || 0;
      stats.fileHandleCount += row.videoHandle?.kind === "file" ? 1 : 0;
      try { stats.subtitleCueBytesApprox += JSON.stringify(row.subtitleData || []).length * 2; } catch { /* report other rows */ }
      cursor.continue();
    };
    tx.oncomplete = () => resolve(stats);
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearLocalMediaForIds(ids) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  const before = await getStatsForIds(uniqueIds);
  await deleteLocalVideoMany(uniqueIds, { deleteCopiedMedia: true });
  const [after, global] = await Promise.all([getStatsForIds(uniqueIds), getLocalMediaStorageStats()]);
  return {
    deletedVideoBlobCount: Math.max(0, before.legacyVideoBlobCount - after.legacyVideoBlobCount),
    deletedVideoBlobBytes: Math.max(0, before.legacyVideoBlobBytes - after.legacyVideoBlobBytes),
    remainingVideoBlobCount: global.legacyVideoBlobCount,
    remainingVideoBlobBytes: global.legacyVideoBlobBytes,
  };
}

export async function clearAllLocalMediaStorage() {
  // This database/store is exclusively the Local Library's media cache.
  // YouTube records and all account/review state live elsewhere.
  const before = await getLocalMediaStorageStats();
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  const after = await getLocalMediaStorageStats();
  return {
    deletedVideoBlobCount: before.legacyVideoBlobCount,
    deletedVideoBlobBytes: before.legacyVideoBlobBytes,
    remainingVideoBlobCount: after.legacyVideoBlobCount,
    remainingVideoBlobBytes: after.legacyVideoBlobBytes,
    storageBytesBefore: before.legacyVideoBlobBytes + before.subtitleCueBytesApprox + before.posterBlobBytes,
    storageBytesAfter: after.legacyVideoBlobBytes + after.subtitleCueBytesApprox + after.posterBlobBytes,
  };
}

async function getStatsForIds(ids) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).openCursor();
    const wanted = new Set(ids);
    const stats = { legacyVideoBlobCount: 0, legacyVideoBlobBytes: 0 };
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (wanted.has(cursor.key) && cursor.value?.videoBlob) {
        stats.legacyVideoBlobCount += 1;
        stats.legacyVideoBlobBytes += Number(cursor.value.videoBlob.size) || 0;
      }
      cursor.continue();
    };
    tx.oncomplete = () => resolve(stats);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getLocalVideoBlob(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result?.videoBlob || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getLocalVideoSource(id, { requestPermission = false } = {}) {
  const asset = await getLocalMediaAssets(id);
  if (asset?.videoHandle) {
    let permission = "prompt";
    try { permission = await asset.videoHandle.queryPermission?.({ mode: "read" }) || "granted"; }
    catch { permission = "prompt"; }
    if (permission !== "granted" && requestPermission) {
      try { permission = await asset.videoHandle.requestPermission?.({ mode: "read" }) || permission; }
      catch { permission = "denied"; }
    }
    if (permission !== "granted") return { file: null, source: "handle", permissionRequired: true };
    try { return { file: await asset.videoHandle.getFile(), source: "handle", permissionRequired: false }; }
    catch (error) {
      if (error?.name === "NotFoundError") return { file: null, source: "handle", missing: true, error };
      return { file: null, source: "handle", permissionRequired: error?.name === "NotAllowedError", error };
    }
  }
  if (asset?.videoBlob) return { file: asset.videoBlob, source: "legacy-blob", permissionRequired: false };
  return { file: null, source: null, missing: true };
}

export async function hasLocalVideo(id) {
  try {
    const source = await getLocalVideoSource(id);
    return Boolean(source.file || source.permissionRequired);
  } catch {
    return false;
  }
}

export async function deleteLocalVideoMany(ids, { deleteCopiedMedia = true } = {}) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const id of ids) {
      if (deleteCopiedMedia) { store.delete(id); continue; }
      const request = store.get(id);
      request.onsuccess = () => {
        const previous = request.result;
        if (previous?.videoBlob) store.put({ id, videoBlob: previous.videoBlob, createdAt: previous.createdAt || Date.now() });
        else store.delete(id);
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteLocalVideo(id, options) {
  return deleteLocalVideoMany([id], options);
}
