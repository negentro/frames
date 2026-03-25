import Anthropic from "@anthropic-ai/sdk";

const VISION_MODEL =
  process.env.EIGEN_VISION_MODEL || "claude-sonnet-4-6";

export async function describeImageWithClaude(
  imageDataUrl: string,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY env var is required");
  }

  const match = imageDataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid image data URL");
  }
  const mediaType = match[1] as
    | "image/png"
    | "image/jpeg"
    | "image/gif"
    | "image/webp";
  const base64Data = match[2];

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 256,
    system:
      "You describe wireframes. List only what is literally drawn — shapes, text labels, positions. Do not invent content.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: base64Data,
            },
          },
          {
            type: "text",
            text: "List each element drawn in this wireframe: its position, exact text label, and shape. Only what is visible.",
          },
        ],
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  console.log(
    `[claude-vision] Description (${text.length} chars): ${text.slice(0, 300)}`,
  );
  console.log(
    `[claude-vision] Usage: input=${response.usage.input_tokens}, output=${response.usage.output_tokens}`,
  );

  return text || "Unable to describe image";
}
