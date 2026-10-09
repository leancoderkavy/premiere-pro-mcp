import { AsyncLocalStorage } from "node:async_hooks";

const expectedProject = new AsyncLocalStorage<string | undefined>();

/** Scope a project assertion to one MCP request, including its async CEP work. */
export function runWithExpectedProject<T>(value: unknown, operation: () => T): T {
  if (value !== undefined && (typeof value !== "string" || value.length > 4096 ||
      !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value) || /[\x00-\x1f]/.test(value))) {
    throw new Error("expected_project_path must be an absolute saved-project path of at most 4096 characters");
  }
  return expectedProject.run(value as string | undefined, operation);
}

export function expectedProjectPath(): string | undefined {
  return expectedProject.getStore();
}
