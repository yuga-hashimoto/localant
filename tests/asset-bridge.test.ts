import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createGateway, detectImageMime, looksLikeSvg, svgHasActiveContent, assertSafeUrl, isPrivateAddress, SsrfError } from "@localant/gateway";
import type { Gateway } from "@localant/gateway";

let base: string;
let workdir: string;
let gw: Gateway;

// A minimal valid 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function ctx() {
  return { caller: "test" };
}

beforeEach(() => {
  fs.mkdirSync(path.join(process.cwd(), ".tmp-tests"), { recursive: true });
  base = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "asset-home-"));
  workdir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "asset-work-"));
  gw = createGateway(base);
  // Default mode is "open": no allowlist restriction, only the sensitive
  // blocklist. The temp workdir is safely writable. Asset tools live in the
  // coding/full profiles, so switch off the minimal default.
  gw.saveConfig({ ...gw.config(), tools: { ...gw.config().tools, profile: "coding" } });
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("image-bytes detection", () => {
  it("detects PNG / JPEG / GIF / WebP / SVG by magic bytes", () => {
    expect(detectImageMime(PNG)).toBe("image/png");
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
    expect(detectImageMime(Buffer.from("GIF89a....", "latin1"))).toBe("image/gif");
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);
    expect(detectImageMime(webp)).toBe("image/webp");
    expect(detectImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("image/svg+xml");
  });

  it("rejects non-image content", () => {
    expect(detectImageMime(Buffer.from("hello world"))).toBeNull();
    expect(detectImageMime(Buffer.from([0x00, 0x01, 0x02]))).toBeNull();
  });

  it("flags active content in SVG", () => {
    expect(svgHasActiveContent(Buffer.from("<svg><script>alert(1)</script></svg>"))).toBe(true);
    expect(svgHasActiveContent(Buffer.from('<svg onload="x()"></svg>'))).toBe(true);
    expect(svgHasActiveContent(Buffer.from('<svg><rect width="1" height="1"/></svg>'))).toBe(false);
    expect(looksLikeSvg(Buffer.from("not svg"))).toBe(false);
  });
});

describe("ssrf guard", () => {
  it("classifies private addresses", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("192.168.0.5")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });

  it("rejects non-http and private-literal URLs", () => {
    expect(() => assertSafeUrl("file:///etc/passwd")).toThrow(SsrfError);
    expect(() => assertSafeUrl("http://127.0.0.1/x.png")).toThrow(SsrfError);
    expect(() => assertSafeUrl("http://localhost/x.png")).toThrow(SsrfError);
    expect(assertSafeUrl("https://example.com/x.png").hostname).toBe("example.com");
  });
});

describe("base64 chunk relay", () => {
  it("transfers, validates and writes an image across chunks", async () => {
    const dest = path.join(workdir, "out.png");
    const sha = crypto.createHash("sha256").update(PNG).digest("hex");

    const startRes = await gw.executeTool(
      "asset_receive_start",
      { fileName: "x.png", totalBytes: PNG.length, destination: dest, sha256: sha },
      ctx(),
    );
    expect(startRes.ok).toBe(true);
    const transferId = (startRes.data as { transferId: string }).transferId;

    // Split into two chunks.
    const mid = Math.floor(PNG.length / 2);
    const c0 = PNG.subarray(0, mid).toString("base64");
    const c1 = PNG.subarray(mid).toString("base64");

    expect((await gw.executeTool("asset_receive_chunk", { transferId, index: 0, dataBase64: c0 }, ctx())).ok).toBe(true);
    expect((await gw.executeTool("asset_receive_chunk", { transferId, index: 1, dataBase64: c1 }, ctx())).ok).toBe(true);

    const commit = await gw.executeTool("asset_receive_commit", { transferId }, ctx());
    expect(commit.ok).toBe(true);
    const data = commit.data as { path: string; mimeType: string; sha256: string; bytes: number };
    expect(data.mimeType).toBe("image/png");
    expect(data.sha256).toBe(sha);
    expect(fs.readFileSync(dest)).toEqual(PNG);
  });

  it("rejects a checksum mismatch on commit", async () => {
    const dest = path.join(workdir, "bad.png");
    const start = await gw.executeTool(
      "asset_receive_start",
      { fileName: "x.png", totalBytes: PNG.length, destination: dest, sha256: "deadbeef" },
      ctx(),
    );
    const transferId = (start.data as { transferId: string }).transferId;
    await gw.executeTool("asset_receive_chunk", { transferId, index: 0, dataBase64: PNG.toString("base64") }, ctx());
    const commit = await gw.executeTool("asset_receive_commit", { transferId }, ctx());
    expect(commit.ok).toBe(false);
    expect(commit.error).toMatch(/checksum mismatch/i);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("rejects non-image content even when bytes transfer cleanly", async () => {
    const dest = path.join(workdir, "evil.png");
    const payload = Buffer.from("#!/bin/sh\nrm -rf /\n");
    const start = await gw.executeTool(
      "asset_receive_start",
      { fileName: "x.png", totalBytes: payload.length, destination: dest },
      ctx(),
    );
    const transferId = (start.data as { transferId: string }).transferId;
    await gw.executeTool("asset_receive_chunk", { transferId, index: 0, dataBase64: payload.toString("base64") }, ctx());
    const commit = await gw.executeTool("asset_receive_commit", { transferId }, ctx());
    expect(commit.ok).toBe(false);
    expect(commit.error).toMatch(/unsupported|unrecognized/i);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("rejects an SVG with active content", async () => {
    const dest = path.join(workdir, "x.svg");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const start = await gw.executeTool(
      "asset_receive_start",
      { fileName: "x.svg", totalBytes: svg.length, destination: dest },
      ctx(),
    );
    const transferId = (start.data as { transferId: string }).transferId;
    await gw.executeTool("asset_receive_chunk", { transferId, index: 0, dataBase64: svg.toString("base64") }, ctx());
    const commit = await gw.executeTool("asset_receive_commit", { transferId }, ctx());
    expect(commit.ok).toBe(false);
    expect(commit.error).toMatch(/active content/i);
  });

  it("keeps base64 payloads out of the audit log", async () => {
    const dest = path.join(workdir, "audited.png");
    const start = await gw.executeTool(
      "asset_receive_start",
      { fileName: "x.png", totalBytes: PNG.length, destination: dest },
      ctx(),
    );
    const transferId = (start.data as { transferId: string }).transferId;
    const b64 = PNG.toString("base64");
    await gw.executeTool("asset_receive_chunk", { transferId, index: 0, dataBase64: b64 }, ctx());
    const entries = gw.audit.readAll();
    const chunkEntry = entries.find((e) => e.tool === "asset_receive_chunk");
    expect(chunkEntry).toBeDefined();
    expect(chunkEntry!.inputSummary).not.toContain(b64.slice(0, 32));
    expect(chunkEntry!.inputSummary).toMatch(/base64Len/);
  });
});

describe("latest download import", () => {
  it("adopts the newest matching image from the downloads dir", async () => {
    const downloads = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "asset-dl-"));
    // Point the bridge at our fake downloads dir.
    const cfg = gw.config();
    gw.saveConfig({ ...cfg, assets: { ...cfg.assets, downloadsDir: downloads } });

    fs.writeFileSync(path.join(downloads, "old.png"), PNG);
    // Make a clearly-newer file.
    const newest = path.join(downloads, "new.png");
    fs.writeFileSync(newest, PNG);
    const future = Date.now() / 1000 + 10;
    fs.utimesSync(newest, future, future);

    const dest = path.join(workdir, "adopted.png");
    const res = await gw.executeTool("asset_import_latest_download", { destination: dest }, ctx());
    expect(res.ok).toBe(true);
    const data = res.data as { source: string; mimeType: string };
    expect(path.basename(data.source)).toBe("new.png");
    expect(data.mimeType).toBe("image/png");
    expect(fs.existsSync(dest)).toBe(true);
    fs.rmSync(downloads, { recursive: true, force: true });
  });

  it("errors when no matching image exists", async () => {
    const downloads = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "asset-dl-empty-"));
    const cfg = gw.config();
    gw.saveConfig({ ...cfg, assets: { ...cfg.assets, downloadsDir: downloads } });
    const res = await gw.executeTool(
      "asset_import_latest_download",
      { destination: path.join(workdir, "x.png") },
      ctx(),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no matching image/i);
    fs.rmSync(downloads, { recursive: true, force: true });
  });
});
