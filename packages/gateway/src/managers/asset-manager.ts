import crypto from "node:crypto";
import dns from "node:dns";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { Config } from "@localant/shared";
import type { FsManager } from "./fs-manager.js";
import { detectImageMime, svgHasActiveContent, type ImageMime } from "../util/image-bytes.js";
import { assertSafeUrl, isPrivateAddress, SsrfError } from "../util/ssrf.js";

/** Where the image bytes come from. */
export type AssetSource =
  | { kind: "base64"; data: string; sha256?: string }
  | { kind: "url"; url: string }
  | { kind: "latest_download"; sinceSeconds?: number; allowedExtensions?: string[] };

export interface AssetResult {
  path: string;
  bytes: number;
  mimeType: ImageMime;
  sha256: string;
  source: string;
  backupId?: string;
}

const REDIRECT_LIMIT = 3;
const DEFAULT_DOWNLOAD_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];

/**
 * The Asset Bridge: get an image produced or referenced in a ChatGPT
 * conversation onto the local repo. A single entry point, {@link saveImage},
 * resolves bytes from one of three sources (inline base64, a public URL, or the
 * newest matching file in Downloads) and runs them all through one validation +
 * write path: magic-byte sniff → MIME allowlist → SVG active-content scan →
 * sha256 → PathGuard write with backup.
 */
export class AssetManager {
  constructor(
    private readonly fsManager: FsManager,
    private readonly config: () => Config,
  ) {}

  private maxBytes(): number {
    return this.config().assets.maxAssetBytes;
  }

  private allowedMimes(): Set<string> {
    return new Set(this.config().assets.allowedMimeTypes);
  }

  private downloadsDir(): string {
    const configured = this.config().assets.downloadsDir;
    if (configured && configured.trim()) return path.resolve(configured.trim());
    return path.join(os.homedir(), "Downloads");
  }

  /** Resolve the bytes for a source, validate, and write to `destination`. */
  async saveImage(source: AssetSource, destination: string, overwrite = false): Promise<AssetResult> {
    switch (source.kind) {
      case "base64": {
        const data = this.decodeBase64(source.data);
        return this.finalize(data, destination, overwrite, "base64", source.sha256);
      }
      case "url": {
        const data = await this.fetchSafely(source.url);
        return this.finalize(data, destination, overwrite, source.url);
      }
      case "latest_download": {
        const { data, from } = this.readLatestDownload(source.sinceSeconds, source.allowedExtensions);
        return this.finalize(data, destination, overwrite, from);
      }
    }
  }

  private decodeBase64(b64: string): Buffer {
    let buf: Buffer;
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      throw new Error("source.data is not valid base64.");
    }
    if (buf.length === 0) throw new Error("source.data decoded to zero bytes.");
    return buf;
  }

  /**
   * Validate a decoded asset buffer and write it. Throws on any policy
   * violation; the buffer is never written unless every check passes.
   */
  private finalize(
    data: Buffer,
    destination: string,
    overwrite: boolean,
    source: string,
    expectedSha256?: string,
  ): AssetResult {
    if (data.length === 0) throw new Error("Asset is empty.");
    if (data.length > this.maxBytes()) {
      throw new Error(`Asset too large (${data.length} bytes > ${this.maxBytes()} limit).`);
    }

    const sha256 = crypto.createHash("sha256").update(data).digest("hex");
    if (expectedSha256 && expectedSha256.toLowerCase() !== sha256) {
      throw new Error(`Checksum mismatch: expected ${expectedSha256}, got ${sha256}.`);
    }

    const mimeType = detectImageMime(data);
    if (!mimeType) {
      throw new Error("Unsupported or unrecognized image content (magic-byte sniff failed).");
    }
    if (!this.allowedMimes().has(mimeType)) {
      throw new Error(`MIME type '${mimeType}' is not in the configured allowlist.`);
    }
    if (mimeType === "image/svg+xml" && svgHasActiveContent(data)) {
      throw new Error("SVG contains active content (script/event handlers); refusing to save.");
    }

    const written = this.fsManager.writeBytes(destination, data, overwrite);
    return {
      path: written.path,
      bytes: written.bytes,
      mimeType,
      sha256,
      source,
      ...(written.backupId ? { backupId: written.backupId } : {}),
    };
  }

  // --- Source: URL (SSRF-guarded) ----------------------------------------

  /**
   * Fetch a URL with SSRF protection: http(s) only, no private/loopback hosts,
   * redirects followed manually (re-validated, capped), Content-Length and
   * streamed-byte ceilings enforced.
   */
  private async fetchSafely(rawUrl: string, depth = 0): Promise<Buffer> {
    if (depth > REDIRECT_LIMIT) throw new SsrfError("Too many redirects.");
    const url = assertSafeUrl(rawUrl);
    await this.assertHostResolvesPublic(url.hostname.replace(/^\[|\]$/g, ""));

    const res = await fetch(url, { redirect: "manual", headers: { accept: "image/*" } });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new SsrfError(`Redirect with no Location header (status ${res.status}).`);
      return this.fetchSafely(new URL(location, url).toString(), depth + 1);
    }
    if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status} for ${rawUrl}.`);

    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > this.maxBytes()) {
      throw new Error(`Remote asset too large (Content-Length ${declared} > ${this.maxBytes()}).`);
    }

    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > this.maxBytes()) {
      throw new Error(`Remote asset too large (${data.length} bytes > ${this.maxBytes()}).`);
    }
    return data;
  }

  /** Reject a hostname whose resolved addresses include any private IP. */
  private async assertHostResolvesPublic(host: string): Promise<void> {
    if (net.isIP(host)) {
      if (isPrivateAddress(host)) throw new SsrfError(`Refusing to fetch from private address: ${host}`);
      return;
    }
    let addrs: { address: string }[];
    try {
      addrs = await dns.promises.lookup(host, { all: true });
    } catch {
      throw new SsrfError(`Could not resolve host: ${host}`);
    }
    if (addrs.length === 0) throw new SsrfError(`Host did not resolve: ${host}`);
    for (const a of addrs) {
      if (isPrivateAddress(a.address)) {
        throw new SsrfError(`Host ${host} resolves to a private address (${a.address}); refusing.`);
      }
    }
  }

  // --- Source: latest download -------------------------------------------

  private readLatestDownload(sinceSeconds?: number, allowedExtensions?: string[]): { data: Buffer; from: string } {
    const dir = this.downloadsDir();
    if (!fs.existsSync(dir)) throw new Error(`Downloads directory not found: ${dir}`);

    const exts = (allowedExtensions ?? DEFAULT_DOWNLOAD_EXTS).map((e) => e.toLowerCase());
    const sinceMs = sinceSeconds && sinceSeconds > 0 ? Date.now() - sinceSeconds * 1000 : 0;

    let newest: { full: string; mtimeMs: number } | undefined;
    for (const name of fs.readdirSync(dir)) {
      if (!exts.includes(path.extname(name).toLowerCase())) continue;
      const full = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.mtimeMs < sinceMs) continue;
      if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { full, mtimeMs: stat.mtimeMs };
    }

    if (!newest) {
      throw new Error(
        `No matching image found in ${dir}` +
          (sinceSeconds ? ` within the last ${sinceSeconds}s.` : ".") +
          " Download the image first, then retry.",
      );
    }
    if (fs.statSync(newest.full).size > this.maxBytes()) {
      throw new Error(`Downloaded asset too large (> ${this.maxBytes()} bytes).`);
    }
    return { data: fs.readFileSync(newest.full), from: newest.full };
  }
}
