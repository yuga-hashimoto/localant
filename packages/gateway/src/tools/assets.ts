import { z } from "zod";
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
}
