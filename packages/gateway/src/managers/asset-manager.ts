import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Config } from "@localant/shared";
import type { FsManager } from "./fs-manager.js";
import { detectImageMime, extensionForMime, svgHasActiveContent, type ImageMime } from "../util/image-bytes.js";
import { assertSafeUrl, isPrivateAddress, SsrfError } from "../util/ssrf.js";

/** An in-progress chunked transfer held in memory until committed or evicted. */
interface Transfer {
  id: string;
  fileName: string;
  destination: string;
  overwrite: boolean;
  totalBytes: number;
  expectedSha256?: string;
  chunks: Map<number, Buffer>;
  receivedBytes: number;
  createdAt: number;
}

export interface AssetResult {
  path: string;
  bytes: number;
  mimeType: ImageMime;
  sha256: string;
  backupId?: string;
}

const REDIRECT_LIMIT = 3;

/**
 * The Asset Bridge: gets images produced or referenced in a ChatGPT
 * conversation onto the local repo, via three routes that share one validation
 * + write path (magic-byte sniff → MIME allowlist → SVG active-content scan →
 * sha256 → PathGuard write with backup):
 *
 *  1. base64 chunk relay  — receiveStart / receiveChunk / receiveCommit
 *  2. URL import          — importUrl (SSRF-guarded)
 *  3. latest download     — importFromDownloads
 */
export class AssetManager {
  private readonly transfers = new Map<string, Transfer>();

  constructor(
    private readonly fsManager: FsManager,
    private readonly config: () => Config,
  ) {}

  private maxBytes(): number {
    return this.config().assets.maxAssetBytes;
  }

  private ttlMs(): number {
    return this.config().assets.transferTtlMs;
  }

  private allowedMimes(): Set<string> {
    return new Set(this.config().assets.allowedMimeTypes);
  }

  private downloadsDir(): string {
    const configured = this.config().assets.downloadsDir;
    if (configured && configured.trim()) return path.resolve(configured.trim());
    return path.join(os.homedir(), "Downloads");
  }

  /** Drop transfers whose TTL has elapsed (best-effort, called opportunistically). */
  private evictExpired(now = Date.now()): void {
    const ttl = this.ttlMs();
    for (const [id, t] of this.transfers) {
      if (now - t.createdAt > ttl) this.transfers.delete(id);
    }
  }

  /**
   * Validate a decoded asset buffer and write it to its destination. Shared by
   * all three import routes. Throws on any policy violation; the buffer is never
   * written unless every check passes.
   */
  private finalize(data: Buffer, destination: string, overwrite: boolean, expectedSha256?: string): AssetResult {
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
      ...(written.backupId ? { backupId: written.backupId } : {}),
    };
  }

  // --- Route 1: base64 chunk relay ---------------------------------------

  receiveStart(opts: {
    fileName: string;
    totalBytes: number;
    destination: string;
    overwrite?: boolean;
    sha256?: string;
  }): { transferId: string; chunkSizeHint: number } {
    this.evictExpired();
    if (opts.totalBytes <= 0) throw new Error("totalBytes must be positive.");
    if (opts.totalBytes > this.maxBytes()) {
      throw new Error(`Declared size ${opts.totalBytes} exceeds the ${this.maxBytes()} byte limit.`);
    }
    const id = nanoid(16);
    this.transfers.set(id, {
      id,
      fileName: opts.fileName,
      destination: opts.destination,
      overwrite: opts.overwrite ?? false,
      totalBytes: opts.totalBytes,
      expectedSha256: opts.sha256?.toLowerCase(),
      chunks: new Map(),
      receivedBytes: 0,
      createdAt: Date.now(),
    });
    // ~48 KB of raw bytes per chunk → ~64 KB of base64, a safe per-call payload.
    return { transferId: id, chunkSizeHint: 49_152 };
  }

  receiveChunk(opts: {
    transferId: string;
    index: number;
    dataBase64: string;
  }): { transferId: string; receivedBytes: number; totalBytes: number; chunks: number } {
    this.evictExpired();
    const t = this.transfers.get(opts.transferId);
    if (!t) throw new Error(`Unknown or expired transfer: ${opts.transferId}`);
    if (t.chunks.has(opts.index)) {
      throw new Error(`Chunk ${opts.index} already received for transfer ${opts.transferId}.`);
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(opts.dataBase64, "base64");
    } catch {
      throw new Error(`Chunk ${opts.index} is not valid base64.`);
    }
    if (t.receivedBytes + buf.length > t.totalBytes) {
      throw new Error(
        `Chunk ${opts.index} overflows declared totalBytes (${t.totalBytes}); received so far ${t.receivedBytes}.`,
      );
    }
    t.chunks.set(opts.index, buf);
    t.receivedBytes += buf.length;
    return { transferId: t.id, receivedBytes: t.receivedBytes, totalBytes: t.totalBytes, chunks: t.chunks.size };
  }

  receiveCommit(opts: { transferId: string }): AssetResult {
    const t = this.transfers.get(opts.transferId);
    if (!t) throw new Error(`Unknown or expired transfer: ${opts.transferId}`);
    if (t.receivedBytes !== t.totalBytes) {
      throw new Error(`Incomplete transfer: received ${t.receivedBytes} of ${t.totalBytes} bytes.`);
    }
    // Reassemble in index order; reject gaps.
    const indices = [...t.chunks.keys()].sort((a, b) => a - b);
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] !== i) throw new Error(`Missing chunk ${i} for transfer ${t.id}.`);
    }
    const data = Buffer.concat(indices.map((i) => t.chunks.get(i)!));
    try {
      return this.finalize(data, t.destination, t.overwrite, t.expectedSha256);
    } finally {
      this.transfers.delete(t.id);
    }
  }

  /** Abandon an in-progress transfer (frees the buffered chunks). */
  receiveAbort(transferId: string): { aborted: boolean } {
    return { aborted: this.transfers.delete(transferId) };
  }

  // --- Route 2: URL import -----------------------------------------------

  async importUrl(opts: {
    url: string;
    destination: string;
    overwrite?: boolean;
  }): Promise<AssetResult> {
    const data = await this.fetchSafely(opts.url);
    return this.finalize(data, opts.destination, opts.overwrite ?? false);
  }

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

    const arrayBuf = await res.arrayBuffer();
    const data = Buffer.from(arrayBuf);
    if (data.length > this.maxBytes()) {
      throw new Error(`Remote asset too large (${data.length} bytes > ${this.maxBytes()}).`);
    }
    return data;
  }

  /** Reject a hostname whose resolved addresses include any private IP. */
  private async assertHostResolvesPublic(host: string): Promise<void> {
    const net = await import("node:net");
    if (net.isIP(host)) {
      if (isPrivateAddress(host)) throw new SsrfError(`Refusing to fetch from private address: ${host}`);
      return;
    }
    const dns = await import("node:dns");
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

  // --- Route 3: latest download ------------------------------------------

  async importFromDownloads(opts: {
    destination: string;
    overwrite?: boolean;
    sinceSeconds?: number;
    allowedExtensions?: string[];
  }): Promise<AssetResult & { source: string }> {
    const dir = this.downloadsDir();
    if (!fs.existsSync(dir)) throw new Error(`Downloads directory not found: ${dir}`);

    const exts = (opts.allowedExtensions ?? [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]).map((e) =>
      e.toLowerCase(),
    );
    const sinceMs = opts.sinceSeconds && opts.sinceSeconds > 0 ? Date.now() - opts.sinceSeconds * 1000 : 0;

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
      if (!stat.isFile()) continue;
      if (stat.mtimeMs < sinceMs) continue;
      if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { full, mtimeMs: stat.mtimeMs };
    }

    if (!newest) {
      throw new Error(
        `No matching image found in ${dir}` +
          (opts.sinceSeconds ? ` within the last ${opts.sinceSeconds}s.` : ".") +
          " Download the image first, then retry.",
      );
    }
    if (fs.statSync(newest.full).size > this.maxBytes()) {
      throw new Error(`Downloaded asset too large (> ${this.maxBytes()} bytes).`);
    }
    const data = fs.readFileSync(newest.full);
    return { ...this.finalize(data, opts.destination, opts.overwrite ?? false), source: newest.full };
  }

  /** Suggest a destination filename extension based on detected content. */
  static suggestExtension = extensionForMime;
}
