import type { Config } from "@localant/shared";

/** Whether a provider is enabled in Autopilot Settings (default: enabled). */
export function isProviderEnabled(cfg: Config, id: string): boolean {
  return cfg.autopilot.providers[id]?.enabled ?? true;
}

/**
 * Resolve the ordered provider chain the engine will try: the primary first,
 * then each configured fallback in order. Unknown ids (not a `codingAgents`
 * key), disabled providers, and duplicates are dropped. The result drives
 * `autopilot` without ChatGPT ever naming a provider.
 */
export function resolveProviderOrder(cfg: Config): string[] {
  const known = new Set(Object.keys(cfg.codingAgents));
  const order: string[] = [];
  const push = (id: string): void => {
    if (!known.has(id) || !isProviderEnabled(cfg, id) || order.includes(id)) return;
    order.push(id);
  };
  push(cfg.autopilot.primary);
  for (const id of cfg.autopilot.fallbacks) push(id);
  return order;
}
