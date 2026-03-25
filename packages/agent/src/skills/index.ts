import type { Skill } from "./types.js";
import { stylingSkill } from "./styling/index.js";
import { layoutSkill } from "./layout/index.js";
import { componentSkill } from "./component/index.js";
import { integrationSkill } from "./integration/index.js";

const skills: Record<string, Skill> = {
  styling: stylingSkill,
  layout: layoutSkill,
  component: componentSkill,
  integration: integrationSkill,
};

// Default skill for unrecognized types
const defaultSkill: Skill = {
  name: "general",
  description: "General-purpose code editing",
  systemPrompt: `You are a React + TypeScript developer making targeted edits to files.
Output ONLY a JSON array of edits: [{"old": "exact match", "new": "replacement"}]
Make the MINIMUM changes needed. Do not rewrite unrelated code.`,
  examples: `Example — change text:
[{"old": "Hello World", "new": "Welcome"}]`,
};

export function getSkill(name: string): Skill {
  return skills[name] || defaultSkill;
}

export function listSkills(): string[] {
  return Object.keys(skills);
}
