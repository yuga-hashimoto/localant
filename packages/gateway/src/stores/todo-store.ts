import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { AppPaths } from "@localant/shared";

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TodoPriority = "low" | "medium" | "high";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority?: TodoPriority;
  createdAt: string;
  updatedAt: string;
}

export interface PlanRecord {
  id: string;
  title: string;
  steps: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: string;
  subject: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  result?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionRecord {
  id: string;
  question: string;
  context?: string;
  status: "pending" | "answered";
  answer?: string;
  createdAt: string;
  answeredAt?: string;
}

/** JSON-backed store for ChatGPT's working state (todos, plans, tasks, questions). */
export class TodoStore {
  private readonly todosFile: string;
  private readonly plansFile: string;
  private readonly tasksFile: string;
  private readonly questionsFile: string;

  constructor(paths: AppPaths) {
    this.todosFile = path.join(paths.root, "todos.json");
    this.plansFile = path.join(paths.root, "plans.json");
    this.tasksFile = path.join(paths.root, "tasks.json");
    this.questionsFile = path.join(paths.root, "questions.json");
  }

  private read<T>(file: string): T[] {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as T[];
    } catch {
      return [];
    }
  }
  private write<T>(file: string, items: T[]): void {
    fs.writeFileSync(file, JSON.stringify(items, null, 2), { mode: 0o600 });
  }

  // --- Todos ---
  listTodos(): TodoItem[] {
    return this.read<TodoItem>(this.todosFile);
  }

  /** Replace the entire todo list. */
  writeTodos(todos: { content: string; status?: TodoStatus; priority?: TodoPriority }[]): TodoItem[] {
    const now = new Date().toISOString();
    const items: TodoItem[] = todos.map((t) => ({
      id: nanoid(8),
      content: t.content,
      status: t.status ?? "pending",
      priority: t.priority,
      createdAt: now,
      updatedAt: now,
    }));
    this.write(this.todosFile, items);
    return items;
  }

  updateTodo(id: string, patch: Partial<Pick<TodoItem, "content" | "status" | "priority">>): TodoItem {
    const items = this.listTodos();
    const idx = items.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`Todo not found: ${id}`);
    const updated: TodoItem = { ...items[idx]!, ...patch, id, updatedAt: new Date().toISOString() };
    items[idx] = updated;
    this.write(this.todosFile, items);
    return updated;
  }

  clearTodos(): { cleared: number } {
    const n = this.listTodos().length;
    this.write(this.todosFile, []);
    return { cleared: n };
  }

  // --- Plans ---
  createPlan(title: string, steps: string[]): PlanRecord {
    const now = new Date().toISOString();
    const rec: PlanRecord = { id: nanoid(8), title, steps, createdAt: now, updatedAt: now };
    const items = this.read<PlanRecord>(this.plansFile);
    items.push(rec);
    this.write(this.plansFile, items);
    return rec;
  }
  updatePlan(id: string, patch: Partial<Pick<PlanRecord, "title" | "steps">>): PlanRecord {
    const items = this.read<PlanRecord>(this.plansFile);
    const idx = items.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error(`Plan not found: ${id}`);
    const updated: PlanRecord = { ...items[idx]!, ...patch, id, updatedAt: new Date().toISOString() };
    items[idx] = updated;
    this.write(this.plansFile, items);
    return updated;
  }
  getPlan(id: string): PlanRecord | undefined {
    return this.read<PlanRecord>(this.plansFile).find((p) => p.id === id);
  }
  listPlans(): PlanRecord[] {
    return this.read<PlanRecord>(this.plansFile);
  }

  // --- Tasks ---
  createTask(subject: string): TaskRecord {
    const now = new Date().toISOString();
    const rec: TaskRecord = { id: nanoid(8), subject, status: "pending", createdAt: now, updatedAt: now };
    const items = this.read<TaskRecord>(this.tasksFile);
    items.push(rec);
    this.write(this.tasksFile, items);
    return rec;
  }
  updateTask(id: string, patch: Partial<Pick<TaskRecord, "subject" | "status" | "result">>): TaskRecord {
    const items = this.read<TaskRecord>(this.tasksFile);
    const idx = items.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`Task not found: ${id}`);
    const updated: TaskRecord = { ...items[idx]!, ...patch, id, updatedAt: new Date().toISOString() };
    items[idx] = updated;
    this.write(this.tasksFile, items);
    return updated;
  }
  listTasks(): TaskRecord[] {
    return this.read<TaskRecord>(this.tasksFile);
  }
  getTask(id: string): TaskRecord | undefined {
    return this.read<TaskRecord>(this.tasksFile).find((t) => t.id === id);
  }

  // --- Questions (human-in-the-loop) ---
  createQuestion(question: string, context?: string): QuestionRecord {
    const rec: QuestionRecord = {
      id: nanoid(8),
      question,
      context,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    const items = this.read<QuestionRecord>(this.questionsFile);
    items.push(rec);
    this.write(this.questionsFile, items);
    return rec;
  }
  answerQuestion(id: string, answer: string): QuestionRecord {
    const items = this.read<QuestionRecord>(this.questionsFile);
    const idx = items.findIndex((q) => q.id === id);
    if (idx === -1) throw new Error(`Question not found: ${id}`);
    const updated: QuestionRecord = {
      ...items[idx]!,
      status: "answered",
      answer,
      answeredAt: new Date().toISOString(),
    };
    items[idx] = updated;
    this.write(this.questionsFile, items);
    return updated;
  }
  listQuestions(): QuestionRecord[] {
    return this.read<QuestionRecord>(this.questionsFile);
  }
  getQuestion(id: string): QuestionRecord | undefined {
    return this.read<QuestionRecord>(this.questionsFile).find((q) => q.id === id);
  }
}
