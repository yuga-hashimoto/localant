import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Config } from "@chatgpt-local-app/shared";
import { createLogger } from "@chatgpt-local-app/shared";

const log = createLogger("mcp-bridge");

interface BridgeServer {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
  connected: boolean;
}

/**
 * Manages live stdio MCP client connections to downstream servers.
 * Each server gets its own Client + Transport, lazily initialized on first use.
 * Tool calls are proxied through the gateway's approval pipeline.
 */
export class McpBridge {
  private servers = new Map<string, BridgeServer>();

  constructor(private readonly config: () => Config) {}

  /** Connect to a registered stdio server lazily. */
  private async connect(name: string): Promise<BridgeServer> {
    const cached = this.servers.get(name);
    if (cached?.connected) return cached;

    const cfg = this.config().mcpServers[name];
    if (!cfg) throw new Error(`MCP server '${name}' not registered.`);
    if (!cfg.enabled) throw new Error(`MCP server '${name}' is disabled.`);

    const client = new Client({ name: "chatgpt-local-app-bridge", version: "1.0.0" });
    const transport = new StdioClientTransport({ command: cfg.command, args: cfg.args });

    try {
      await client.connect(transport);
      const tools = await this.listToolsFrom(client);

      const server: BridgeServer = { name, client, transport, tools, connected: true };
      this.servers.set(name, server);
      log.info(`connected to downstream MCP server '${name}' (${tools.length} tools)`);
      return server;
    } catch (err) {
      log.error(`failed to connect to '${name}'`, err);
      try { await transport.close(); } catch { /* ignore */ }
      throw new Error(`Failed to connect to MCP server '${name}': ${(err as Error).message}`);
    }
  }

  private async listToolsFrom(client: Client): Promise<{ name: string; description?: string; inputSchema?: Record<string, unknown> }[]> {
    const result = await client.listTools({});
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    }));
  }

  /** List tools from a downstream server (connects lazily). */
  async listTools(name: string): Promise<{ name: string; description?: string }[]> {
    const server = await this.connect(name);
    return server.tools.map((t) => ({ name: t.name, description: t.description }));
  }

  /** Call a tool on a downstream server. */
  async callTool(name: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const server = await this.connect(name);

    const toolDef = server.tools.find((t) => t.name === toolName);
    if (!toolDef) {
      throw new Error(`Tool '${toolName}' not found on downstream server '${name}'. Available: ${server.tools.map((t) => t.name).join(", ")}`);
    }

    try {
      const result = await server.client.callTool({ name: toolName, arguments: args });
      return result;
    } catch (err) {
      throw new Error(`Downstream tool '${name}.${toolName}' failed: ${(err as Error).message}`);
    }
  }

  /** Disconnect a server. */
  async disconnect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) return;
    try { await server.transport.close(); } catch { /* ignore */ }
    this.servers.delete(name);
    log.info(`disconnected from '${name}'`);
  }

  /** Disconnect all servers. */
  async disconnectAll(): Promise<void> {
    for (const name of this.servers.keys()) {
      await this.disconnect(name);
    }
  }
}
