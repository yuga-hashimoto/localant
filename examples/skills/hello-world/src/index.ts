import { defineSkill, z } from "@localant/skill-sdk";

export default defineSkill({
  name: "hello-world",
  displayName: "Hello World",
  description: "A minimal example local skill.",
  version: "0.1.0",
  tools: {
    hello: {
      description: "Say hello to a name.",
      riskLevel: 0,
      inputSchema: z.object({ name: z.string() }),
      handler: async ({ name }, ctx) => {
        ctx.log(`greeting ${name}`);
        return { content: `Hello, ${name}! 👋 (from your local PC)` };
      },
    },
  },
});
