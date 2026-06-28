const DEFAULT_BASE_URL = "http://127.0.0.1:8100";

type RequestLike = { type?: string; status?: string };
type BatchRequestType = "GENERATE_CHARACTER_IMAGE" | "GENERATE_IMAGE" | "GENERATE_VIDEO";
type SkillContext = { log: (message: string, extra?: unknown) => void };
type Parser<T> = { parse: (input: unknown) => T };
type BaseInput = { baseUrl?: string };
type Orientation = "VERTICAL" | "HORIZONTAL";

function ensureRecord(input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("Expected an object input.");
  return input as Record<string, unknown>;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  return value;
}

function requiredString(value: unknown, name: string): string {
  const text = optionalString(value, name);
  if (!text) throw new Error(`${name} is required.`);
  return text;
}

function optionalPositiveInt(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function optionalStringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${name} must be an array of strings.`);
  return value;
}

function optionalOrientation(value: unknown): Orientation {
  if (value === undefined) return "VERTICAL";
  if (value !== "VERTICAL" && value !== "HORIZONTAL") throw new Error("orientation must be VERTICAL or HORIZONTAL.");
  return value;
}

function base(input: Record<string, unknown>): BaseInput {
  return { baseUrl: optionalString(input.baseUrl, "baseUrl") };
}

function schema<T>(parse: (input: Record<string, unknown>) => T): Parser<T> {
  return { parse: (input: unknown) => parse(ensureRecord(input)) };
}

const emptySchema = schema((input) => base(input));
const statusSchema = schema((input) => ({
  ...base(input),
  projectId: optionalString(input.projectId, "projectId"),
  limit: optionalPositiveInt(input.limit, "limit", 10),
}));
const workflowSchema = schema((input) => {
  const project = input.project;
  const video = input.video;
  const scenes = input.scenes;
  if (typeof project !== "object" || project === null || Array.isArray(project)) throw new Error("project is required.");
  if (typeof video !== "object" || video === null || Array.isArray(video)) throw new Error("video is required.");
  if (!Array.isArray(scenes) || scenes.some((scene) => typeof scene !== "object" || scene === null || Array.isArray(scene))) {
    throw new Error("scenes must be an array of objects.");
  }
  return { ...base(input), project: project as Record<string, unknown>, video: video as Record<string, unknown>, scenes: scenes as Record<string, unknown>[] };
});
const referenceSchema = schema((input) => ({
  ...base(input),
  projectId: requiredString(input.projectId, "projectId"),
  characterIds: optionalStringArray(input.characterIds, "characterIds"),
}));
const sceneGenerationSchema = schema((input) => ({
  ...base(input),
  projectId: requiredString(input.projectId, "projectId"),
  videoId: requiredString(input.videoId, "videoId"),
  sceneIds: optionalStringArray(input.sceneIds, "sceneIds"),
  orientation: optionalOrientation(input.orientation),
}));
const pollSchema = schema((input) => ({
  ...base(input),
  projectId: optionalString(input.projectId, "projectId"),
  videoId: optionalString(input.videoId, "videoId"),
  type: optionalString(input.type, "type"),
  orientation: optionalString(input.orientation, "orientation"),
  timeoutSeconds: optionalPositiveInt(input.timeoutSeconds, "timeoutSeconds", 900),
  intervalSeconds: optionalPositiveInt(input.intervalSeconds, "intervalSeconds", 10),
}));

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

async function api<T>(baseUrl: string | undefined, method: string, path: string, body?: unknown): Promise<T> {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`;
  const response = await fetch(url, {
    method,
    headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${method} ${url} failed: HTTP ${response.status}: ${text}`);
  }
  return data as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function summarizeRequests(rows: RequestLike[]): {
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, Record<string, number>>;
} {
  const byStatus: Record<string, number> = {};
  const byType: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const status = row.status ?? "UNKNOWN";
    const type = row.type ?? "UNKNOWN";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    byType[type] ??= {};
    byType[type]![status] = (byType[type]![status] ?? 0) + 1;
  }
  return { total: rows.length, byStatus, byType };
}

export function buildBatchPayload(
  type: BatchRequestType,
  input: {
    projectId: string;
    videoId?: string;
    characterIds?: string[];
    sceneIds?: string[];
    orientation?: "VERTICAL" | "HORIZONTAL";
  },
): { requests: Record<string, unknown>[] } {
  const requests: Record<string, unknown>[] = [];
  for (const characterId of input.characterIds ?? []) {
    requests.push({ type, project_id: input.projectId, character_id: characterId });
  }
  for (const sceneId of input.sceneIds ?? []) {
    requests.push({
      type,
      project_id: input.projectId,
      video_id: input.videoId,
      scene_id: sceneId,
      orientation: input.orientation ?? "VERTICAL",
    });
  }
  return { requests };
}

async function listProjectCharacterIds(baseUrl: string | undefined, projectId: string): Promise<string[]> {
  const rows = await api<{ id: string }[]>(baseUrl, "GET", `/api/projects/${projectId}/characters`);
  return rows.map((row) => row.id);
}

async function listVideoSceneIds(baseUrl: string | undefined, videoId: string): Promise<string[]> {
  const rows = await api<{ id: string; display_order?: number }[]>(baseUrl, "GET", `/api/scenes${query({ video_id: videoId })}`);
  return rows.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)).map((row) => row.id);
}

async function submitBatch(baseUrl: string | undefined, payload: { requests: Record<string, unknown>[] }) {
  if (payload.requests.length === 0) {
    throw new Error("No FlowKit requests to submit.");
  }
  return api(baseUrl, "POST", "/api/requests/batch", payload);
}

const skill = {
  name: "flowkit",
  displayName: "FlowKit",
  description: "Control a local FlowKit video-generation server through LocalAnt tools.",
  version: "0.1.0",
  tools: {
    flowkit_health: {
      description: "Check FlowKit API health and Chrome extension connection status.",
      riskLevel: 0,
      inputSchema: emptySchema,
      handler: async ({ baseUrl }: BaseInput) => api(baseUrl, "GET", "/health"),
    },
    flowkit_status: {
      description: "Summarize FlowKit health, projects, and request status.",
      riskLevel: 0,
      inputSchema: statusSchema,
      handler: async ({ baseUrl, projectId, limit }) => {
        const [health, projects, requests] = await Promise.all([
          api(baseUrl, "GET", "/health"),
          api<unknown[]>(baseUrl, "GET", "/api/projects"),
          api<RequestLike[]>(baseUrl, "GET", `/api/requests${query({ project_id: projectId })}`),
        ]);
        const result: Record<string, unknown> = {
          health,
          projects: projects.slice(0, limit),
          requestSummary: summarizeRequests(requests),
        };
        if (projectId) {
          result.project = await api(baseUrl, "GET", `/api/projects/${projectId}`);
          result.characters = await api(baseUrl, "GET", `/api/projects/${projectId}/characters`);
          result.videos = await api(baseUrl, "GET", `/api/videos${query({ project_id: projectId })}`);
        }
        return result;
      },
    },
    flowkit_create_workflow: {
      description: "Create a FlowKit project, video, and scenes from a structured workflow spec.",
      riskLevel: 3,
      inputSchema: workflowSchema,
      handler: async ({ baseUrl, project, video, scenes }) => {
        const createdProject = await api<{ id: string }>(baseUrl, "POST", "/api/projects", project);
        const createdVideo = await api<{ id: string }>(baseUrl, "POST", "/api/videos", { ...video, project_id: createdProject.id });
        const createdScenes: unknown[] = [];
        let previousSceneId: string | undefined;
        for (let index = 0; index < scenes.length; index += 1) {
          const scene = scenes[index]!;
          const body: Record<string, unknown> = { video_id: createdVideo.id, display_order: index, ...scene };
          if (body.parent_scene_id === "__previous__") body.parent_scene_id = previousSceneId;
          const createdScene = await api<{ id: string }>(baseUrl, "POST", "/api/scenes", body);
          previousSceneId = createdScene.id;
          createdScenes.push(createdScene);
        }
        return { project: createdProject, video: createdVideo, scenes: createdScenes };
      },
    },
    flowkit_generate_references: {
      description: "Submit batch requests to generate reference images for project entities.",
      riskLevel: 3,
      inputSchema: referenceSchema,
      handler: async ({ baseUrl, projectId, characterIds }) => {
        const ids = characterIds ?? (await listProjectCharacterIds(baseUrl, projectId));
        return submitBatch(baseUrl, buildBatchPayload("GENERATE_CHARACTER_IMAGE", { projectId, characterIds: ids }));
      },
    },
    flowkit_generate_images: {
      description: "Submit batch requests to generate FlowKit scene images.",
      riskLevel: 3,
      inputSchema: sceneGenerationSchema,
      handler: async ({ baseUrl, projectId, videoId, sceneIds, orientation }) => {
        const ids = sceneIds ?? (await listVideoSceneIds(baseUrl, videoId));
        return submitBatch(baseUrl, buildBatchPayload("GENERATE_IMAGE", { projectId, videoId, sceneIds: ids, orientation }));
      },
    },
    flowkit_generate_videos: {
      description: "Submit batch requests to generate FlowKit scene video clips.",
      riskLevel: 3,
      inputSchema: sceneGenerationSchema,
      handler: async ({ baseUrl, projectId, videoId, sceneIds, orientation }) => {
        const ids = sceneIds ?? (await listVideoSceneIds(baseUrl, videoId));
        return submitBatch(baseUrl, buildBatchPayload("GENERATE_VIDEO", { projectId, videoId, sceneIds: ids, orientation }));
      },
    },
    flowkit_poll: {
      description: "Poll FlowKit batch status for project/video request completion.",
      riskLevel: 0,
      inputSchema: pollSchema,
      handler: async ({ baseUrl, projectId, videoId, type, orientation, timeoutSeconds, intervalSeconds }) => {
        const deadline = Date.now() + timeoutSeconds * 1000;
        let last: Record<string, unknown> = {};
        do {
          last = await api<Record<string, unknown>>(
            baseUrl,
            "GET",
            `/api/requests/batch-status${query({ project_id: projectId, video_id: videoId, type, orientation })}`,
          );
          if (last.done) return last;
          await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
        } while (Date.now() < deadline);
        return { ...last, timedOut: true };
      },
    },
  },
};

export default skill;
