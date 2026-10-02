function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function encodeSubtitleArchive(value) {
  const json = JSON.stringify(value);
  if (typeof CompressionStream === "undefined") return { encoding: "json", data: value };
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return { encoding: "gzip-base64", data: bytesToBase64(bytes) };
}

export async function decodeSubtitleArchive(archive) {
  if (!archive) return null;
  if (archive.encoding === "json") return archive.data || null;
  if (archive.encoding !== "gzip-base64" || typeof DecompressionStream === "undefined") return null;
  const stream = new Blob([base64ToBytes(archive.data || "")]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}
