import { isDeepStrictEqual } from "node:util";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const resolveLocalReference = (root: Record<string, unknown>, reference: string): unknown => {
  if (!reference.startsWith("#/")) return undefined;
  return reference.slice(2).split("/").reduce<unknown>((current, segment) => {
    if (!record(current)) return undefined;
    const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    return current[key];
  }, root);
};

const formatIsValid = (format: unknown, value: string) => {
  if (format === "date") return /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (format === "date-time") return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  return true;
};

export const validateJsonSchema = (
  schema: unknown,
  value: unknown,
  at = "$",
  rootSchema: unknown = schema,
): string[] => {
  if (!record(schema)) return [`${at}: schema must be an object.`];
  const root = record(rootSchema) ? rootSchema : schema;
  if (typeof schema.$ref === "string") {
    const referenced = resolveLocalReference(root, schema.$ref);
    if (referenced === undefined) return [`${at}: unresolved schema reference ${schema.$ref}.`];
    return validateJsonSchema(referenced, value, at, root);
  }
  const errors: string[] = [];
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => isDeepStrictEqual(candidate, value))) errors.push(`${at}: value is not in enum.`);
  if (Object.hasOwn(schema, "const") && !isDeepStrictEqual(schema.const, value)) errors.push(`${at}: value does not match const.`);
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((candidate) => validateJsonSchema(candidate, value, at, root).length === 0).length;
    if (matches !== 1) errors.push(`${at}: value must match exactly one schema.`);
  }
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((candidate) => validateJsonSchema(candidate, value, at, root).length === 0)) errors.push(`${at}: value does not match any allowed schema.`);
  if (Array.isArray(schema.allOf)) schema.allOf.forEach((candidate) => errors.push(...validateJsonSchema(candidate, value, at, root)));
  if (record(schema.not) && validateJsonSchema(schema.not, value, at, root).length === 0) errors.push(`${at}: value matches a forbidden schema.`);

  const effectiveType = schema.type ?? (
    schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined
      ? "object"
      : undefined
  );
  switch (effectiveType) {
    case "object": {
      if (!record(value)) { errors.push(`${at}: expected object.`); break; }
      const properties = record(schema.properties) ? schema.properties : {};
      if (typeof schema.minProperties === "number" && Object.keys(value).length < schema.minProperties) errors.push(`${at}: requires at least ${schema.minProperties} properties.`);
      if (Array.isArray(schema.required)) for (const key of schema.required) {
        if (typeof key === "string" && (!Object.hasOwn(value, key) || value[key] === undefined)) errors.push(`${at}.${key}: required property is missing.`);
      }
      if (schema.additionalProperties === false) for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) errors.push(`${at}.${key}: additional property is not allowed.`);
      }
      for (const [key, child] of Object.entries(properties)) if (Object.hasOwn(value, key)) errors.push(...validateJsonSchema(child, value[key], `${at}.${key}`, root));
      break;
    }
    case "array":
      if (!Array.isArray(value)) errors.push(`${at}: expected array.`);
      else {
        if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(`${at}: requires at least ${schema.minItems} items.`);
        if (typeof schema.maxItems === "number" && value.length > schema.maxItems) errors.push(`${at}: allows at most ${schema.maxItems} items.`);
        if (schema.uniqueItems === true && value.some((item, index) => value.findIndex((candidate) => isDeepStrictEqual(candidate, item)) !== index)) errors.push(`${at}: items must be unique.`);
        if (schema.items !== undefined) value.forEach((item, index) => errors.push(...validateJsonSchema(schema.items, item, `${at}[${index}]`, root)));
      }
      break;
    case "string":
      if (typeof value !== "string") errors.push(`${at}: expected string.`);
      else {
        if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${at}: string is too short.`);
        if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push(`${at}: string is too long.`);
        if (typeof schema.pattern === "string" && !(new RegExp(schema.pattern).test(value))) errors.push(`${at}: string does not match its pattern.`);
        if (schema.format !== undefined && !formatIsValid(schema.format, value)) errors.push(`${at}: string does not match format ${String(schema.format)}.`);
      }
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${at}: expected number.`);
      else {
        if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${at}: number is below minimum.`);
        if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${at}: number is above maximum.`);
      }
      break;
    case "integer":
      if (!Number.isInteger(value)) errors.push(`${at}: expected integer.`);
      else {
        if (typeof schema.minimum === "number" && (value as number) < schema.minimum) errors.push(`${at}: integer is below minimum.`);
        if (typeof schema.maximum === "number" && (value as number) > schema.maximum) errors.push(`${at}: integer is above maximum.`);
      }
      break;
    case "boolean": if (typeof value !== "boolean") errors.push(`${at}: expected boolean.`); break;
    case undefined: break;
    default: errors.push(`${at}: unsupported schema type ${String(effectiveType)}.`);
  }
  return errors;
};
