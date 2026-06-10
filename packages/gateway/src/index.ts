export { Gateway, ApprovalRequiredError } from "./gateway.js";
export type { ToolResult } from "./gateway.js";
export { ToolRegistry } from "./registry.js";
export type { ToolDefinition, ToolCallContext } from "./registry.js";
export { registerAllTools } from "./tools/index.js";
export { McpBridge } from "./managers/mcp-bridge.js";
export { PathGuard, PathAccessError } from "./security/path-guard.js";
export { CommandGuard, CommandRejectedError, parseCommand } from "./security/command-guard.js";
export { commandExists, execFileSafe } from "./util/exec.js";

import { Gateway } from "./gateway.js";
import { registerAllTools } from "./tools/index.js";

/** Convenience factory: construct a gateway and register all built-in tools. */
export function createGateway(base?: string): Gateway {
  const gw = new Gateway(base);
  registerAllTools(gw);
  return gw;
}
