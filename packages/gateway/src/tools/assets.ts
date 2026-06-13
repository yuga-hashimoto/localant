import { z } from "zod";
import type { Gateway } from "../gateway.js";

/**
 * Asset Bridge tools — get an image produced or referenced in a ChatGPT
 * conversation onto the local repo. Three routes share one validation + write
 * path (magic-byte sniff → MIME allowlist → SVG active-content scan → sha256 →
 * PathGuard write with backup):
 *
 *  1. base64 chunk relay (asset_receive_*) — the assistant reads an image it can
 *     access and streams it in base64 chunks.
 *  2. URL import (asset_import_url) — SSRF-guarded fetch of a public image URL.
 *  3. latest download (asset_import_latest_download) — adopt the newest image
 *     the user just downloaded.
 */
export function registerAssetTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "asset_receive_start",
    description:
      "Begin a chunked base64 image transfer to a local path. Returns a transferId and a chunkSizeHint (raw bytes per chunk). Follow with asset_receive_chunk (index 0..N) then asset_receive_commit. Supported formats: PNG, JPEG, WebP, GIF, SVG.",
    risk: 1,
    inputSchema: z.object({
      fileName: z.string().describe("Original/source file name (for logging only)."),
      totalBytes: z.number().int().positive().describe("Total decoded byte length of the image."),
      destination: z.string().describe("Absolute or repo-relative path to write the image to."),
      overwrite: z.boolean().default(false),
      sha256: z.string().optional().describe("Optional hex sha256 of the decoded bytes; verified on commit."),
    }),
    summarize: (i) => `start asset transfer ${i.fileName} -> ${i.destination} (${i.totalBytes} bytes)`,
    handler: (i) =>
      gw.assetBridge.receiveStart({
        fileName: i.fileName,
        totalBytes: i.totalBytes,
        destination: i.destination,
        overwrite: i.overwrite,
        sha256: i.sha256,
      }),
  });

  r.register({
    name: "asset_receive_chunk",
    description:
      "Send one base64 chunk of an in-progress transfer. Chunks are 0-indexed and must be contiguous. Keep each chunk near the chunkSizeHint returned by asset_receive_start.",
    risk: 1,
    inputSchema: z.object({
      transferId: z.string(),
      index: z.number().int().min(0),
      dataBase64: z.string().describe("Base64-encoded chunk of the raw image bytes."),
    }),
    // Keep the base64 payload out of the audit log; record only metadata.
    auditInput: (i) => ({ transferId: i.transferId, index: i.index, base64Len: i.dataBase64.length }),
    summarize: (i) => `asset chunk #${i.index} (${i.dataBase64.length} b64 chars)`,
    handler: (i) =>
      gw.assetBridge.receiveChunk({ transferId: i.transferId, index: i.index, dataBase64: i.dataBase64 }),
  });

  r.register({
    name: "asset_receive_commit",
    description:
      "Finalize a chunked transfer: reassemble, verify the size/checksum, sniff the image type, run SVG safety checks, and atomically write the file (a backup is kept on overwrite). Returns the path, byte size, detected MIME, and sha256.",
    risk: 2,
    inputSchema: z.object({ transferId: z.string() }),
    summarize: (i) => `commit asset transfer ${i.transferId}`,
    handler: (i) => gw.assetBridge.receiveCommit({ transferId: i.transferId }),
  });

  r.register({
    name: "asset_receive_abort",
    description: "Abandon an in-progress chunked transfer and free its buffered chunks.",
    risk: 0,
    inputSchema: z.object({ transferId: z.string() }),
    handler: (i) => gw.assetBridge.receiveAbort(i.transferId),
  });

  r.register({
    name: "asset_import_url",
    description:
      "Download an image from a public http(s) URL and write it to a local path. Blocks private/loopback/link-local hosts (SSRF protection), follows up to 3 redirects, enforces the configured size limit, and verifies the content is an allowed image type. Returns the path, bytes, detected MIME, and sha256.",
    risk: 2,
    inputSchema: z.object({
      url: z.string().url(),
      destination: z.string().describe("Absolute or repo-relative path to write the image to."),
      overwrite: z.boolean().default(false),
    }),
    summarize: (i) => `import image from ${i.url} -> ${i.destination}`,
    handler: (i) => gw.assetBridge.importUrl({ url: i.url, destination: i.destination, overwrite: i.overwrite }),
  });

  r.register({
    name: "asset_import_latest_download",
    description:
      "Adopt the most recently downloaded image: scan the Downloads folder for the newest matching file and write it to a local path. Use after the user downloads an image from ChatGPT. Returns the path, source, bytes, detected MIME, and sha256.",
    risk: 2,
    inputSchema: z.object({
      destination: z.string().describe("Absolute or repo-relative path to write the image to."),
      overwrite: z.boolean().default(false),
      sinceSeconds: z
        .number()
        .int()
        .positive()
        .default(600)
        .describe("Only consider files modified within this many seconds."),
      allowedExtensions: z.array(z.string()).optional(),
    }),
    summarize: (i) => `import latest download -> ${i.destination}`,
    handler: (i) =>
      gw.assetBridge.importFromDownloads({
        destination: i.destination,
        overwrite: i.overwrite,
        sinceSeconds: i.sinceSeconds,
        allowedExtensions: i.allowedExtensions,
      }),
  });
}
