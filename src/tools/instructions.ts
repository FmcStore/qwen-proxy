import { TOOL_CALL_OPEN, TOOL_CALL_CLOSE } from "./toolcall-tags.js";
import { buildCompactToolManifest } from "./manifest.js";

/**
 * LRU-style cache for tool instructions to avoid rebuilding on every request.
 * Key format: toolsJson + "##" + toolChoice
 * Upstream: cb518e0
 */
const toolInstructionsCache = new Map<string, string>();
const TOOL_CACHE_MAX_ENTRIES = 64;

/**
 * Formats available tools into a compact TypeScript-like manifest if possible,
 * falling back to the raw string if parsing fails.
 */
function formatToolsRepresentation(toolsInput: string | unknown[]): string {
  if (typeof toolsInput === "string") {
    try {
      const parsed = JSON.parse(toolsInput);
      if (Array.isArray(parsed)) {
        const compact = buildCompactToolManifest(parsed);
        if (compact.trim().length > 0) return compact;
      }
    } catch {
      return toolsInput;
    }
    return toolsInput;
  }

  if (Array.isArray(toolsInput)) {
    const compact = buildCompactToolManifest(toolsInput);
    if (compact.trim().length > 0) return compact;
  }

  return String(toolsInput);
}

/**
 * Builds tool calling instructions for the system prompt.
 *
 * @param toolsJson - Stringified JSON array of available tools (or tools array).
 * @param toolChoice - Optional tool choice configuration.
 * @returns Formatted instruction string.
 */
export function buildToolInstructions(
  toolsJson: string | unknown[],
  toolChoice?: unknown,
): string {
  const toolsString = typeof toolsJson === "string" ? toolsJson : JSON.stringify(toolsJson);

  // Check cache first
  const cacheKey = `${toolsString}##${JSON.stringify(toolChoice ?? null)}`;
  const cached = toolInstructionsCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const manifest = formatToolsRepresentation(toolsJson);

  let toolList: any[] = [];
  if (typeof toolsJson === "string") {
    try {
      const parsed = JSON.parse(toolsJson);
      if (Array.isArray(parsed)) toolList = parsed;
    } catch {}
  } else if (Array.isArray(toolsJson)) {
    toolList = toolsJson;
  }

  const firstTool = toolList[0];
  const sampleToolName =
    (typeof firstTool?.function?.name === "string" && firstTool.function.name) ||
    (typeof firstTool?.name === "string" && firstTool.name) ||
    "tool_name";

  const properties =
    firstTool?.function?.parameters?.properties ||
    firstTool?.parameters?.properties;
  const firstPropKey =
    properties && typeof properties === "object"
      ? Object.keys(properties)[0]
      : null;

  const sampleArgs1 = firstPropKey
    ? JSON.stringify({ [firstPropKey]: "value1" })
    : "{}";

  // Pick second tool dynamically when available to teach tool diversity
  const secondTool = toolList.length > 1 ? toolList[1] : null;
  const secondToolName = secondTool
    ? (typeof secondTool?.function?.name === "string" && secondTool.function.name) ||
      (typeof secondTool?.name === "string" && secondTool.name) ||
      sampleToolName
    : null;
  const secondProperties =
    secondTool?.function?.parameters?.properties ||
    secondTool?.parameters?.properties;
  const secondPropKey =
    secondProperties && typeof secondProperties === "object"
      ? Object.keys(secondProperties)[0]
      : null;
  const sampleArgs2 = secondPropKey
    ? JSON.stringify({ [secondPropKey]: "value2" })
    : "{}";

  let forcedInstruction = "";
  if (
    toolChoice &&
    typeof toolChoice === "object" &&
    (toolChoice as any).function?.name
  ) {
    forcedInstruction = `\nCRITICAL: You MUST call the tool "${(toolChoice as any).function.name}" in this response.\n`;
  } else if (
    toolChoice === "required" ||
    (typeof toolChoice === "object" &&
      ((toolChoice as any)?.type === "any" || (toolChoice as any)?.type === "required"))
  ) {
    forcedInstruction = `\nCRITICAL: You MUST call at least one tool from the list above in this response.\n`;
  }

  const secondExample = secondToolName
    ? `\n${TOOL_CALL_OPEN}\n{"name": "${secondToolName}", "arguments": ${sampleArgs2}}\n${TOOL_CALL_CLOSE}`
    : "";

  let instructions = `

# TOOLS AVAILABLE
You may call one or more functions to assist with the user query.
You are provided with function signatures within <tools></tools> XML tags:
<tools>
${manifest}
</tools>
${forcedInstruction}
[TOOL CALL CONTRACT]
To call a tool, output a JSON object wrapped EXACTLY in ${TOOL_CALL_OPEN} and ${TOOL_CALL_CLOSE} tags:
${TOOL_CALL_OPEN}
{"name": "${sampleToolName}", "arguments": ${sampleArgs1}}
${TOOL_CALL_CLOSE}${secondExample}

CRITICAL RULES:
1. STRICT NAMES: "name" must match an exact tool explicitly declared in <tools>; never approximate or invent names. NEVER call external tools (e.g. bash, edit, sh, terminal, run) if they are not explicitly declared above.
2. ONLY WHEN NEEDED: Call tools ONLY when an external action is strictly required. If you can answer directly, do NOT call any tool.
3. VALID JSON ARGUMENTS: "arguments" must be a valid JSON object matching the parameter schema. Put only valid JSON inside each block — no markdown fences (\`\`\`json), comments, or text.
4. PARALLEL EXECUTION: When multiple independent operations are needed, emit multiple consecutive ${TOOL_CALL_OPEN} blocks (at most 4 per turn). Each block must be complete and self-contained (never nested, interleaved, or omitted).
5. NO PROSE AFTER CALLS: Stop generation immediately after the final ${TOOL_CALL_CLOSE} tag. Never output raw JSON without ${TOOL_CALL_OPEN} tags.
`;

  // Cache result (with LRU-style eviction)
  if (toolInstructionsCache.size >= TOOL_CACHE_MAX_ENTRIES) {
    toolInstructionsCache.clear();
  }
  toolInstructionsCache.set(cacheKey, instructions);

  return instructions;
}


