import { useEffect, useRef, useState } from 'react';
import { toolRegistry } from './registry';
import {
  errorResult,
  findModelContext,
  type NormalisedTool,
  type ToolResult,
  type WebMcpToolDefinition,
} from './types';

export interface WebMcpRegistrationState {
  /** True when a browser-level agent surface accepted the registration. */
  readonly agentAttached: boolean;
  readonly registered: boolean;
  readonly detail: string;
}

function normalise(tool: WebMcpToolDefinition): NormalisedTool {
  const invoke = async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      return await tool.execute(args);
    } catch (error) {
      // A throwing tool can wedge an agent mid-turn. Always answer.
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  };

  return {
    name: tool.name,
    description: tool.description,
    // Both schema keys, both handler keys: whichever dialect the browser
    // implements, it finds what it is looking for.
    inputSchema: tool.inputSchema,
    parameters: tool.inputSchema,
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
    execute: invoke,
    call: invoke,
  };
}

/**
 * Register a WebMCP tool for the lifetime of a component.
 *
 * Registration is imperative and global, so the teardown path is the part that
 * matters: a component that unmounts without unregistering leaves a zombie tool
 * whose handler closes over dead state. Everything here hangs off a single
 * `AbortController`, which is both the shape the specification asks for and the
 * one thing guaranteed to run on unmount.
 *
 * Degrades to a no-op - never a throw - when the browser has no WebMCP surface.
 * The tool is still recorded in the local registry so the verification
 * simulator can reach it.
 */
export function useWebMCPTool(
  tool: WebMcpToolDefinition,
  dependencies: readonly unknown[] = [],
): WebMcpRegistrationState {
  const [state, setState] = useState<WebMcpRegistrationState>({
    agentAttached: false,
    registered: false,
    detail: 'Not registered yet.',
  });

  // Keep the latest handler reachable without re-registering on every render:
  // the tool closes over React state that changes constantly.
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useEffect(() => {
    const controller = new AbortController();

    const stable: WebMcpToolDefinition = {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      execute: (args) => toolRef.current.execute(args as never),
    };

    const unregisterLocal = toolRegistry.register(stable);

    const context = findModelContext();
    let unregisterAgent: (() => void) | null = null;

    if (context && typeof context.registerTool === 'function') {
      try {
        const returned = context.registerTool(normalise(stable), { signal: controller.signal });
        if (typeof returned === 'function') unregisterAgent = returned as () => void;
        setState({
          agentAttached: true,
          registered: true,
          detail: 'Registered with the browser agent surface.',
        });
      } catch (error) {
        setState({
          agentAttached: false,
          registered: true,
          detail: `Agent surface rejected the tool: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    } else {
      setState({
        agentAttached: false,
        registered: true,
        detail: 'No WebMCP agent surface in this browser - tool available locally only.',
      });
    }

    return () => {
      controller.abort();
      unregisterLocal();
      // Belt and braces: some implementations honour the signal, others expect
      // an explicit unregister, and an early one may do neither.
      try {
        unregisterAgent?.();
        context?.unregisterTool?.(stable.name);
      } catch {
        /* Already gone. */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.name, ...dependencies]);

  return state;
}
