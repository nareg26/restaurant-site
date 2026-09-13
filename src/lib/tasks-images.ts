/*
 * Images for Tasks blocks: client-side downsizing and Supabase Storage upload.
 *
 * Objects are immutable and shared — a block holds a reference
 * ({ id, path, w, h }) and nothing here ever deletes an object, because
 * another block or page may point at the same one. See
 * docs/tasks-architecture.md ("Storage").
 */

import type { ImageRef } from "./tasks-store";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const BUCKET = "task-images";
/** Longest edge after downsizing. Plenty for a prep list on a tablet. */
export const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

const authHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: "Bearer " + SUPABASE_ANON_KEY,
};

/** Public URL for a stored image (the bucket is public-read). */
export const imageUrl = (path: string) =>
  `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

/* ---------- downsizing ---------- */

const loadImage = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn’t an image the browser can read."));
    };
    img.src = url;
  });

export type Prepared = { blob: Blob; w: number; h: number; ext: string; type: string };

/**
 * Decode, shrink to MAX_EDGE, re-encode as JPEG. Browsers apply EXIF
 * orientation when decoding into an <img>, so photos come out upright.
 * PNGs stay PNG only when they are already small (they may need transparency).
 */
export async function prepareImage(file: File): Promise<Prepared> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const keepPng = file.type === "image/png" && scale === 1 && file.size < 1.5 * 1024 * 1024;
  if (keepPng) return { blob: file, w, h, ext: "png", type: "image/png" };

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn’t process the image.");
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new Error("Couldn’t process the image.");
  return { blob, w, h, ext: "jpg", type: "image/jpeg" };
}

/* ---------- upload ---------- */

/** Downsize + upload one file. Returns the reference to store on the block. */
export async function uploadImage(file: File): Promise<ImageRef> {
  const prepared = await prepareImage(file);
  const id = crypto.randomUUID();
  const path = `images/${id}.${prepared.ext}`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": prepared.type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "x-upsert": "false",
    },
    body: prepared.blob,
  });
  if (!r.ok) throw new Error((await r.text()).slice(0, 300));
  return { id, path, w: prepared.w, h: prepared.h };
}
