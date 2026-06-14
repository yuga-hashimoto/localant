export { Gateway, ApprovalRequiredError } from "./gateway.js";
export type { ToolResult } from "./gateway.js";
export { ToolRegistry } from "./registry.js";
export type { ToolDefinition, ToolCallContext } from "./registry.js";
export { registerAllTools } from "./tools/index.js";
export { closeBrowserSession } from "./tools/browser.js";
export { buildKeyComboArgs, buildTypeArgs, SPECIAL_KEYS, MODIFIERS } from "./tools/computer.js";
export type { Modifier } from "./tools/computer.js";
export { McpBridge, withMcpTimeout } from "./managers/mcp-bridge.js";
export { assembleAgentArgs } from "./managers/coding-agent-manager.js";
export { ProviderRegistry } from "./autopilot/provider-registry.js";
export { AutopilotEngine } from "./autopilot/engine.js";
export type { AutopilotRunInput, AutopilotRunResult, AutopilotAttempt } from "./autopilot/engine.js";
export { resolveProviderOrder, isProviderEnabled } from "./autopilot/settings.js";
export { shouldFallback, looksRateLimited, looksCommandNotFound } from "./autopilot/fallback-policy.js";
export { providerLabel } from "./autopilot/labels.js";
export { CodingAgentProvider } from "./autopilot/coding-agent-provider.js";
export type {
  AutopilotProvider,
  AutopilotProviderInput,
  AutopilotProviderResult,
  ProviderAvailability,
} from "./autopilot/types.js";
export { resolveTailscale, tailscaleEnv } from "./managers/tunnel-manager.js";
export { PathGuard, PathAccessError } from "./security/path-guard.js";
export { AssetManager } from "./managers/asset-manager.js";
export type { AssetResult, AssetSource } from "./managers/asset-manager.js";
export { detectImageMime, looksLikeSvg, svgHasActiveContent, extensionForMime } from "./util/image-bytes.js";
export type { ImageMime } from "./util/image-bytes.js";
export { assertSafeUrl, isPrivateAddress, SsrfError } from "./util/ssrf.js";
export { CommandGuard, CommandRejectedError, parseCommand } from "./security/command-guard.js";
export { commandExists, execFileSafe, resolveExecutable } from "./util/exec.js";
export { optionalDepsDir, resolveOptionalDep } from "./util/optional-deps-path.js";
export { SecretVault } from "./stores/secret-vault.js";
export { ApprovalStore } from "./stores/approval-store.js";
export { AuditLog } from "./stores/audit-log.js";
export { ConfigStore } from "./stores/config-store.js";

import { Gateway } from "./gateway.js";
import { registerAllTools } from "./tools/index.js";

/** Convenience factory: construct a gateway and register all built-in tools. */
export function createGateway(base?: string): Gateway {
  const gw = new Gateway(base);
  registerAllTools(gw);
  return gw;
}
