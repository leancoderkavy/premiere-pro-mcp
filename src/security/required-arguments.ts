interface RequiredSchema {
  required?: unknown;
  properties?: Record<string, { type?: unknown }>;
}

/** Refuse absent required values before a handler can read files or build host code. */
export function requiredArgumentError(parameters: RequiredSchema, args: unknown) {
  const input = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : undefined;
  for (const key of Array.isArray(parameters.required) ? parameters.required : []) {
    if (typeof key !== "string") continue;
    const present = input && Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
    const value = present ? input[key] : undefined;
    const type = parameters.properties?.[key]?.type;
    const stringOnly = type === "string" || (Array.isArray(type) && type.length === 1 && type[0] === "string");
    if (!present || (stringOnly && typeof value !== "string")) {
      return {
        success: false as const,
        error: !present ? `${key} is required` : `${key} must be a string`,
        data: { code: "INVALID_ARGUMENT", argument: key, mutationOutcome: "not_applied" as const, timelineChanged: false },
      };
    }
  }
  return undefined;
}
