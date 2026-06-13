import type { AutopilotFallbackReason, AutopilotMode } from "@localant/shared";

export type { AutopilotFallbackReason, AutopilotMode };

/** Whether a provider can currently be used, and why not when it cannot.
 * Surfaced in the Web UI and localant_doctor (provider names allowed there). */
export interface ProviderAvailability {
  /** Usable right now: enabled in settings + config AND its CLI is on PATH. */
  available: boolean;
  /** Enabled in config + Autopilot Settings (ignores CLI presence). */
  enabled: boolean;
  reason?: string;
}

/** Context handed to a fallback provider when a prior provider partially ran. */
export interface PriorAttemptContext {
  providerId: string;
  failureReason: AutopilotFallbackReason | "unknown";
  stdoutSummary: string;
  stderrSummary: string;
  /** Diff already applied to the working tree by the prior provider, if any.
   * When present the next provider is told to continue from the current state. */
  diff?: string;
}

export interface AutopilotProviderInput {
  cwd: string;
  task: string;
  mode: AutopilotMode;
  /** Free-text constraints (style, scope, "don't touch X"). */
  constraints?: string;
  timeoutMs?: number;
  priorContext?: PriorAttemptContext;
  createBranch?: boolean;
  branchName?: string;
  sessionId?: string;
}

export interface AutopilotProviderResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Working-tree diff after the run (empty for non-mutating modes). */
  diff: string;
  changed: boolean;
  branch?: string;
  /** Set when `ok` is false; drives the fallback decision. */
  failureReason?: AutopilotFallbackReason;
  durationMs: number;
}

/**
 * An Autopilot provider wraps one local automation backend (a coding-agent CLI)
 * behind a uniform interface. The public `autopilot` tool never references a
 * provider by name; the engine selects providers from saved settings.
 */
export interface AutopilotProvider {
  id: string;
  label: string;
  supportedModes: AutopilotMode[];
  available(): Promise<ProviderAvailability>;
  run(input: AutopilotProviderInput): Promise<AutopilotProviderResult>;
}
