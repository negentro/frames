import type { Context } from "hono";

interface ValidationRule {
  field: string;
  type: "string" | "number" | "array";
  required?: boolean;
  maxLength?: number;
  maxItems?: number;
}

export function validate(
  body: Record<string, unknown>,
  rules: ValidationRule[],
): string | null {
  for (const rule of rules) {
    const value = body[rule.field];

    if (rule.required && (value === undefined || value === null || value === "")) {
      return `${rule.field} is required`;
    }

    if (value === undefined || value === null) continue;

    if (rule.type === "string") {
      if (typeof value !== "string") {
        return `${rule.field} must be a string`;
      }
      if (rule.maxLength && value.length > rule.maxLength) {
        return `${rule.field} exceeds max length of ${rule.maxLength}`;
      }
    }

    if (rule.type === "number") {
      if (typeof value !== "number") {
        return `${rule.field} must be a number`;
      }
    }

    if (rule.type === "array") {
      if (!Array.isArray(value)) {
        return `${rule.field} must be an array`;
      }
      if (rule.maxItems && value.length > rule.maxItems) {
        return `${rule.field} exceeds max items of ${rule.maxItems}`;
      }
    }
  }

  return null;
}
