import { describe, expect, it, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGateway } from "@localant/gateway";
import skill, { buildBatchPayload, summarizeRequests } from "../src/index";

const ctx = { getSecret: async () => undefined, workspaceDir: ".", log: () => {} };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("flowkit skill", () => {
  it("exposes LocalAnt FlowKit tools", () => {
    expect(skill.name).toBe("flowkit");
    expect(skill.tools.flowkit_health).toBeDefined();
    expect(skill.tools.flowkit_status).toBeDefined();
    expect(skill.tools.flowkit_create_workflow).toBeDefined();
    expect(skill.tools.flowkit_generate_references).toBeDefined();
    expect(skill.tools.flowkit_generate_images).toBeDefined();
    expect(skill.tools.flowkit_generate_videos).toBeDefined();
    expect(skill.tools.flowkit_poll).toBeDefined();
  });

  it("is discoverable and valid through the LocalAnt gateway", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "flowkit-gateway-"));
    try {
      const gateway = createGateway(base);
      gateway.saveConfig({ ...gateway.config(), tools: { profile: "full" } });
      const list = await gateway.executeTool("skill_list", {}, { caller: "test" });
      expect(list.ok).toBe(true);
      const skills = list.data as { name: string; valid: boolean; tools: string[] }[];
      const flowkit = skills.find((item) => item.name === "flowkit");
      expect(flowkit).toBeTruthy();
      expect(flowkit!.valid).toBe(true);
      expect(flowkit!.tools).toContain("flowkit_health");

      const validation = await gateway.executeTool("skill_validate", { name: "flowkit" }, { caller: "test" });
      expect(validation.ok).toBe(true);
      expect(validation.data).toEqual({ valid: true, errors: [] });
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("builds batch payloads for scene generation", () => {
    expect(
      buildBatchPayload("GENERATE_IMAGE", {
        projectId: "pid",
        videoId: "vid",
        sceneIds: ["s1", "s2"],
        orientation: "VERTICAL",
      }),
    ).toEqual({
      requests: [
        { type: "GENERATE_IMAGE", project_id: "pid", video_id: "vid", scene_id: "s1", orientation: "VERTICAL" },
        { type: "GENERATE_IMAGE", project_id: "pid", video_id: "vid", scene_id: "s2", orientation: "VERTICAL" },
      ],
    });
  });

  it("summarizes requests by status and type", () => {
    expect(
      summarizeRequests([
        { type: "GENERATE_IMAGE", status: "COMPLETED" },
        { type: "GENERATE_IMAGE", status: "FAILED" },
        { type: "GENERATE_VIDEO", status: "PROCESSING" },
      ]),
    ).toEqual({
      total: 3,
      byStatus: { COMPLETED: 1, FAILED: 1, PROCESSING: 1 },
      byType: {
        GENERATE_IMAGE: { COMPLETED: 1, FAILED: 1 },
        GENERATE_VIDEO: { PROCESSING: 1 },
      },
    });
  });

  it("calls FlowKit health endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe("http://127.0.0.1:8100/health");
        return new Response(JSON.stringify({ status: "ok", extension_connected: true }), { status: 200 });
      }),
    );

    const result = await skill.tools.flowkit_health.handler({}, ctx);
    expect(result).toEqual({ status: "ok", extension_connected: true });
  });

  it("creates a workflow project, video, and scenes", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (url.endsWith("/api/projects")) {
          return new Response(JSON.stringify({ id: "pid", name: "Demo" }), { status: 200 });
        }
        if (url.endsWith("/api/videos")) {
          return new Response(JSON.stringify({ id: "vid", project_id: "pid" }), { status: 200 });
        }
        if (url.endsWith("/api/scenes")) {
          return new Response(JSON.stringify({ id: `scene-${calls.length}` }), { status: 200 });
        }
        throw new Error(`unexpected URL ${url}`);
      }),
    );

    const result = await skill.tools.flowkit_create_workflow.handler(
      {
        project: { name: "Demo", story: "story" },
        video: { title: "Episode 1" },
        scenes: [
          { prompt: "root", character_names: [], chain_type: "ROOT" },
          { prompt: "next", character_names: [], chain_type: "CONTINUATION", parent_scene_id: "__previous__" },
        ],
      },
      ctx,
    );

    expect(result).toMatchObject({ project: { id: "pid" }, video: { id: "vid" } });
    expect(calls[1]!.body).toEqual({ title: "Episode 1", project_id: "pid" });
    expect(calls[3]!.body).toMatchObject({ parent_scene_id: "scene-3" });
  });
});
