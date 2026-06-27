import { createSharedRouterServer, routerConfigPath } from "./shared-router.js";

const configFile = process.env.MCP_TAILSCALE_ROUTER_CONFIG || routerConfigPath();
const server = createSharedRouterServer(configFile);

server.listen(8790, "127.0.0.1");
