import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { APP_VERSION, DEFAULT_SESSION_ID, isToolInProfile, toolAnnotationsForRisk } from "@localant/shared";
import type { Gateway } from "@localant/gateway";

const IMAGE_VIEWER_URI = "ui://localant/image-viewer-v1.html";
const APPS_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
const IMAGE_TOOL_NAMES = new Set(["fs_read_file", "fs_read_image", "computer_screenshot"]);
const IMAGE_META_KEY = "localant/image";

export interface ImagePayload {
  mimeType: string;
  base64: string;
}

export interface ImageResourcePayload extends ImagePayload {
  sizeBytes: number;
}

/**
 * Tools can attach an image to their result via a `__image` field
 * ({ mimeType, base64 }). It is returned to ChatGPT as an MCP image content
 * block and stripped from the JSON text so the payload isn't sent twice.
 */
export function extractImage(data: unknown): { image?: ImageResourcePayload; rest: unknown } {
  if (typeof data !== "object" || data === null || !("__image" in data)) return { rest: data };
  const { __image, ...rest } = data as { __image: unknown } & Record<string, unknown>;
  if (
    typeof __image === "object" && __image !== null &&
    typeof (__image as ImagePayload).mimeType === "string" &&
    typeof (__image as ImagePayload).base64 === "string"
  ) {
    const image = __image as ImagePayload;
    return {
      image: {
        ...image,
        sizeBytes: Buffer.byteLength(image.base64, "base64"),
      },
      rest,
    };
  }
  return { rest: data };
}

function imageStructuredData(data: unknown, image?: ImageResourcePayload): unknown {
  if (!image || typeof data !== "object" || data === null) return data;
  return {
    ...(data as Record<string, unknown>),
    image: {
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
    },
  };
}

function imageToolMeta(name: string): Record<string, unknown> | undefined {
  if (!IMAGE_TOOL_NAMES.has(name)) return undefined;
  return {
    ui: { resourceUri: IMAGE_VIEWER_URI },
    "openai/outputTemplate": IMAGE_VIEWER_URI,
    "openai/toolInvocation/invoking": "Reading image...",
    "openai/toolInvocation/invoked": "Image ready.",
  };
}

function imageViewerHtml(): string {
  return `
<div id="root" class="root">Loading image...</div>
<style>
  :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  body { margin: 0; }
  .root { box-sizing: border-box; width: 100%; min-height: 120px; padding: 12px; color: #172033; }
  .empty, .error { font-size: 13px; line-height: 1.45; color: #5b6472; }
  .frame { display: grid; gap: 8px; }
  .image-wrap { display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid rgba(118, 128, 144, 0.28); border-radius: 8px; background: repeating-conic-gradient(rgba(118, 128, 144, 0.16) 0% 25%, transparent 0% 50%) 50% / 20px 20px; }
  img { display: block; max-width: 100%; max-height: min(70vh, 720px); object-fit: contain; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 12px; line-height: 1.35; color: #5b6472; word-break: break-word; }
  @media (prefers-color-scheme: dark) {
    .root { color: #edf1f7; }
    .empty, .error, .meta { color: #aab3c2; }
    .image-wrap { border-color: rgba(170, 179, 194, 0.28); background-color: #111827; }
  }
</style>
<script>
  const root = document.getElementById("root");
  function metaFromToolResult(toolResult) {
    return toolResult && toolResult._meta ? toolResult._meta : undefined;
  }
  function metaFromOpenAI() {
    const runtimeMeta = window.openai && window.openai.toolResponseMetadata;
    return runtimeMeta && (
      runtimeMeta.call_tool_result && runtimeMeta.call_tool_result._meta ||
      runtimeMeta.mcp_tool_result && runtimeMeta.mcp_tool_result._meta ||
      runtimeMeta._meta
    );
  }
  function render(toolResult) {
    const meta = metaFromToolResult(toolResult) || metaFromOpenAI() || {};
    const image = meta["${IMAGE_META_KEY}"];
    if (!image || !image.base64 || !image.mimeType) {
      root.innerHTML = '<div class="empty">No image payload was attached to this result.</div>';
      return;
    }
    const structured = toolResult && toolResult.structuredContent || window.openai && window.openai.toolOutput || {};
    const data = structured.data || {};
    const path = typeof data.path === "string" ? data.path : "";
    const width = typeof data.width === "number" ? data.width : undefined;
    const height = typeof data.height === "number" ? data.height : undefined;
    const size = typeof image.sizeBytes === "number" ? image.sizeBytes : undefined;
    const src = "data:" + image.mimeType + ";base64," + image.base64;
    const details = [
      path ? '<span>' + escapeHtml(path) + '</span>' : '',
      width && height ? '<span>' + width + ' x ' + height + '</span>' : '',
      size ? '<span>' + formatBytes(size) + '</span>' : '',
      '<span>' + escapeHtml(image.mimeType) + '</span>',
    ].filter(Boolean).join('');
    root.innerHTML = '<div class="frame"><div class="image-wrap"><img alt="LocalAnt image result" src="' + src + '"></div><div class="meta">' + details + '</div></div>';
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }
  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.method === "ui/notifications/tool-result") render(message.params);
  }, { passive: true });
  window.addEventListener("openai:set_globals", (event) => {
    render({ structuredContent: event.detail && event.detail.globals && event.detail.globals.toolOutput });
  }, { passive: true });
  render({ structuredContent: window.openai && window.openai.toolOutput });
</script>
  `.trim();
}

function registerImageViewerResource(server: McpServer): void {
  server.registerResource(
    "localant-image-viewer",
    IMAGE_VIEWER_URI,
    {},
    async () => ({
      contents: [
        {
          uri: IMAGE_VIEWER_URI,
          mimeType: APPS_RESOURCE_MIME_TYPE,
          text: imageViewerHtml(),
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                connectDomains: [],
                resourceDomains: [],
              },
            },
            "openai/widgetDescription": "Displays an image returned by a LocalAnt tool.",
            "openai/widgetPrefersBorder": true,
            "openai/widgetCSP": {
              connect_domains: [],
              resource_domains: [],
            },
          },
        },
      ],
    }),
  );
}

/**
 * Build an McpServer that exposes every registered gateway tool. Each MCP tool
 * call is routed through gateway.executeTool, applying the full safety
 * pipeline (validation → approval → redaction → audit).
 *
 * `getSessionId` resolves the originating ChatGPT chat for every call. In
 * stateful mode it returns the transport's `Mcp-Session-Id`; for stateless
 * callers it falls back to {@link DEFAULT_SESSION_ID}. It is read lazily per
 * call because the session id is only assigned once `initialize` completes.
 */
export function buildMcpServer(gw: Gateway, getSessionId: () => string = () => DEFAULT_SESSION_ID): McpServer {
  const server = new McpServer({ name: "LocalAnt", version: APP_VERSION });
  registerImageViewerResource(server);

  const profile = gw.config().tools.profile;
  const mode = gw.config().security.mode;
  for (const tool of gw.registry.list()) {
    if (!isToolInProfile(tool.name, profile)) continue;
    const shape = (tool.inputSchema as unknown as { shape?: Record<string, z.ZodTypeAny> }).shape ?? {};
    server.registerTool(
      tool.name,
      {
        description: `[risk ${tool.risk}] ${tool.description}`,
        inputSchema: shape,
        // Advertise read-only / destructive hints so MCP clients (e.g. ChatGPT)
        // don't gate safe tools behind a confirmation "safety check". In yolo
        // mode every tool is advertised gate-free, matching the gateway policy.
        annotations: toolAnnotationsForRisk(tool.risk, mode),
        _meta: imageToolMeta(tool.name),
      },
      async (args: unknown) => {
        const result = await gw.executeTool(tool.name, args, { caller: "chatgpt", sessionId: getSessionId() });
        const { image, rest } = extractImage(result.data);
        const response = { ...result, data: imageStructuredData(rest, image) };
        const text = JSON.stringify({ ...result, data: rest }, null, 2);
        return {
          structuredContent: response,
          content: [
            { type: "text" as const, text },
            ...(image ? [{ type: "image" as const, data: image.base64, mimeType: image.mimeType }] : []),
          ],
          _meta: image ? { [IMAGE_META_KEY]: image } : undefined,
          isError: !result.ok && !result.approvalRequired,
        };
      },
    );
  }

  return server;
}
