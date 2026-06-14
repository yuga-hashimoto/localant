import { describe, expect, it } from "vitest";
import { withMcpTimeout } from "@localant/gateway";

describe("McpBridge timeout helper", () => {
 it("resolves successful operations", async () => {
 await expect(withMcpTimeout(Promise.resolve(42), "quick", 50)).resolves.toBe(42);
 });

 it("rejects hung operations with context", async () => {
 await expect(withMcpTimeout(new Promise(() => undefined), "list tools from MCP server smoke", 5)).rejects.toThrow(/list tools from MCP server smoke timed out after 5ms/);
 });
});
