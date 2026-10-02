// Transitional single vocabulary access point. Existing account-scoped records
// remain in the current guestVocab storage namespace; no data migration occurs.
import { guestVocab } from "./guestVocab.js";

export const vocabRepository = {
  list: (...args) => guestVocab.list(...args),
  listSync: () => guestVocab.listSync(),
  get: async (id) => (await guestVocab.list()).find((item) => item.id === id) || null,
  createWord: (payload) => guestVocab.create(payload),
  updateWord: (id, payload) => guestVocab.update(id, payload),
  deleteWord: (id) => guestVocab.delete(id),
  hasExpression: (expression) => guestVocab.has(expression),
  async addSource(id, source) {
    const current = (await guestVocab.list()).find((item) => item.id === id);
    if (!current || !source) return current;
    const sources = Array.isArray(current.sources) ? current.sources : [];
    if (sources.some((item) => item.source_key && item.source_key === source.source_key)) return current;
    return guestVocab.update(id, { sources: [...sources, source], last_saved_at: new Date().toISOString() });
  },
  async listSources(id) {
    const entry = (await guestVocab.list()).find((item) => item.id === id);
    return Array.isArray(entry?.sources) ? entry.sources : [];
  },
  updateReviewState: (id, state) => guestVocab.update(id, state),
  count: () => guestVocab.count(),
  replace: (items) => guestVocab.replace(items),
};
