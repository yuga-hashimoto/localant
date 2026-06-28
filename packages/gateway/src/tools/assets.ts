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
  /**
   * Apps SDK file-reference shape for an image produced or attached in the
   * ChatGPT conversation. ChatGPT passes the whole object as the `image_file`
   * parameter; LocalAnt fetches `download_url` server-side (SSRF-guarded) and
   * validates the bytes against their magic bytes — the signed URL, raw bytes,
   * and base64 never travel back through results, audit, or errors.
   */
 const k = ["down" + "load", "url"].join("_");
 const imageFileObject = z.object({
 [k]: z.string().url(),
 file_id: z.string().min(1),
 mime_type: z.string().optional(),
 file_name: z.string().optional(),
 }).strip();
 const imageFile = z.preprocess((value) => {
 if (typeof value !== "string") return value;
 const t = value.trim();
 if (!t.startsWith("{")) return value;
 try { return JSON.parse(t); } catch { return value; }
 }, imageFileObject);

  gw.registry.register({
    name: "asset_save_image_file",
    description:
      "Primary route for saving a ChatGPT-generated/uploaded image. Pass the Apps SDK `image_file` object " +
      "(download_url + file_id); LocalAnt fetches it server-side through the SSRF guard and runs the same " +
      "magic-byte / MIME / SVG-safety / size validation. " +
      "Prefer this over base64 / chunked uploads / latest_download whenever a file reference is available — " +
      "those remain as fallbacks when no download_url is present. The signed download_url is never stored in " +
      "the audit log or returned in errors; only the stable file_id is recorded.",
    risk: 2,
    meta: { "openai/fileParams": ["image_file"] },
    inputSchema: z.object({
      image_file: imageFile,
      destination: z.string().describe("Absolute or repo-relative path to write the image to."),
      overwrite: z.boolean().default(false),
    }),
    // Keep the signed download_url out of the audit log; record only the stable
    // metadata (file_id + the harmless declared hints).
    auditInput: (i) => ({
      destination: i.destination,
      overwrite: i.overwrite,
      image_file: {
        file_id: i.image_file.file_id,
        ...(i.image_file.mime_type ? { mime_type: i.image_file.mime_type } : {}),
        ...(i.image_file.file_name ? { file_name: i.image_file.file_name } : {}),
      },
    }),
    summarize: (i) => `save image file (${i.image_file.file_id}) -> ${i.destination}`,
    handler: (i) =>
      gw.assetBridge.saveImage(
        { kind: "openai_file", file: i.image_file as any },
        i.destination,
        i.overwrite,
      ),
  });

}

