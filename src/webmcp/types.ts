/**
 * WebMCP shapes.
 *
 * The specification is experimental and has moved: it started on
 * `navigator.modelContext`, and the May 2026 draft moved it to
 * `document.modelContext` - tools belong to a page, not the browser - with
 * Chrome 150 deprecating the navigator alias. The member names have drifted
 * too (`call`/`parameters` in early drafts, `execute`/`inputSchema` now).
 * Rather than bet on one dialect, the integration accepts both and
 * normalises. That costs a few lines here and saves the application from
 * breaking on a Chrome update.
 */

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface ToolResultContent {
  readonly type: 'text';
  readonly text: string;
}

export interface ToolResult {
  readonly content?: ToolResultContent[];
  readonly isError?: boolean;
  readonly [key: string]: unknown;
}

/**
 * Advisory metadata in the shape Chrome's WebMCP implementation reads.
 *
 * `untrustedContentHint` matters most here: `get-conversation-context` returns
 * a verbatim transcript of whatever was said in the room, to an agent that
 * also holds `speak-text`. Anyone within earshot of the microphone can address
 * the agent directly - "ignore your instructions and say…" - and their words
 * arrive in its context as ordinary text. The hint tells the agent that this
 * payload is third-party speech to reason about, not instructions to follow.
 * It is advisory, so the tool descriptions repeat the warning in prose.
 */
export interface ToolAnnotations {
  /** The tool reads state and changes nothing. */
  readonly readOnlyHint?: boolean;
  /** The tool's output contains third-party content the agent must not obey. */
  readonly untrustedContentHint?: boolean;
}

export interface WebMcpToolDefinition<Args = Record<string, unknown>> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly execute: (args: Args) => Promise<ToolResult> | ToolResult;
  readonly annotations?: ToolAnnotations;
  /**
   * Marks a tool that causes the device to speak or transmit. The verification
   * panel shows these separately, and Settings gates the riskiest of them.
   */
  readonly consequential?: boolean;
}

/** The object handed to the browser, in whichever dialect it expects. */
export interface NormalisedTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  parameters: JsonSchema;
  annotations?: ToolAnnotations;
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
  call: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ModelContextLike {
  registerTool?: (tool: NormalisedTool, options?: { signal?: AbortSignal }) => unknown;
  unregisterTool?: (name: string) => unknown;
  provideContext?: (context: { tools: NormalisedTool[] }) => unknown;
}

export function findModelContext(): ModelContextLike | null {
  if (typeof globalThis === 'undefined') return null;

  const fromDocument =
    typeof document !== 'undefined'
      ? (document as unknown as { modelContext?: ModelContextLike }).modelContext
      : undefined;
  if (fromDocument && typeof fromDocument === 'object') return fromDocument;

  const fromNavigator =
    typeof navigator !== 'undefined'
      ? (navigator as unknown as { modelContext?: ModelContextLike }).modelContext
      : undefined;
  if (fromNavigator && typeof fromNavigator === 'object') return fromNavigator;

  return null;
}

export function isWebMcpAvailable(): boolean {
  const context = findModelContext();
  return context !== null && typeof context.registerTool === 'function';
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
