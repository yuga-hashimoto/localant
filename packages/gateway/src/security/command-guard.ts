import type { SecurityMode } from "@localant/shared";

export class CommandRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandRejectedError";
  }
}

export interface ParsedCommand {
  /** Whitespace-normalized full command. */
  normalized: string;
  /** Individual program words (first token of each pipeline/segment + args). */
  tokens: string[];
}

/**
 * Tokenize a command for safety inspection. We split on shell control
 * operators so that `a && rm -rf /` is inspected as two segments, defeating
 * naive "starts with allowed command" bypasses.
 */
export function parseCommand(input: string): ParsedCommand {
  const normalized = input.trim().replace(/\s+/g, " ");
  // Split on shell operators that chain/redirect commands.
  const segments = normalized.split(/(?:\|\||&&|;|\||&|>|<|`|\$\()/g);
  const tokens: string[] = [];
  for (const seg of segments) {
    for (const word of seg.trim().split(" ")) {
      if (word) tokens.push(word.toLowerCase());
    }
  }
  return { normalized, tokens };
}

/** Detect characters/sequences indicating command substitution or chaining. */
function hasDangerousMetachars(input: string): boolean {
  // Backticks, $(...) command substitution, and process substitution.
  return /`|\$\(|\$\{|<\(|>\(/.test(input);
}

export class CommandGuard {
  // Fail closed: a freshly constructed guard is strict until the gateway applies
  // the configured mode. The product-level default (`open`) lives in the config.
  private mode: SecurityMode = "strict";

  constructor(
    private allowedCommands: string[],
    private blockedTokens: string[],
  ) {}

  setMode(mode: SecurityMode): void {
    this.mode = mode;
  }

  setAllowed(commands: string[]): void {
    this.allowedCommands = commands;
  }
  setBlocked(tokens: string[]): void {
    this.blockedTokens = tokens;
  }
  allowed(): string[] {
    return [...this.allowedCommands];
  }

  /**
   * Validate a command against the allowlist and blocklist. Throws on any
   * rejection. Returns the normalized command on success.
   *
   * A command is allowed only if its normalized form *starts with* one of the
   * allowlisted command prefixes AND contains no blocked tokens, no dangerous
   * chaining/substitution metacharacters, and no piped second program.
   */
  assertAllowed(input: string): string {
    const { normalized, tokens } = parseCommand(input);
    if (!normalized) throw new CommandRejectedError("Empty command.");

    if (hasDangerousMetachars(input)) {
      throw new CommandRejectedError("Command rejected: command substitution / process substitution is not allowed.");
    }

    // Reject chaining operators outright for the allowed-command runner.
    if (/(\|\||&&|;|\||&|>|<)/.test(input)) {
      throw new CommandRejectedError("Command rejected: pipelines, redirection and chaining are not allowed.");
    }

    // Blocked tokens anywhere.
    const blocked = this.blockedTokens.map((t) => t.toLowerCase());
    for (const tok of tokens) {
      if (blocked.includes(tok)) {
        throw new CommandRejectedError(`Command rejected: '${tok}' is a blocked command.`);
      }
    }
    // Special-case destructive flag combos that are not single tokens.
    if (/\brm\b/.test(normalized) && /-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive|--force/i.test(normalized)) {
      throw new CommandRejectedError("Command rejected: recursive/forced 'rm' is blocked.");
    }
    if (/\bchmod\b\s+777/.test(normalized)) {
      throw new CommandRejectedError("Command rejected: 'chmod 777' is blocked.");
    }

    // Must match an allowlisted prefix.
    if (this.mode === "strict") {
      const ok = this.allowedCommands.some((cmd) => {
        const c = cmd.trim().replace(/\s+/g, " ").toLowerCase();
        const n = normalized.toLowerCase();
        return n === c || n.startsWith(c + " ");
      });
      if (!ok) {
        throw new CommandRejectedError(
          `Command rejected: '${normalized}' is not in the allowed command list. Use shell_request_command_approval to request it.`,
        );
      }
    }
    return normalized;
  }

  /** Looser check for an *approved* arbitrary command — still blocks the hard blocklist. */
  assertNotBlocked(input: string): string {
    const { normalized, tokens } = parseCommand(input);
    const blocked = this.blockedTokens.map((t) => t.toLowerCase());
    for (const tok of tokens) {
      if (blocked.includes(tok)) {
        throw new CommandRejectedError(`Command rejected: '${tok}' is a blocked command even after approval.`);
      }
    }
    if (/\brm\b/.test(normalized) && /-[a-z]*r[a-z]*f/i.test(normalized)) {
      throw new CommandRejectedError("Command rejected: 'rm -rf' is blocked even after approval.");
    }
    return normalized;
  }
}
