import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chatCompletion, extractJSON, log } from "./shared.js";

export interface ReviewResult {
  satisfied: boolean;
  feedback: string;
}

const REVIEW_SYSTEM = `You are a CSS/layout expert reviewing a React + Tailwind app.

Your job: mentally render the page from the code and check if the result matches the user's request.

Step by step:
1. Read App.tsx to understand the layout structure (flex, grid, heights).
2. For each child component, trace how it sizes itself. Does it have a fixed height? Does it use flex-1? Does the parent allow it to grow?
3. Mentally compute: what is the actual rendered height/width of each section? Are any sections 0px tall? Are any pushed off screen?
4. Compare the mental render to what the user asked for.

Common bugs to watch for:
- A component with a fixed height (h-screen, h-64) inside a flex/grid parent that expects it to be auto-sized
- flex-1 on a wrapper div but the child inside doesn't stretch (needs h-full)
- overflow-hidden clipping content
- min-h-screen without flex-col causing children to not fill space
- A component that renders but at 0px height because nothing gives it height

Respond with ONLY a JSON object:
{
  "mental_render": "Describe what the page would actually look like top-to-bottom, with approximate sizes",
  "satisfied": true/false,
  "feedback": "If not satisfied, describe the SPECIFIC CSS fix needed (e.g. 'Hero needs h-full to fill its flex-1 parent')"
}`;

export async function runReviewer(
  model: string,
  projectDir: string,
  userRequest: string,
  changedFiles: string[],
): Promise<ReviewResult> {
  // Always include App.tsx for layout context
  const filesToRead = new Set(changedFiles);
  filesToRead.add("src/App.tsx");

  let filesContext = "";
  for (const filePath of filesToRead) {
    try {
      const fullPath = resolve(projectDir, filePath);
      const content = await readFile(fullPath, "utf-8");
      if (content.length < 4000) {
        filesContext += `\n${filePath}:\n\`\`\`\n${content}\n\`\`\`\n`;
      }
    } catch {
      // File may not exist
    }
  }

  const userPrompt = `User's request: ${userRequest}

Source files:
${filesContext}

Mentally render this page and check if it matches the request. Think step by step about the CSS layout.`;

  try {
    const response = await chatCompletion(model, [
      { role: "system", content: REVIEW_SYSTEM },
      { role: "user", content: userPrompt },
    ]);

    const raw = response.choices[0]?.message?.content || "";
    log(`Review raw: ${raw.slice(0, 300)}`);

    const jsonStr = extractJSON(raw);
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      log(`Review: satisfied=${parsed.satisfied}, mental_render=${parsed.mental_render?.slice(0, 100)}, feedback=${parsed.feedback?.slice(0, 100)}`);
      return {
        satisfied: !!parsed.satisfied,
        feedback: parsed.feedback || "No feedback",
      };
    }
  } catch (err) {
    log(`Reviewer error: ${err instanceof Error ? err.message : err}`);
  }

  log("Review parse failed, assuming satisfied");
  return { satisfied: true, feedback: "Review inconclusive" };
}
