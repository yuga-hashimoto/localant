/**
 * Secret redaction utilities. Secrets must never appear in tool responses
 * or in the audit log. We redact both known secret values and high-entropy
 * token-shaped strings.
 */

const TOKEN_PATTERNS: RegExp[] = [
  // Common API key / token shapes
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  // Authorization headers
  /(Authorization:\s*Bearer\s+)[A-Za-z0-9._-]+/gi,
];

const REDACTED = "«redacted»";

/**
 * Redact known secret values (exact substrings) plus token-shaped strings.
 * @param knownSecrets explicit secret values to scrub (e.g. vault contents).
 */
export function redact(input: string, knownSecrets: string[] = []): string {
  let out = input;
  for (const secret of knownSecrets) {
    if (secret && secret.length >= 4) {
      out = out.split(secret).join(REDACTED);
    }
  }
  for (const pattern of TOKEN_PATTERNS) {
    out = out.replace(pattern, (m, p1?: string) => (p1 ? `${p1}${REDACTED}` : REDACTED));
  }
  return out;
}

/** Recursively redact strings inside an arbitrary JSON-like value. */
export function redactDeep<T>(value: T, knownSecrets: string[] = []): T {
  if (typeof value === "string") {
    return redact(value, knownSecrets) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v, knownSecrets)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactDeep(v, knownSecrets);
    }
    return out as unknown as T;
  }
  return value;
}

/** Truncate a string to a max length, appending a marker when cut. */
export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  const omitted = input.length - max;
  return `${input.slice(0, max)}\n… [truncated ${omitted} chars]`;
}
