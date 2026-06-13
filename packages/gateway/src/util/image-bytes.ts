/**
 * Content-sniffing helpers for image assets.
 *
 * The Asset Bridge never trusts a caller-declared MIME type. Every received or
 * imported asset is verified against its actual leading bytes (and, for SVG,
 * scanned for active content) before it is written to disk.
 */

export type ImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/svg+xml";

/** PNG signature: 89 50 4E 47 0D 0A 1A 0A. */
function isPng(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

/** JPEG: starts with FF D8 FF. */
function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/** GIF: "GIF87a" or "GIF89a". */
function isGif(buf: Buffer): boolean {
  if (buf.length < 6) return false;
  const sig = buf.toString("latin1", 0, 6);
  return sig === "GIF87a" || sig === "GIF89a";
}

/** WebP: "RIFF" .... "WEBP" (RIFF container with a WEBP fourcc). */
function isWebp(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.toString("latin1", 0, 4) === "RIFF" &&
    buf.toString("latin1", 8, 12) === "WEBP"
  );
}

/**
 * SVG: an XML/text document whose first non-whitespace markup is `<?xml` or an
 * `<svg` element (allowing a leading BOM and a leading comment/doctype). Only
 * the head of the buffer is inspected.
 */
export function looksLikeSvg(buf: Buffer): boolean {
  // Reject binary content early (NUL bytes never appear in well-formed SVG).
  const head = buf.subarray(0, Math.min(buf.length, 4096));
  if (head.includes(0)) return false;
  let text = head.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const trimmed = text.replace(/^\s+/, "").toLowerCase();
  return (
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<!doctype svg") ||
    trimmed.startsWith("<svg") ||
    // XML prolog or comment may precede the root <svg> element.
    /<svg[\s>]/.test(trimmed.slice(0, 1024))
  );
}

const SVG_ACTIVE_CONTENT = [
  /<script[\s>]/i,
  /\son\w+\s*=/i, // onload=, onclick=, …
  /javascript:/i,
  /<foreignobject[\s>]/i,
  /<!entity/i,
  /<iframe[\s>]/i,
];

/**
 * True if an SVG document contains active/scriptable content. Such SVGs are
 * rejected by the bridge (they are an XSS / SSRF vector when later rendered).
 */
export function svgHasActiveContent(buf: Buffer): boolean {
  const text = buf.toString("utf8");
  return SVG_ACTIVE_CONTENT.some((rx) => rx.test(text));
}

/**
 * Detect the image MIME type from the actual bytes. Returns null when the
 * content does not match any supported image format.
 */
export function detectImageMime(buf: Buffer): ImageMime | null {
  if (isPng(buf)) return "image/png";
  if (isJpeg(buf)) return "image/jpeg";
  if (isGif(buf)) return "image/gif";
  if (isWebp(buf)) return "image/webp";
  if (looksLikeSvg(buf)) return "image/svg+xml";
  return null;
}

/** Conventional file extension for a detected image MIME. */
export function extensionForMime(mime: ImageMime): string {
  switch (mime) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "image/svg+xml":
      return ".svg";
  }
}
