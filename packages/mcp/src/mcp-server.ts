import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { APP_VERSION, isToolInProfile, toolAnnotationsForRisk } from "@localant/shared";
import type { Gateway } from "@localant/gateway";

const SESSION_ID = "chatgpt";

export interface ImagePayload {
  mimeType: string;
  base64: string;
}

/**
 * Tools can attach an image to their result via a `__image` field
 * ({ mimeType, base64 }). It is returned to ChatGPT as an MCP image content
 * block and stripped from the JSON text so the payload isn't sent twice.
 */
export function extractImage(data: unknown): { image?: ImagePayload; rest: unknown } {
  if (typeof data !== "object" || data === null || !("__image" in data)) return { rest: data };
  const { __image, ...rest } = data as { __image: unknown } & Record<string, unknown>;
  if (
    typeof __image === "object" && __image !== null &&
    typeof (__image as ImagePayload).mimeType === "string" &&
    typeof (__image as ImagePayload).base64 === "string"
  ) {
    return { image: __image as ImagePayload, rest };
  }
  return { rest: data };
}

/**
 * Build an McpServer that exposes every registered gateway tool. Each MCP tool
 * call is routed through gateway.executeTool, applying the full safety
 * pipeline (validation → approval → redaction → audit).
 */
export function buildMcpServer(gw: Gateway): McpServer {
  const server = new McpServer({ name: "LocalAnt", version: APP_VERSION });

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
      },
      async (args: unknown) => {
        const result = await gw.executeTool(tool.name, args, { caller: "chatgpt", sessionId: SESSION_ID });
        const { image, rest } = extractImage(result.data);
        const text = JSON.stringify({ ...result, data: rest }, null, 2);
        return {
          content: [
            { type: "text" as const, text },
            ...(image ? [{ type: "image" as const, data: image.base64, mimeType: image.mimeType }] : []),
          ],
          isError: !result.ok && !result.approvalRequired,
        };
      },
    );
  }

  return server;
}
