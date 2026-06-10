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
    const port = await findAvailablePort(49230, "127.0.0.1");
    expect(port).toBe(49230);
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
