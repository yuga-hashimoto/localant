import net from "node:net";

/** Resolve true if a TCP port can be bound on the given host. */
function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

/**
 * Find an available TCP port, starting at `preferred` and scanning upward.
 * Ports listed in `skip` are treated as taken (used to avoid the gateway and
 * dashboard colliding with each other). Throws if none is free within range.
 *
 * This is what lets setup survive a busy default port — e.g. Cloudflare's
 * `workerd`/`wrangler dev`, which also defaults to 8787.
 */
export async function findAvailablePort(
  preferred: number,
  host = "127.0.0.1",
  skip: number[] = [],
  attempts = 50,
): Promise<number> {
  const taken = new Set(skip);
  for (let i = 0; i < attempts; i++) {
    const port = preferred + i;
    if (port > 65535) break;
    if (taken.has(port)) continue;
    if (await isPortFree(port, host)) return port;
  }
  throw new Error(
    `No free port found near ${preferred} on ${host} (tried ${attempts}). ` +
      `Set gateway.port to a free port in config.json.`,
  );
}
