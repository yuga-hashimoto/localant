import fs from "node:fs";
import { createSharedRouterServer, routerConfigPath } from "./shared-router.js";

const configFile = process.env.MCP_TAILSCALE_ROUTER_CONFIG || routerConfigPath();
const server = createSharedRouterServer(configFile);
const parsed = fs.existsSync(configFile) ? (JSON.parse(fs.readFileSync(configFile, "utf8")) as { port?: number }) : {};

server.listen(parsed.port ?? 8790, "127.0.0.1");
