import test from "node:test";
import assert from "node:assert";
import { StreamingToolParser } from "../tools/parser.ts";

const DECLARED_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "Agent",
      description: "Run subagent",
      parameters: {
        type: "object",
        properties: { prompt: { type: "string" } },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Bash",
      description: "Run shell command",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Edit",
      description: "Edit file",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
        },
        required: ["file_path"],
      },
    },
  },
];

test("StreamingToolParser: recovers tool call where Qwen omitted the name property but provided command argument", () => {
  const parser = new StreamingToolParser(DECLARED_TOOLS);

  // Exact payload structure from logs where the model emitted {"arguments": {"command": "..."}} without "name"
  const rawPayload =
    '<tool_call>{"arguments": {"command": "echo \\"=== FULL HEADER AUDIT ===\\""}}</tool_call>';

  const result = parser.feed(rawPayload);
  parser.flush();

  assert.strictEqual(result.toolCalls.length, 1, "Must recover the tool call");
  assert.strictEqual(result.toolCalls[0].name, "Bash", "Must infer Bash from command argument");
  assert.deepStrictEqual(result.toolCalls[0].arguments, {
    command: 'echo "=== FULL HEADER AUDIT ==="',
  });
  assert.strictEqual(parser.getMalformedToolCalls().length, 0, "Must not be tracked as malformed");
});

test("StreamingToolParser: recovers tool call with flattened command argument without name", () => {
  const parser = new StreamingToolParser(DECLARED_TOOLS);

  const rawPayload =
    '<tool_call>{"command": "git status"}</tool_call>';

  const result = parser.feed(rawPayload);
  parser.flush();

  assert.strictEqual(result.toolCalls.length, 1);
  assert.strictEqual(result.toolCalls[0].name, "Bash");
  assert.deepStrictEqual(result.toolCalls[0].arguments, {
    command: "git status",
  });
});

test("StreamingToolParser: aliases bash -> execute_command and maps cmd -> command when execute_command is declared", () => {
  const clineTools = [
    {
      type: "function" as const,
      function: {
        name: "execute_command",
        description: "Execute a CLI command",
        parameters: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "replace_in_file",
        description: "Replace content in file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" }, diff: { type: "string" } },
          required: ["path"],
        },
      },
    },
  ];

  const parser = new StreamingToolParser(clineTools);
  const chunk1 = '<tool_call>{"name": "bash", "arguments": {"cmd": "npm test"}}</tool_call>';
  const res1 = parser.feed(chunk1);
  parser.flush();

  assert.strictEqual(res1.toolCalls.length, 1);
  assert.strictEqual(res1.toolCalls[0].name, "execute_command", "Must alias bash to execute_command");
  assert.strictEqual(res1.toolCalls[0].arguments.command, "npm test", "Must map cmd argument to command");
  assert.strictEqual(parser.getSuccessfulToolCallCount(), 1);
});

test("StreamingToolParser: aliases edit -> replace_in_file and maps file_path -> path when replace_in_file is declared", () => {
  const clineTools = [
    {
      type: "function" as const,
      function: {
        name: "replace_in_file",
        description: "Replace content in file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" }, diff: { type: "string" } },
          required: ["path"],
        },
      },
    },
  ];

  const parser = new StreamingToolParser(clineTools);
  const chunk = '<tool_call>{"name": "edit", "arguments": {"file_path": "src/index.ts", "diff": "..."}}</tool_call>';
  const res = parser.feed(chunk);
  parser.flush();

  assert.strictEqual(res.toolCalls.length, 1);
  assert.strictEqual(res.toolCalls[0].name, "replace_in_file", "Must alias edit to replace_in_file");
  assert.strictEqual(res.toolCalls[0].arguments.path, "src/index.ts", "Must map file_path argument to path");
  assert.strictEqual(parser.getSuccessfulToolCallCount(), 1);
});

test("StreamingToolParser: getSuccessfulToolCallCount remains 0 when tool is completely undeclared", () => {
  const customTools = [
    {
      type: "function" as const,
      function: {
        name: "get_weather",
        parameters: { type: "object", properties: { city: { type: "string" } } },
      },
    },
  ];

  const parser = new StreamingToolParser(customTools);
  const chunk = '<tool_call>{"name": "totally_random_fake_tool", "arguments": {}}</tool_call>';
  const res = parser.feed(chunk);
  parser.flush();

  assert.strictEqual(res.toolCalls.length, 0);
  assert.strictEqual(parser.getSuccessfulToolCallCount(), 0, "Undeclared tool must NOT increment successful count");
  assert.strictEqual(parser.getMalformedToolCalls().length, 1, "Must record as malformed/undeclared call");
});

test("StreamingToolParser: bidirectional aliasing maps execute_command -> Bash when Bash is declared", () => {
  const claudeTools = [
    {
      type: "function" as const,
      function: {
        name: "Bash",
        description: "Run shell command",
        parameters: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
    },
  ];

  const parser = new StreamingToolParser(claudeTools);
  const chunk = '<tool_call>{"name": "execute_command", "arguments": {"command": "ls -la"}}</tool_call>';
  const res = parser.feed(chunk);
  parser.flush();

  assert.strictEqual(res.toolCalls.length, 1);
  assert.strictEqual(res.toolCalls[0].name, "Bash", "Must map execute_command to Bash");
  assert.strictEqual(res.toolCalls[0].arguments.command, "ls -la");
  assert.strictEqual(parser.getSuccessfulToolCallCount(), 1);
});

