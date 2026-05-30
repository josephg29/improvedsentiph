/**
 * Minimal, dependency-free JSON Schema validator.
 *
 * Supports exactly the subset the pipeline recipes use — `type`, `required`,
 * `properties`, `items`, and `enum` (recursively). It re-validates a worker's
 * structured output before the router is allowed to trust it (spec §8), so a
 * worker can never return mush and have the pipeline silently pass it. This is
 * deliberately small and pure rather than pulling in a full schema library.
 */

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

type JsonType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const matchesType = (value: unknown, type: JsonType): boolean => {
  switch (type) {
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return false;
  }
};

const enumMatches = (value: unknown, allowed: unknown[]): boolean =>
  allowed.some((candidate) => candidate === value);

const describePath = (path: string) => (path.length === 0 ? "<root>" : path);

const validateNode = (value: unknown, schema: unknown, path: string, errors: string[]): void => {
  if (!isRecord(schema)) {
    return; // Unconstrained — accept anything.
  }

  if (Array.isArray(schema.enum)) {
    if (!enumMatches(value, schema.enum)) {
      errors.push(`${describePath(path)} must be one of ${JSON.stringify(schema.enum)}.`);
      return;
    }
  }

  const type = typeof schema.type === "string" ? (schema.type as JsonType) : null;
  if (type) {
    if (!matchesType(value, type)) {
      errors.push(`${describePath(path)} must be of type "${type}".`);
      return;
    }
  }

  if ((type === "object" || (type === null && isRecord(value))) && isRecord(value)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === "string" && !(key in value)) {
          errors.push(`${describePath(path)} is missing required property "${key}".`);
        }
      }
    }
    if (isRecord(schema.properties)) {
      for (const [key, propertySchema] of Object.entries(schema.properties)) {
        if (key in value) {
          validateNode(value[key], propertySchema, path ? `${path}.${key}` : key, errors);
        }
      }
    }
  }

  if ((type === "array" || (type === null && Array.isArray(value))) && Array.isArray(value)) {
    if (schema.items !== undefined) {
      value.forEach((item, index) => {
        validateNode(item, schema.items, `${describePath(path)}[${index}]`, errors);
      });
    }
  }
};

export const validateAgainstSchema = (value: unknown, schema: unknown): SchemaValidationResult => {
  const errors: string[] = [];
  validateNode(value, schema, "", errors);
  return { valid: errors.length === 0, errors };
};
