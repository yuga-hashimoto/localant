/* Minimal leveled logger with no dependencies. */
type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function currentLevel(): Level {
  const env = (process.env.CLA_LOG_LEVEL ?? "info").toLowerCase();
  return (["debug", "info", "warn", "error"].includes(env) ? env : "info") as Level;
}

function log(level: Level, scope: string, msg: string, extra?: unknown): void {
  if (order[level] < order[currentLevel()]) return;
  const ts = new Date().toISOString();
  const prefix = `${ts} ${level.toUpperCase().padEnd(5)} [${scope}]`;
  if (extra !== undefined) {
    console.error(prefix, msg, extra);
  } else {
    console.error(prefix, msg);
  }
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => log("debug", scope, msg, extra),
    info: (msg: string, extra?: unknown) => log("info", scope, msg, extra),
    warn: (msg: string, extra?: unknown) => log("warn", scope, msg, extra),
    error: (msg: string, extra?: unknown) => log("error", scope, msg, extra),
  };
}

export type Logger = ReturnType<typeof createLogger>;
