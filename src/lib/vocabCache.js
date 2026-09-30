// 模块级内存缓存：同一会话内重复点击同一单词不重复请求 LLM。
// Map key = expression_en（小写），value = profile 对象。
const _cache = new Map();
const MAX = 200;

export function getCachedProfile(expression) {
  const key = (expression || "").toLowerCase().trim();
  return _cache.get(key) || null;
}

export function setCachedProfile(expression, profile) {
  if (!expression || !profile) return;
  const key = expression.toLowerCase().trim();
  if (_cache.size >= MAX) {
    // 淘汰最早的条目
    const first = _cache.keys().next().value;
    if (first) _cache.delete(first);
  }
  _cache.set(key, profile);
}