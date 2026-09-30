// 中文词性 → 英文缩写映射，用于查词气泡的紧凑显示
const POS_MAP = {
  '动词': 'v.', '名词': 'n.', '形容词': 'adj.', '副词': 'adv.',
  '介词': 'prep.', '连词': 'conj.', '代词': 'pron.', '数词': 'num.',
  '冠词': 'art.', '感叹词': 'int.', '短语': 'phr.', '词组': 'phr.',
  '整句': 'sent.', '助动词': 'aux.', '情态动词': 'mod.',
};

export function toPosEn(pos) {
  if (!pos) return '';
  const trimmed = pos.trim();
  // 已是英文缩写则直接返回
  if (/^[a-z]+\.$/.test(trimmed)) return trimmed;
  return trimmed.split(/[/、，,]/).map(p => {
    const t = p.trim();
    return POS_MAP[t] || '';
  }).filter(Boolean).join('/');
}