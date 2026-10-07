function decodeEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([\da-f]+);/gi, (_, digits) => String.fromCodePoint(parseInt(digits, 16)));
}

function cleanText(value) {
  return decodeEntities(String(value || ''))
    .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}><c>/g, '')
    .replace(/<\/?(?:c|i|b|u|ruby|rt)(?:\.[^>]*)?>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTimestamp(value) {
  const valueText = String(value).trim();
  const hourMatch = valueText.match(/^(\d+):(\d{2}):(\d{2})[.,](\d{3})$/);
  const shortMatch = valueText.match(/^(\d{2}):(\d{2})[.,](\d{3})$/);
  if (!hourMatch && !shortMatch) return null;
  const hours = Number(hourMatch?.[1] || 0);
  const minutes = Number(hourMatch?.[2] || shortMatch?.[1]);
  const seconds = Number(hourMatch?.[3] || shortMatch?.[2]);
  const millis = Number(hourMatch?.[4] || shortMatch?.[3]);
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

export function parseVtt(input) {
  const text = String(input || '').replace(/^\uFEFF/, '').replace(/\r/g, '');
  const blocks = text.split(/\n{2,}/);
  const lines = [];

  for (const block of blocks) {
    const rows = block.split('\n').map((row) => row.trim()).filter(Boolean);
    const timingIndex = rows.findIndex((row) => row.includes('-->'));
    if (timingIndex < 0) continue;
    const timing = rows[timingIndex].match(/([^\s]+)\s+-->\s+([^\s]+)/);
    if (!timing) continue;
    const time_start = parseTimestamp(timing[1]);
    const time_end = parseTimestamp(timing[2]);
    if (time_start === null || time_end === null || time_end <= time_start) continue;
    const text_en = cleanText(rows.slice(timingIndex + 1).join(' '));
    if (!text_en) continue;
    lines.push({ text_en, time_start, time_end });
  }
  return lines;
}

export function parseJson3(input) {
  const parsed = typeof input === 'string' ? JSON.parse(input) : input;
  if (!Array.isArray(parsed?.events)) return [];
  const lines = [];
  for (const event of parsed.events) {
    const text_en = cleanText(Array.isArray(event?.segs)
      ? event.segs.map((segment) => segment?.utf8 || '').join('')
      : '');
    const time_start = Number(event?.tStartMs) / 1000;
    const duration = Number(event?.dDurationMs) / 1000;
    if (!text_en || !Number.isFinite(time_start) || !Number.isFinite(duration) || duration <= 0) continue;
    lines.push({ text_en, time_start, time_end: time_start + duration });
  }
  return lines;
}

export function parseSubtitle(input, format) {
  if (format === 'json3') return parseJson3(input);
  if (format === 'vtt' || format === 'webvtt') return parseVtt(input);
  throw new Error(`Unsupported subtitle format: ${format}`);
}

export function timecodeToSeconds(value) {
  return parseTimestamp(value);
}
