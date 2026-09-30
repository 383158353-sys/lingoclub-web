import React, { useEffect, useRef, useState } from "react";
import { getLocalMediaAssets } from "@/lib/localStudyLibrary";

const isHttps = (value) => typeof value === "string" && /^https:\/\//i.test(value);
const isBlob = (value) => typeof Blob !== "undefined" && value instanceof Blob;

function legacyBlob(value) {
  if (isBlob(value)) return value;
  if (typeof value !== "string" || !value.startsWith("data:image/")) return null;
  try {
    const [header, encoded = ""] = value.split(",", 2);
    const mime = header.match(/^data:([^;]+)/)?.[1] || "image/jpeg";
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new Blob([bytes], { type: mime });
  } catch { return null; }
}

export async function resolveLocalPoster(item, kind = "movie") {
  const urlField = kind === "folder" ? item?.cover_url : item?.poster_url;
  const blobField = kind === "folder" ? item?.cover_blob : item?.poster_blob;
  const directUrl = isHttps(urlField) ? urlField : "";
  let posterHandle = item?.posterHandle || item?.poster_handle || item?.coverHandle || item?.cover_handle || null;
  let localBlob = legacyBlob(blobField);
  if (!localBlob && typeof urlField === "string" && urlField.startsWith("data:image/")) localBlob = legacyBlob(urlField);

  let assets = null;
  try {
    const assetId = kind === "folder" ? `folder:${item?.id}` : item?.id;
    assets = item?.id ? await getLocalMediaAssets(assetId) : null;
  } catch { /* Keep any usable legacy fields when IndexedDB cannot be read. */ }
  posterHandle ||= assets?.posterHandle || assets?.poster_handle || assets?.coverHandle || assets?.cover_handle || null;
  localBlob ||= legacyBlob(assets?.posterBlob || assets?.coverBlob);

  let handleFile = null;
  let needsPermission = false;
  if (posterHandle?.kind === "file" && typeof posterHandle.getFile === "function") {
    try {
      const permission = await posterHandle.queryPermission?.({ mode: "read" });
      if (!permission || permission === "granted") handleFile = await posterHandle.getFile();
      else needsPermission = true;
    } catch { needsPermission = true; }
  }

  return {
    directUrl,
    handle: needsPermission ? posterHandle : null,
    handleFile,
    blob: localBlob,
    needsPermission,
    source: directUrl ? "https-url" : handleFile ? "file-handle" : localBlob ? (isBlob(blobField) || item?.poster_id || item?.cover_id ? "indexeddb-blob" : "legacy-blob") : "none",
    diagnostics: {
      id: item?.id || null,
      kind,
      urlType: typeof urlField,
      urlValue: typeof urlField === "string" ? urlField.slice(0, 180) : null,
      urlProtocol: typeof urlField === "string" ? (urlField.split(":", 1)[0] || "") : "",
      posterReference: kind === "folder" ? item?.cover_id || null : item?.poster_id || null,
      metadataBlobType: blobField?.constructor?.name || typeof blobField,
      indexedDbBlobType: (assets?.posterBlob || assets?.coverBlob)?.constructor?.name || "none",
      handleKind: posterHandle?.kind || "none",
      resolvedSource: directUrl ? "https-url" : handleFile ? "file-handle" : localBlob ? "blob" : needsPermission ? "permission-required" : "none",
    },
  };
}

export default function LocalPosterImage({ item, kind = "movie", alt = "", className = "", placeholder = null }) {
  const [resolved, setResolved] = useState({ src: "", fallback: "", handle: null, needsPermission: false, ready: false });
  const authorizedUrlRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    const objectUrls = [];
    const makeUrl = (blob) => {
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      return url;
    };
    setResolved({ src: "", fallback: "", handle: null, needsPermission: false, ready: false });

    (async () => {
      let handleUrl = "";
      const poster = await resolveLocalPoster(item, kind);
      if (poster.handleFile) handleUrl = makeUrl(poster.handleFile);
      const blobUrl = poster.blob ? makeUrl(poster.blob) : "";
      const result = {
        src: poster.directUrl || handleUrl || blobUrl,
        fallback: poster.directUrl ? handleUrl || blobUrl : "",
        handle: poster.handle,
        needsPermission: poster.needsPermission,
        ready: true,
      };
      if (typeof window !== "undefined") {
        window.__LINGOCLUB_LOCAL_POSTER_DIAGNOSTICS__ ||= [];
        window.__LINGOCLUB_LOCAL_POSTER_DIAGNOSTICS__.push(poster.diagnostics);
        if (window.__LINGOCLUB_LOCAL_POSTER_DIAGNOSTICS__.length > 100) window.__LINGOCLUB_LOCAL_POSTER_DIAGNOSTICS__.shift();
      }
      if (cancelled) objectUrls.forEach((url) => URL.revokeObjectURL(url));
      else setResolved(result);
      return objectUrls;
    })().then((urls) => {
      if (cancelled && Array.isArray(urls)) urls.forEach((url) => URL.revokeObjectURL(url));
    });

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      if (authorizedUrlRef.current) URL.revokeObjectURL(authorizedUrlRef.current);
      authorizedUrlRef.current = "";
    };
  }, [item, kind]);

  const authorize = async () => {
    const handle = resolved.handle;
    if (!handle) return;
    try {
      const permission = await handle.requestPermission?.({ mode: "read" });
      if (permission !== "granted") return;
      const url = URL.createObjectURL(await handle.getFile());
      if (authorizedUrlRef.current) URL.revokeObjectURL(authorizedUrlRef.current);
      authorizedUrlRef.current = url;
      setResolved((current) => ({ ...current, src: url, fallback: "", handle: null, needsPermission: false }));
    } catch { setResolved((current) => ({ ...current, src: "", needsPermission: true })); }
  };

  const [failed, setFailed] = useState(0);
  useEffect(() => { setFailed(0); }, [resolved.src]);
  const src = failed === 0 ? resolved.src : failed === 1 ? resolved.fallback : "";

  return (
    <>
      {resolved.ready && src && <img src={src} alt={alt} className={className} onError={() => setFailed((value) => Math.min(value + 1, 2))} />}
      {resolved.ready && !src && (resolved.needsPermission
        ? <button type="button" onClick={authorize} className="absolute inset-x-1 bottom-1 z-10 rounded bg-black/70 px-1.5 py-1 text-[10px] text-white">重新授权封面</button>
        : placeholder)}
    </>
  );
}
