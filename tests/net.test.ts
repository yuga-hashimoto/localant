import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { findAvailablePort } from "@localant/shared";

const servers: net.Server[] = [];

function occupy(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    servers.push(s);
    s.once("error", reject);
    s.listen(port, "127.0.0.1", () => resolve());
  });
}

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

describe("findAvailablePort", () => {
  it("returns the preferred port when it is free", async () => {
    // Discover a genuinely free port at runtime (a hardcoded port can be taken
    // by an unrelated process on the test machine).
    const free = await new Promise<number>((resolve, reject) => {
      const s = net.createServer();
      s.once("error", reject);
      s.listen(0, "127.0.0.1", () => {
        const addr = s.address();
        const p = typeof addr === "object" && addr ? addr.port : 0;
        s.close(() => resolve(p));
      });
    });
    const port = await findAvailablePort(free, "127.0.0.1");
    expect(port).toBe(free);
  });

  it("falls back to the next free port when the preferred one is busy", async () => {
    await occupy(49231);
    const port = await findAvailablePort(49231, "127.0.0.1");
    expect(port).toBe(49232);
  });

  it("skips ports listed in `skip` (gateway vs dashboard collision)", async () => {
    const port = await findAvailablePort(49240, "127.0.0.1", [49240]);
    expect(port).toBe(49241);
  });

  it("throws when no port is free within the attempt window", async () => {
    await expect(findAvailablePort(49250, "127.0.0.1", [], 0)).rejects.toThrow(/No free port/);
  });
});
