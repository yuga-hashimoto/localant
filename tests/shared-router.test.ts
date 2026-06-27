import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRoutedMcpEndpoint,
  createSharedRouterServer,
  normalizeRoutePrefix,
  selectAvailableRouterPort,
} from "../packages/cli/src/shared-router.js";

const servers: http.Server[] = [];

function listen(server: http.Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("shared Tailscale MCP router", () => {
  it("builds path-scoped MCP endpoints", () => {
    expect(buildRoutedMcpEndpoint("https://machine.ts.net/", "/localant", "abc")).toBe(
      "https://machine.ts.net/localant/mcp?key=abc",
    );
  });

  it("rejects unsafe prefixes", () => {
    expect(() => normalizeRoutePrefix("../localant")).toThrow(/Invalid/);
    expect(() => normalizeRoutePrefix("local ant")).toThrow(/Invalid/);
  });

  it("strips the route prefix before proxying to the service", async () => {
    const upstream = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ method: req.method, url: req.url }));
    });
    const upstreamPort = await listen(upstream);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-router-"));
    const configFile = path.join(dir, "config.json");
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        port: 0,
        routes: {
          localant: { name: "localant", prefix: "/localant", target: `http://127.0.0.1:${upstreamPort}` },
        },
      }),
    );
    const routerPort = await listen(createSharedRouterServer(configFile));

    const res = await fetch(`http://127.0.0.1:${routerPort}/localant/mcp?key=abc`, { method: "POST" });
    await expect(res.json()).resolves.toEqual({ method: "POST", url: "/mcp?key=abc" });
  });

  it("moves to another router port when the preferred port belongs to another service", async () => {
    const otherService = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end("not the shared router");
    });
    const occupiedPort = await listen(otherService);

    await expect(selectAvailableRouterPort(occupiedPort)).resolves.not.toBe(occupiedPort);
  });
});
