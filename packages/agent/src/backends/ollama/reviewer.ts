import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chatCompletion, extractJSON, log } from "./shared.js";

export interface ReviewResult {
  satisfied: boolean;
  feedback: string;
}

const REVIEW_SYSTEM = `You review React + Tailwind code. Check if the implementation matches the user's request.

Check:
1. Are all requested components present and rendered?
2. Does the layout match (vertical vs horizontal, full-height vs auto)?
3. Are there broken imports or missing files?

Respond with ONLY JSON:
{"satisfied": true, "feedback": "Looks good"}
or
{"satisfied": false, "feedback": "Specific issue and how to fix it"}`;

export async function runReviewer(
  model: string,
  projectDir: string,
  userRequest: string,
  changedFiles: string[],
): Promise<ReviewResult> {
  const filesToRead = new Set(changedFiles);
  filesToRead.add("src/App.tsx");

  let filesContext = "";
  for (const filePath of filesToRead) {
    try {
      const fullPath = resolve(projectDir, filePath);
      const content = await readFile(fullPath, "utf-8");
      if (content.length < 3000) {
        filesContext += `\n${filePath}:\n${content}\n`;
      }
    } catch {
      // skip
    }
  }

  try {
    const response = await chatCompletion(model, [
      { role: "system", content: REVIEW_SYSTEM },
      {
        role: "user",
        content: `Request: ${userRequest}\n\nFiles:\n${filesContext}`,
      },
    ]);

    const raw = response.choices[0]?.message?.content || "";
    const jsonStr = extractJSON(raw);
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      log(`Review: satisfied=${parsed.satisfied}, feedback=${String(parsed.feedback).slice(0, 100)}`);
      return {
        satisfied: !!parsed.satisfied,
        feedback: parsed.feedback || "No feedback",
      };
    }
  } catch (err) {
    log(`Reviewer error: ${err instanceof Error ? err.message : err}`);
  }

  log("Review parse failed, assuming NOT satisfied to force retry");
  return { satisfied: false, feedback: "Reviewer failed to produce valid JSON — re-check implementation" };
}
