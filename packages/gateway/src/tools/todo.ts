import { z } from "zod";
import type { Gateway } from "../gateway.js";

const TodoStatus = z.enum(["pending", "in_progress", "completed", "cancelled"]);
const TodoPriority = z.enum(["low", "medium", "high"]);

export function registerTodoTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "todowrite",
    description: "Replace the entire todo list with the given items.",
    risk: 1,
    inputSchema: z.object({
      todos: z
        .array(
          z.object({
            content: z.string(),
            status: TodoStatus.default("pending"),
            priority: TodoPriority.optional(),
          }),
        )
        .default([]),
    }),
    summarize: (i) => `todowrite (${i.todos.length} items)`,
    handler: (i) => ({ todos: gw.todos.writeTodos(i.todos) }),
  });

  r.register({
    name: "todo_list",
    description: "List the current todos.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => ({ todos: gw.todos.listTodos() }),
  });

  r.register({
    name: "todo_update",
    description: "Update a single todo by id.",
    risk: 1,
    inputSchema: z.object({
      id: z.string(),
      content: z.string().optional(),
      status: TodoStatus.optional(),
      priority: TodoPriority.optional(),
    }),
    summarize: (i) => `todo_update ${i.id}`,
    handler: (i) => gw.todos.updateTodo(i.id, { content: i.content, status: i.status, priority: i.priority }),
  });

  r.register({
    name: "todo_clear",
    description: "Clear all todos.",
    risk: 1,
    inputSchema: z.object({}).strip(),
    handler: () => gw.todos.clearTodos(),
  });

  // --- Plans ---
  r.register({
    name: "plan_create",
    description: "Create a plan (title + ordered steps).",
    risk: 1,
    inputSchema: z.object({ title: z.string(), steps: z.array(z.string()).default([]) }),
    summarize: (i) => `plan_create ${i.title}`,
    handler: (i) => gw.todos.createPlan(i.title, i.steps),
  });
  r.register({
    name: "plan_update",
    description: "Update a plan by id.",
    risk: 1,
    inputSchema: z.object({ id: z.string(), title: z.string().optional(), steps: z.array(z.string()).optional() }),
    handler: (i) => gw.todos.updatePlan(i.id, { title: i.title, steps: i.steps }),
  });
  r.register({
    name: "plan_get",
    description: "Get a plan by id (or list all when id omitted).",
    risk: 0,
    inputSchema: z.object({ id: z.string().optional() }),
    handler: (i) => (i.id ? gw.todos.getPlan(i.id) ?? { error: "not found" } : { plans: gw.todos.listPlans() }),
  });

  // --- Tasks ---
  r.register({
    name: "task_create",
    description: "Create a task.",
    risk: 1,
    inputSchema: z.object({ subject: z.string() }),
    summarize: (i) => `task_create ${i.subject}`,
    handler: (i) => gw.todos.createTask(i.subject),
  });
  r.register({
    name: "task_update",
    description: "Update a task by id.",
    risk: 1,
    inputSchema: z.object({
      id: z.string(),
      subject: z.string().optional(),
      status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
      result: z.string().optional(),
    }),
    handler: (i) => gw.todos.updateTask(i.id, { subject: i.subject, status: i.status, result: i.result }),
  });
  r.register({
    name: "task_list",
    description: "List tasks.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => ({ tasks: gw.todos.listTasks() }),
  });
  r.register({
    name: "task_result",
    description: "Get a task's result by id.",
    risk: 0,
    inputSchema: z.object({ id: z.string() }),
    handler: (i) => gw.todos.getTask(i.id) ?? { error: "not found" },
  });
}
