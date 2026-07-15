import { isDeepStrictEqual } from "node:util";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export const validateJsonSchema = (schema: unknown, value: unknown, at = "$"): string[] => {
  if (!record(schema)) return [`${at}: schema must be an object.`];
  const errors: string[] = [];
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => isDeepStrictEqual(candidate, value))) errors.push(`${at}: value is not in enum.`);
  if (Object.hasOwn(schema, "const") && !isDeepStrictEqual(schema.const, value)) errors.push(`${at}: value does not match const.`);
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((candidate) => validateJsonSchema(candidate, value, at).length === 0).length;
    if (matches !== 1) errors.push(`${at}: value must match exactly one schema.`);
  }
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((candidate) => validateJsonSchema(candidate, value, at).length === 0)) errors.push(`${at}: value does not match any allowed schema.`);
  if (Array.isArray(schema.allOf)) schema.allOf.forEach((candidate) => errors.push(...validateJsonSchema(candidate, value, at)));
  if (record(schema.not) && validateJsonSchema(schema.not, value, at).length === 0) errors.push(`${at}: value matches a forbidden schema.`);

  switch (schema.type) {
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
      for (const [key, child] of Object.entries(properties)) if (Object.hasOwn(value, key)) errors.push(...validateJsonSchema(child, value[key], `${at}.${key}`));
      break;
    }
    case "array":
      if (!Array.isArray(value)) errors.push(`${at}: expected array.`);
      else {
        if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(`${at}: requires at least ${schema.minItems} items.`);
        if (schema.items !== undefined) value.forEach((item, index) => errors.push(...validateJsonSchema(schema.items, item, `${at}[${index}]`)));
      }
      break;
    case "string":
      if (typeof value !== "string") errors.push(`${at}: expected string.`);
      else if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${at}: string is too short.`);
      break;
    case "number": if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${at}: expected number.`); break;
    case "integer": if (!Number.isInteger(value)) errors.push(`${at}: expected integer.`); break;
    case "boolean": if (typeof value !== "boolean") errors.push(`${at}: expected boolean.`); break;
    case undefined: break;
    default: errors.push(`${at}: unsupported schema type ${String(schema.type)}.`);
  }
  return errors;
};
