import net from "node:net";

/**
 * SSRF guards for {@link AssetManager.importUrl}.
 *
 * The gateway runs on the user's own machine, so an unrestricted URL importer
 * would let a remote prompt pull `http://127.0.0.1:…`, link-local metadata
 * endpoints, or LAN hosts into the repo. These helpers reject any non-public
 * destination. They are pure so they can be unit-tested directly.
 */

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

/** True if an IPv4 address is loopback / private / link-local / reserved. */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // not a clean IPv4 — treat as unsafe
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/** True if an IPv6 address is loopback / link-local / ULA / mapped-private. */
function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  // IPv4-mapped (::ffff:a.b.c.d) — re-check the embedded IPv4.
  const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)/.exec(lower);
  if (mapped?.[1]) return isPrivateIpv4(mapped[1]);
  return false;
}

/** True if the given IP literal must not be reached by the importer. */
export function isPrivateAddress(ip: string): boolean {
  const type = net.isIP(ip);
  if (type === 4) return isPrivateIpv4(ip);
  if (type === 6) return isPrivateIpv6(ip);
  return true; // not a valid IP literal — fail closed
}

/**
 * Validate the static parts of a URL (scheme + literal host). Returns the
 * parsed URL. Throws {@link SsrfError} for non-http(s) schemes or hosts that
 * are private IP literals. DNS-name hosts pass here and must be checked again
 * after resolution by the caller.
 */
export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`Only http/https URLs are allowed (got '${url.protocol}').`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (host === "localhost") {
    throw new SsrfError("Refusing to fetch from localhost.");
  }
  if (net.isIP(host) && isPrivateAddress(host)) {
    throw new SsrfError(`Refusing to fetch from a private/loopback address: ${host}`);
  }
  return url;
}
