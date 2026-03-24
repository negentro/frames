import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { bashTool } from "./bash.js";

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "Read",
      description: "Read the contents of a file",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to the file to read (relative to project root)",
          },
        },
        required: ["file_path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Write",
      description: "Write content to a file, creating directories as needed",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to the file to write (relative to project root)",
          },
          content: {
            type: "string",
            description: "The content to write to the file",
          },
        },
        required: ["file_path", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Edit",
      description:
        "Edit a file by replacing an exact string match with new content",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to the file to edit (relative to project root)",
          },
          old_string: {
            type: "string",
            description: "The exact string to find and replace",
          },
          new_string: {
            type: "string",
            description: "The replacement string",
          },
        },
        required: ["file_path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Bash",
      description: "Execute a shell command and return its output",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute",
          },
        },
        required: ["command"],
      },
    },
  },
];

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  projectDir: string,
): Promise<string> {
  switch (name) {
    case "Read":
      return readTool(args as { file_path: string }, projectDir);
    case "Write":
      return writeTool(
        args as { file_path: string; content: string },
        projectDir,
      );
    case "Edit":
      return editTool(
        args as {
          file_path: string;
          old_string: string;
          new_string: string;
        },
        projectDir,
      );
    case "Bash":
      return bashTool(args as { command: string }, projectDir);
    default:
      return `Unknown tool: ${name}`;
  }
}
