import { Emitter } from '@/lib/events';
import type { ToolResult, WebMcpToolDefinition } from './types';

interface RegistryEvents extends Record<string, unknown> {
  change: WebMcpToolDefinition[];
  invoked: { name: string; args: Record<string, unknown>; result: ToolResult; source: 'agent' | 'simulator' };
}

/**
 * A local mirror of every tool the application has registered.
 *
 * Two reasons this exists rather than trusting the browser to remember:
 *
 *  1. The verification protocol has to be executable on browsers that do not
 *     implement WebMCP at all. The simulator invokes tools through this
 *     registry, exercising exactly the same handler an agent would reach.
 *  2. The on-device prediction ladder needs to call the same tools an external
 *     agent would, so a device with no agent attached still predicts.
 */
export class ToolRegistry {
  readonly events = new Emitter<RegistryEvents>();
  #tools = new Map<string, WebMcpToolDefinition>();

  register(tool: WebMcpToolDefinition): () => void {
    this.#tools.set(tool.name, tool as WebMcpToolDefinition);
    this.events.emit('change', this.list());
    return () => {
      this.#tools.delete(tool.name);
      this.events.emit('change', this.list());
    };
  }

  list(): WebMcpToolDefinition[] {
    return [...this.#tools.values()];
  }

  get(name: string): WebMcpToolDefinition | undefined {
    return this.#tools.get(name);
  }

  async invoke(
    name: string,
    args: Record<string, unknown>,
    source: 'agent' | 'simulator' = 'simulator',
  ): Promise<ToolResult> {
    const tool = this.#tools.get(name);
    if (!tool) {
      const result: ToolResult = {
        content: [{ type: 'text', text: `No tool named "${name}" is registered.` }],
        isError: true,
      };
      return result;
    }
    const result = await tool.execute(args);
    this.events.emit('invoked', { name, args, result, source });
    return result;
  }
}

/** One registry per document; the tools describe this page's capabilities. */
export const toolRegistry = new ToolRegistry();
