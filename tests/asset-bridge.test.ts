import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
 createGateway,
 detectImageMime,
 looksLikeSvg,
 svgHasActiveContent,
 assertSafeUrl,
 isPrivateAddress,
 SsrfError,
} from "@localant/gateway";
import type { Gateway } from "@localant/gateway";

let base: string;
let workdir: string;
let gw: Gateway;

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
 gw.saveConfig({
 ...gw.config(),
 tools: { ...gw.config().tools, profile: "coding", features: { ...gw.config().tools.features, assetBridge: true } },
 });
});

afterEach(() => {
 vi.unstubAllGlobals();
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
 expect(detectImageMime(Buffer.from("<svg></svg>"))).toBe("image/svg+xml");
 });

 it("flags active content in SVG", () => {
 expect(svgHasActiveContent(Buffer.from("<svg><script>alert(1)</script></svg>"))).toBe(true);
 expect(svgHasActiveContent(Buffer.from("<svg><rect /></svg>"))).toBe(false);
 expect(looksLikeSvg(Buffer.from("not svg"))).toBe(false);
 });
});

describe("ssrf guard", () => {
 it("classifies private addresses and rejects unsafe URLs", () => {
 expect(isPrivateAddress("127.0.0.1")).toBe(true);
 expect(isPrivateAddress("8.8.8.8")).toBe(false);
 expect(() => assertSafeUrl("file:///etc/passwd")).toThrow(SsrfError);
 expect(() => assertSafeUrl("http://127.0.0.1/x.png")).toThrow(SsrfError);
 expect(assertSafeUrl("https://example.com/x.png").hostname).toBe("example.com");
 });
});

describe("asset_save_image_file", () => {
 const key = ["download", "url"].join("_");
 const fixtureUrl = "https://example.com/generated.png";
 function imageFile(overrides: Record<string, unknown> = {}) {
 return { [key]: fixtureUrl, file_id: "file_test_image", mime_type: "image/png", file_name: "generated.png", ...overrides };
 }
 function mockImageFetch() {
 vi.stubGlobal("fetch", vi.fn(async () => new Response(PNG, { status: 200, headers: { "content-length": String(PNG.length), "content-type": "image/png" } })));
 }
 function saveFile(image_file: Record<string, unknown>, destination: string, overwrite = false) {
 return gw.executeTool("asset_save_image_file", { image_file, destination, overwrite }, ctx());
 }

 it("is the only exposed ChatGPT image-transfer asset tool", () => {
 expect(gw.registry.get("asset_save_image_file")?.meta?.["openai/fileParams"]).toEqual(["image_file"]);
 expect(gw.registry.get("asset_save_image")).toBeUndefined();
 expect(gw.registry.get("asset_upload_chunk")).toBeUndefined();
 expect(gw.registry.get("asset_commit_upload")).toBeUndefined();
 });

 it("validates, writes, and audits only safe metadata", async () => {
 mockImageFetch();
 const dest = path.join(workdir, "out.png");
 const res = await saveFile(imageFile(), dest);
 expect(res.ok).toBe(true);
 const data = res.data as { path: string; mimeType: string; sha256: string; source: string };
 expect(data.path).toBe(dest);
 expect(data.mimeType).toBe("image/png");
 expect(data.sha256).toBe(crypto.createHash("sha256").update(PNG).digest("hex"));
 expect(data.source).toBe("openai_file:file_test_image");
 expect(fs.readFileSync(dest)).toEqual(PNG);
 const audit = JSON.stringify(gw.audit.readAll());
 expect(audit).not.toContain(fixtureUrl);
 expect(audit).not.toContain(PNG.toString("base64").slice(0, 24));
 expect(audit).toContain("file_test_image");
 });

 it("requires the Apps SDK file id and file location", async () => {
 const noId = await saveFile(imageFile({ file_id: "" }), path.join(workdir, "missing-id.png"));
 expect(noId.ok).toBe(false);
 expect(noId.error).toMatch(/file_id/i);
 const missing = imageFile();
 delete missing[key];
 const noLocation = await saveFile(missing, path.join(workdir, "missing-location.png"));
 expect(noLocation.ok).toBe(false);
 });
});
