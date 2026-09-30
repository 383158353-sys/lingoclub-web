// 单用户本地收藏层：词汇、句子与复习进度存到 localStorage。
// 接口刻意对齐 base44.entities.Vocabulary 的子集（list/create/update/delete），
// 让 Collection / Profile 在游客态能透明替换云端调用。
import { notifyLocalStateChanged, scopedStorageKey } from "./userStorage";

const KEY = "scenelab_guest_vocab";

function storageKey() {
  return scopedStorageKey(KEY);
}

function read() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) return JSON.parse(raw);
  } catch { /* noop */ }
  return [];
}
function write(list) {
  try { localStorage.setItem(storageKey(), JSON.stringify(list)); notifyLocalStateChanged(); } catch { /* noop */ }
}
function uid() {
  return "g_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const guestVocab = {
  // 同步读取（用于组件首次渲染快速拿数据，避免闪烁）
  listSync() {
    return read();
  },
  // 异步 list，模仿云端 SDK：支持 "-created_date" 排序与 limit
  async list(sort, limit) {
    let arr = read();
    if (sort === "-created_date") {
      arr = [...arr].sort((a, b) => (b.created_date || "").localeCompare(a.created_date || ""));
    }
    if (limit) arr = arr.slice(0, limit);
    return arr;
  },
  async create(payload) {
    const arr = read();
    const entry = { id: uid(), created_date: new Date().toISOString(), ...payload };
    arr.push(entry);
    write(arr);
    return entry;
  },
  async bulkCreate(payloads) {
    const arr = read();
    const now = new Date().toISOString();
    const entries = payloads.map((p) => ({ id: uid(), created_date: now, ...p }));
    write([...arr, ...entries]);
    return entries;
  },
  async update(id, fields) {
    const arr = read();
    const i = arr.findIndex((x) => x.id === id);
    if (i < 0) throw new Error("not found");
    arr[i] = { ...arr[i], ...fields };
    write(arr);
    return arr[i];
  },
  async remove(id) {
    write(read().filter((x) => x.id !== id));
  },
  // 别名，对齐 base44.entities.Vocabulary.delete
  async delete(id) {
    write(read().filter((x) => x.id !== id));
  },
  async filter(query = {}, sort, limit) {
    let arr = read().filter((item) => Object.entries(query).every(([key, value]) => item[key] === value));
    if (sort === "-created_date") arr = [...arr].sort((a, b) => (b.created_date || "").localeCompare(a.created_date || ""));
    return limit ? arr.slice(0, limit) : arr;
  },
  has(expression) {
    const e = (expression || "").trim().toLowerCase();
    if (!e) return false;
    return read().some((x) => (x.expression_en || "").toLowerCase() === e);
  },
  count() {
    return read().length;
  },
  replace(list) {
    write(Array.isArray(list) ? list : []);
  },
  clear() {
    write([]);
  },
};
