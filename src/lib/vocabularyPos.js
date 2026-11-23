export function abbreviatedPartOfSpeech(value) {
  const pos = String(value || "").trim();
  if (!pos) return "";
  const labels = [
    [/^名词短语/, "n. phr."], [/^(动词短语|分词短语)/, "v. phr."],
    [/^被动结构/, "v. phr."], [/^形容词组合/, "adj."],
    [/^指代用语/, "pron."], [/^句型/, "phr."], [/^短语/, "phr."],
    [/^名词/, "n."], [/^动词/, "v."], [/^形容词/, "adj."],
    [/^副词/, "adv."], [/^介词/, "prep."],
  ];
  let result = pos;
  for (const [pattern, abbreviation] of labels) {
    if (pattern.test(pos)) { result = pos.replace(pattern, abbreviation); break; }
  }
  return result.replace(/[\u3400-\u9fff]+/g, "").replace(/\s+/g, " ").trim();
}
