import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import type { Gateway } from "../gateway.js";

/**
 * Asset Bridge — one tool that lands an image produced or referenced in a
 * ChatGPT conversation onto the local repo. The `source` discriminator selects
 * the route (inline base64 / public URL / newest Downloads file); all three go
 * through one validation + write path (magic-byte sniff → MIME allowlist → SVG
 * safety → sha256 → PathGuard write with backup).
 */
export function registerAssetTools(gw: Gateway): void {
  const source = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("base64"),
      data: z.string().describe("Base64-encoded image bytes (PNG/JPEG/WebP/GIF/SVG)."),
      sha256: z.string().optional().describe("Optional hex sha256 of the decoded bytes; verified before writing."),
    }),
    z.object({
      kind: z.literal("url"),
      url: z.string().url().describe("Public http(s) image URL. Private/loopback/metadata hosts are blocked."),
    }),
    z.object({
      kind: z.literal("latest_download"),
      sinceSeconds: z
        .number()
        .int()
        .positive()
        .default(600)
        .describe("Only consider Downloads files modified within this many seconds."),
      allowedExtensions: z.array(z.string()).optional(),
    }),
  ]);

  gw.registry.register({
    name: "asset_save_image",
    description:
      "Save an image to a local path. Pick how the bytes arrive via `source.kind`: " +
      "`base64` (inline data — best for small images the assistant can read directly), " +
      "`url` (fetch a public http(s) image, SSRF-guarded), or " +
      "`latest_download` (adopt the newest matching image from the Downloads folder, after the user downloads it). " +
      "All routes verify the content is a real PNG/JPEG/WebP/GIF/SVG, reject scriptable SVGs, and write atomically (a backup is kept on overwrite). Returns the path, bytes, detected MIME, sha256, and source.",
    risk: 2,
    inputSchema: z.object({
      source,
      destination: z.string().describe("Absolute or repo-relative path to write the image to."),
      overwrite: z.boolean().default(false),
    }),
    // Keep inline base64 out of the audit log; record only its length.
    auditInput: (i) => ({
      destination: i.destination,
      overwrite: i.overwrite,
      source:
        i.source.kind === "base64"
          ? { kind: "base64", base64Len: i.source.data.length, sha256: i.source.sha256 }
          : i.source,
    }),
    summarize: (i) => {
      const from =
        i.source.kind === "url"
          ? i.source.url
          : i.source.kind === "latest_download"
            ? "latest download"
            : "base64";
      return `save image (${from}) -> ${i.destination}`;
    },
    handler: (i) => gw.assetBridge.saveImage(i.source, i.destination, i.overwrite),
  });

  gw.registry.register({
    name: "asset_upload_chunk",
    description:
      "Upload one base64 chunk for a large ChatGPT-generated image. Use this when a single asset_save_image base64 payload would be too large; finish with asset_commit_upload.",
    risk: 2,
    inputSchema: z.object({
      uploadId: z.string().min(1).max(120).regex(/^[a-zA-Z0-9._-]+$/),
      index: z.number().int().min(0).max(10_000),
      data: z.string().min(1).describe("One base64 text chunk. It is not written to the audit log."),
    }).strip(),
    auditInput: (i) => ({ uploadId: i.uploadId, index: i.index, base64Len: i.data.length }),
    summarize: (i) => `upload image chunk ${i.index} for ${i.uploadId}`,
    handler: (i) => {
      const dir = uploadDir(gw, i.uploadId);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${String(i.index).padStart(6, "0")}.b64`);
      fs.writeFileSync(file, i.data, "utf8");
      return { ok: true, uploadId: i.uploadId, index: i.index, bytesReceived: i.data.length };
    },
  });

  gw.registry.register({
    name: "asset_commit_upload",
    description:
      "Assemble previously uploaded base64 chunks, validate the image, and save it to a local path using the normal Asset Bridge validation path.",
    risk: 2,
    inputSchema: z.object({
      uploadId: z.string().min(1).max(120).regex(/^[a-zA-Z0-9._-]+$/),
      chunks: z.number().int().min(1).max(10_001),
      destination: z.string().describe("Absolute or repo-relative path to write the assembled image to."),
      overwrite: z.boolean().default(false),
      sha256: z.string().optional().describe("Optional hex sha256 of the decoded image bytes."),
      cleanup: z.boolean().default(true),
    }).strip(),
    auditInput: (i) => ({ ...i, chunkData: "not recorded" }),
    summarize: (i) => `commit chunked image ${i.uploadId} -> ${i.destination}`,
    handler: async (i) => {
      const dir = uploadDir(gw, i.uploadId);
      const parts: string[] = [];
      for (let idx = 0; idx < i.chunks; idx += 1) {
        const file = path.join(dir, `${String(idx).padStart(6, "0")}.b64`);
        if (!fs.existsSync(file)) throw new Error(`Missing image chunk ${idx} for uploadId '${i.uploadId}'.`);
        parts.push(fs.readFileSync(file, "utf8"));
      }
      const result = await gw.assetBridge.saveImage({ kind: "base64", data: parts.join(""), sha256: i.sha256 }, i.destination, i.overwrite);
      if (i.cleanup) fs.rmSync(dir, { recursive: true, force: true });
      return { ...result, source: `chunked:${i.uploadId}` };
    },
  });
}

function uploadDir(gw: Gateway, uploadId: string): string {
  return path.join(gw.paths.root, "asset-uploads", uploadId);
}
