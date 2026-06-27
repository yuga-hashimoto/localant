import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { APP_VERSION, DEFAULT_SESSION_ID, isToolInProfile, toolAnnotationsForRisk } from "@localant/shared";
import type { Gateway } from "@localant/gateway";
import { IMAGE_META_KEY, imageWidgetMeta, registerWidgets, widgetMetaForTool } from "./widgets/index.js";

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
  registerWidgets(server);

  const toolsConfig = gw.config().tools;
  const profile = toolsConfig.profile;
  const mode = gw.config().security.mode;
  for (const tool of gw.registry.list()) {
    if (!isToolInProfile(tool.name, profile, toolsConfig.features)) continue;
    const shape = (tool.inputSchema as unknown as { shape?: Record<string, z.ZodTypeAny> }).shape ?? {};
    server.registerTool(
      tool.name,
      {
        description: `[risk ${tool.risk}] ${tool.description}`,
        inputSchema: shape,
        // Advertise per-tool MCP hints based on the tool's actual behavior.
        // Gateway approval policy is enforced separately from these hints.
        annotations: tool.annotations ?? toolAnnotationsForRisk(tool.risk, mode),
        _meta: widgetMetaForTool(tool.name),
      },
      async (args: unknown) => {
        const result = await gw.executeTool(tool.name, args, { caller: "chatgpt", sessionId: getSessionId() });
        const { image, rest } = extractImage(result.data);

        // Strip __closeWidget from result data and use it to auto-close the
        // widget on the final batch (e.g. no pending approvals remain).
        let cleanRest = rest;
        let closeWidget = false;
        if (typeof rest === "object" && rest !== null && "__closeWidget" in (rest as Record<string, unknown>)) {
          const { __closeWidget: _, ...cleaned } = rest as Record<string, unknown> & { __closeWidget: boolean };
          cleanRest = cleaned;
          closeWidget = true;
        }

        const response = { ...result, data: imageStructuredData(cleanRest, image) };
        const text = JSON.stringify({ ...result, data: cleanRest }, null, 2);
        let resultMeta: Record<string, unknown> | undefined = image ? { [IMAGE_META_KEY]: image, ...imageWidgetMeta() } : undefined;
        if (closeWidget) {
          resultMeta = { ...resultMeta, "openai/closeWidget": true };
        }
        return {
          structuredContent: response,
          content: [
            { type: "text" as const, text },
            ...(image ? [{ type: "image" as const, data: image.base64, mimeType: image.mimeType }] : []),
          ],
          _meta: resultMeta,
          isError: !result.ok && !result.approvalRequired,
        };
      },
    );
  }

  return server;
}
