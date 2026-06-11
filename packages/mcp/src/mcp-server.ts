import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { APP_VERSION, isToolInProfile } from "@localant/shared";
import type { Gateway } from "@localant/gateway";

const SESSION_ID = "chatgpt";

/**
 * Build an McpServer that exposes every registered gateway tool. Each MCP tool
 * call is routed through gateway.executeTool, applying the full safety
 * pipeline (validation → approval → redaction → audit).
 */
export function buildMcpServer(gw: Gateway): McpServer {
  const server = new McpServer({ name: "LocalAnt", version: APP_VERSION });

  const profile = gw.config().tools.profile;
  for (const tool of gw.registry.list()) {
    if (!isToolInProfile(tool.name, profile)) continue;
    const shape = (tool.inputSchema as unknown as { shape?: Record<string, z.ZodTypeAny> }).shape ?? {};
    server.registerTool(
      tool.name,
      {
        description: `[risk ${tool.risk}] ${tool.description}`,
        inputSchema: shape,
      },
      async (args: unknown) => {
        const result = await gw.executeTool(tool.name, args, { caller: "chatgpt", sessionId: SESSION_ID });
        const text = JSON.stringify(result, null, 2);
        return {
          content: [{ type: "text" as const, text }],
          isError: !result.ok && !result.approvalRequired,
        };
      },
    );
  }

  return server;
}
