import type { Config } from "@localant/shared";
import type { CodingAgentManager } from "../managers/coding-agent-manager.js";
import type { GitManager } from "../managers/git-manager.js";
import { CodingAgentProvider } from "./coding-agent-provider.js";
import type { AutopilotProvider } from "./types.js";

/**
 * Builds Autopilot providers from the current config. One provider per
 * configured coding agent. Providers are cheap, stateless adapters, so they are
 * constructed on demand rather than cached — this keeps them in sync when the
 * config (enabled agents, commands) changes at runtime.
 */
export class ProviderRegistry {
  constructor(
    private readonly config: () => Config,
    private readonly agents: CodingAgentManager,
    private readonly git: GitManager,
  ) {}

  /** Every known provider (one per `codingAgents` entry), sorted by id. */
  list(): AutopilotProvider[] {
    return Object.keys(this.config().codingAgents)
      .sort()
      .map((id) => this.build(id));
  }

  /** A single provider by id, or undefined when it is not a known agent. */
  get(id: string): AutopilotProvider | undefined {
    if (!this.config().codingAgents[id]) return undefined;
    return this.build(id);
  }

  private build(id: string): AutopilotProvider {
    return new CodingAgentProvider(id, this.config, this.agents, this.git);
  }
}
