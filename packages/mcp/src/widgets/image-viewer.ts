import type { WidgetDef } from "./runtime.js";
import { widgetDocument } from "./runtime.js";

/** Tools whose result carries an inline image payload. */
export const IMAGE_TOOL_NAMES = new Set(["fs_read_file", "fs_read_image", "computer_screenshot"]);
/** `_meta` key under which the base64 image is delivered to the widget. */
export const IMAGE_META_KEY = "localant/image";

const render = `function (ctx) {
  var image = (ctx.meta || {})["${IMAGE_META_KEY}"];
  if (!image || !image.base64 || !image.mimeType) {
    ctx.root.innerHTML = '<div class="empty">No image payload was attached to this result.</div>';
    return;
  }
  var data = (ctx.data && typeof ctx.data === "object") ? ctx.data : {};
  var path = typeof data.path === "string" ? data.path : "";
  var size = typeof image.sizeBytes === "number" ? image.sizeBytes : undefined;
  var src = "data:" + image.mimeType + ";base64," + image.base64;
  var details = [
    path ? "<span>" + ctx.escapeHtml(path) + "</span>" : "",
    (data.width && data.height) ? "<span>" + data.width + " x " + data.height + "</span>" : "",
    size ? "<span>" + ctx.formatBytes(size) + "</span>" : "",
    "<span>" + ctx.escapeHtml(image.mimeType) + "</span>"
  ].filter(Boolean).join("");
  ctx.root.innerHTML = '<div class="frame"><div class="image-wrap"><img alt="LocalAnt image result" src="' + src + '"></div><div class="meta">' + details + "</div></div>";
}`;

const styles = `
.frame { display: grid; gap: 8px; }
.image-wrap { display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: repeating-conic-gradient(rgba(118,128,144,0.16) 0% 25%, transparent 0% 50%) 50% / 20px 20px; }
.image-wrap img { display: block; max-width: 100%; max-height: min(70vh, 720px); object-fit: contain; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 12px; color: var(--muted); word-break: break-word; }
`;

export const imageViewer: WidgetDef = {
  id: "image-viewer",
  uri: "ui://localant/image-viewer-v1.html",
  description: "Displays an image returned by a LocalAnt tool.",
  tools: [...IMAGE_TOOL_NAMES],
  invoking: "Reading image...",
  invoked: "Image ready.",
  html: () => widgetDocument({ body: "Loading image...", styles, render }),
};
