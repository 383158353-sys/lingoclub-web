import { notifyLocalStateChanged, scopedStorageKey } from "./userStorage";
import { deleteLocalVideoMany, getLocalMediaAssets, saveLocalMediaAssets } from "./localStudyLibrary";

const MOVIES_KEY = "lingoclub_local_movies_v1";
const FOLDERS_KEY = "lingoclub_local_folders_v1";
const DELETED_KEY = "lingoclub_deleted_records_v1";
const migrationPromises = new Map();

function youtubeVideoId(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    const candidate = host === "youtu.be"
      ? url.pathname.slice(1).split("/")[0]
      : url.searchParams.get("v") || url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:[/?]|$)/)?.[1];
    return /^[A-Za-z0-9_-]{11}$/.test(candidate || "") ? candidate : null;
  } catch {
    return null;
  }
}

function read(key) {
  try {
    const value = JSON.parse(localStorage.getItem(scopedStorageKey(key)) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function write(key, value) {
  localStorage.setItem(scopedStorageKey(key), JSON.stringify(value));
  notifyLocalStateChanged();
}

function readTombstones() {
  try {
    const value = JSON.parse(localStorage.getItem(scopedStorageKey(DELETED_KEY)) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function recordTombstones(records, type) {
  if (!records.length) return;
  const latest = new Map(readTombstones().map((item) => [`${item.type}:${item.id}`, item]));
  const deletedAt = new Date().toISOString();
  for (const record of records) {
    if (!record?.id) continue;
    latest.set(`${type}:${record.id}`, { id: record.id, type, deletedAt });
  }
  localStorage.setItem(scopedStorageKey(DELETED_KEY), JSON.stringify([...latest.values()]));
}

export function getLocalDeletionTombstones() { return readTombstones(); }

export function replaceLocalDeletionTombstones(tombstones) {
  const latest = new Map();
  for (const item of Array.isArray(tombstones) ? tombstones : []) {
    if (item?.id && item?.type && item?.deletedAt) latest.set(`${item.type}:${item.id}`, item);
  }
  localStorage.setItem(scopedStorageKey(DELETED_KEY), JSON.stringify([...latest.values()]));
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function dataUrlBlob(value) {
  if (typeof value !== "string" || !value.startsWith("data:")) return null;
  const [header, payload = ""] = value.split(",", 2);
  const mime = header.match(/^data:([^;]+)/)?.[1] || "application/octet-stream";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

function asBlob(value) {
  if (typeof Blob !== "undefined" && value instanceof Blob) return value;
  return dataUrlBlob(value);
}

function assetKey(item, kind) {
  return kind === "folder" ? `folder:${item.id}` : item.id;
}

async function normalizeRecord(record, kind) {
  const item = { ...record };
  const belongsToLocalLibrary = kind === "movie"
    ? !item.video_url || item.media_type === "episode"
    : item.tab_type === "films" || !item.tab_type;
  // Keep the YouTube Library's existing storage path untouched.
  if (!belongsToLocalLibrary) return { item, changed: false };
  const key = assetKey(item, kind);
  const assets = {};
  let changed = false;
  const subtitleField = Array.isArray(item.subtitles) ? item.subtitles : null;
  if (subtitleField) {
    assets.subtitleData = subtitleField;
    item.subtitle_id = key;
    delete item.subtitles;
    changed = true;
  }

  const posterField = kind === "folder" ? "cover_url" : "poster_url";
  const blobField = kind === "folder" ? "cover_blob" : "poster_blob";
  const storedBlob = asBlob(item[blobField]) || asBlob(item[posterField]);
  if (storedBlob) {
    assets.posterBlob = storedBlob;
    if (kind === "folder") item.cover_id = key;
    else item.poster_id = key;
    delete item[posterField];
    delete item[blobField];
    changed = true;
  } else if (typeof item[posterField] === "string" && item[posterField].startsWith("blob:")) {
    // A hydrated object URL is only a view value; keep the IndexedDB reference.
    if (kind === "folder" ? item.cover_id : item.poster_id) delete item[posterField];
  }

  const oversized = {};
  for (const [field, value] of Object.entries(item)) {
    if (typeof value === "string" && value.length > 100_000 && !value.startsWith("https://")) {
      oversized[field] = value;
      delete item[field];
      changed = true;
    } else if (typeof Blob !== "undefined" && value instanceof Blob) {
      oversized[field] = value;
      delete item[field];
      changed = true;
    } else if (value && typeof value === "object") {
      let serializedLength = 0;
      try { serializedLength = JSON.stringify(value).length; } catch { /* non-serializable data is handled by IndexedDB */ }
      if (serializedLength > 100_000) {
        oversized[field] = value;
        delete item[field];
        changed = true;
      }
    }
  }
  if (Object.keys(oversized).length) assets.extraLargeFields = oversized;

  if (Object.keys(assets).length) await saveLocalMediaAssets(key, assets);
  if (kind === "folder" && item.cover_blob) delete item.cover_blob;
  return { item, changed };
}

async function ensureMigrated(key, kind) {
  const storageKey = scopedStorageKey(key);
  if (migrationPromises.has(storageKey)) return migrationPromises.get(storageKey);
  const migration = (async () => {
    const original = read(key);
    let changed = false;
    const normalized = [];
    for (const record of original) {
      const result = await normalizeRecord(record, kind);
      normalized.push(result.item);
      changed ||= result.changed;
    }
    if (changed) write(key, normalized);
  })();
  migrationPromises.set(storageKey, migration);
  try { await migration; } catch (error) { migrationPromises.delete(storageKey); throw error; }
}

async function hydrateRecord(record, kind) {
  const item = { ...record };
  const key = assetKey(item, kind);
  const refs = await getLocalMediaAssets(key);
  if (item.subtitle_id && Array.isArray(refs?.subtitleData)) item.subtitles = refs.subtitleData;
  const posterRef = kind === "folder" ? item.cover_id : item.poster_id;
  if (posterRef && refs?.posterBlob) {
    if (kind === "folder") item.cover_blob = refs.posterBlob;
    else item.poster_blob = refs.posterBlob;
  }
  return item;
}

function collection(key, prefix, kind) {
  return {
    async list() {
      await ensureMigrated(key, kind);
      const items = await Promise.all(read(key).map((item) => hydrateRecord(item, kind)));
      return items.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    },
    async get(recordId) {
      await ensureMigrated(key, kind);
      const item = read(key).find((entry) => entry.id === recordId);
      return item ? hydrateRecord(item, kind) : null;
    },
    async create(fields) {
      await ensureMigrated(key, kind);
      const now = new Date().toISOString();
      const record = { id: id(prefix), created_date: now, updated_date: now, ...fields };
      const normalized = await normalizeRecord(record, kind);
      write(key, [...read(key), normalized.item]);
      return hydrateRecord(normalized.item, kind);
    },
    async update(recordId, fields) {
      await ensureMigrated(key, kind);
      const current = read(key);
      const index = current.findIndex((item) => item.id === recordId);
      if (index < 0) throw new Error("本地记录不存在");
      const merged = { ...current[index], ...fields, updated_date: new Date().toISOString() };
      const normalized = await normalizeRecord(merged, kind);
      current[index] = normalized.item;
      write(key, current);
      return hydrateRecord(normalized.item, kind);
    },
    async bulkUpdate(updates) {
      await ensureMigrated(key, kind);
      const byId = new Map(updates.map(({ id: recordId, ...fields }) => [recordId, fields]));
      const now = new Date().toISOString();
      const next = [];
      for (const item of read(key)) {
        const fields = byId.get(item.id);
        if (!fields) { next.push(item); continue; }
        const normalized = await normalizeRecord({ ...item, ...fields, updated_date: now }, kind);
        next.push(normalized.item);
      }
      write(key, next);
    },
    async delete(recordId) {
      await ensureMigrated(key, kind);
      const items = read(key);
      const removed = items.filter((item) => item.id === recordId);
      recordTombstones(removed, kind === "movie" ? "movies" : "folders");
      write(key, items.filter((item) => item.id !== recordId));
    },
    async deleteMany(recordIds) {
      await ensureMigrated(key, kind);
      const ids = new Set(recordIds);
      const items = read(key);
      const removed = items.filter((item) => ids.has(item.id));
      recordTombstones(removed, kind === "movie" ? "movies" : "folders");
      write(key, items.filter((item) => !ids.has(item.id)));
    },
    async replace(items) {
      const previousIds = new Set(read(key).map((item) => item.id));
      const normalized = [];
      for (const item of Array.isArray(items) ? items : []) normalized.push((await normalizeRecord(item, kind)).item);
      const incomingIds = new Set(normalized.map((item) => item.id));
      const removedIds = [...previousIds].filter((recordId) => !incomingIds.has(recordId));
      if (removedIds.length) {
        await deleteLocalVideoMany(removedIds.map((recordId) => kind === "folder" ? `folder:${recordId}` : recordId));
      }
      write(key, normalized);
    },
  };
}

const movieCollection = collection(MOVIES_KEY, "movie", "movie");

export const localMovies = {
  ...movieCollection,
  async importMovie(fields) {
    const before = await movieCollection.list();
    const incomingVideoId = youtubeVideoId(fields?.video_url);
    const existing = incomingVideoId
      ? before.find((movie) => (movie.youtube_video_id || youtubeVideoId(movie.video_url)) === incomingVideoId)
      : null;
    if (!existing) {
      const movie = await movieCollection.create({ ...fields, ...(incomingVideoId ? { youtube_video_id: incomingVideoId } : {}) });
      return { movie, created: true, videoId: incomingVideoId, beforeCount: before.length, afterCount: before.length + 1 };
    }

    const next = {
      name: fields?.name || existing.name,
      original_title: fields?.original_title || existing.original_title || "",
      poster_url: fields?.poster_url || existing.poster_url || "",
      poster_blob: fields?.poster_blob || null,
      video_url: fields?.video_url || existing.video_url || "",
      youtube_video_id: incomingVideoId,
    };
    if (Array.isArray(fields?.subtitles) && fields.subtitles.length) next.subtitles = fields.subtitles;
    const movie = await movieCollection.update(existing.id, next);
    return { movie, created: false, videoId: incomingVideoId, beforeCount: before.length, afterCount: before.length };
  },
};

export const localFolders = collection(FOLDERS_KEY, "folder", "folder");

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}
