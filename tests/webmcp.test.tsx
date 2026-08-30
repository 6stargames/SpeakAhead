import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toolRegistry } from '@/webmcp/registry';
import { useWebMCPTool } from '@/webmcp/useWebMCPTool';
import { errorResult, findModelContext, isWebMcpAvailable, textResult } from '@/webmcp/types';
import type { JsonSchema, WebMcpToolDefinition } from '@/webmcp/types';
import { useAacWebMcpTools } from '@/webmcp/tools';
import { actions, store } from '@/state/store';
import { ChatGPTAuthButton } from '@/components/ChatGPTAuthButton';
import { AssistTasksPanel } from '@/components/AssistTasksPanel';

const schema: JsonSchema = { type: 'object', properties: { value: { type: 'string' } } };

function makeTool(overrides: Partial<WebMcpToolDefinition> = {}): WebMcpToolDefinition {
  return {
    name: 'test-tool',
    description: 'A tool used by the test suite.',
    inputSchema: schema,
    execute: () => textResult('ok'),
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

function render(element: React.ReactNode): void {
  act(() => {
    root.render(element);
  });
}

function unmount(): void {
  act(() => {
    root.unmount();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  container.remove();
});

describe('findModelContext', () => {
  it('reports nothing when the browser has no WebMCP surface', () => {
    expect(findModelContext()).toBeNull();
    expect(isWebMcpAvailable()).toBe(false);
  });

  it('prefers document.modelContext, matching the specification', () => {
    const surface = { registerTool: vi.fn() };
    Object.defineProperty(document, 'modelContext', { value: surface, configurable: true });
    expect(findModelContext()).toBe(surface);
    expect(isWebMcpAvailable()).toBe(true);
  });
});

describe('useWebMCPTool', () => {
  function Harness({ tool }: { tool: WebMcpToolDefinition }) {
    useWebMCPTool(tool);
    return null;
  }

  it('degrades to a local registration with no agent present', () => {
    render(<Harness tool={makeTool()} />);
    expect(toolRegistry.get('test-tool')).toBeDefined();
    unmount();
    expect(toolRegistry.get('test-tool')).toBeUndefined();
  });

  it('registers with the browser agent surface when one exists', () => {
    const registerTool = vi.fn();
    Object.defineProperty(document, 'modelContext', {
      value: { registerTool },
      configurable: true,
    });

    render(<Harness tool={makeTool()} />);

    expect(registerTool).toHaveBeenCalledTimes(1);
    const [registered, options] = registerTool.mock.calls[0] as [Record<string, unknown>, { signal: AbortSignal }];

    // Both dialects of the evolving specification must be satisfied.
    expect(registered.inputSchema).toEqual(schema);
    expect(registered.parameters).toEqual(schema);
    expect(typeof registered.execute).toBe('function');
    expect(typeof registered.call).toBe('function');
    expect(options.signal.aborted).toBe(false);

    unmount();
    expect(options.signal.aborted).toBe(true);
  });

  it('hands security annotations to the browser surface', () => {
    // untrustedContentHint is how the agent learns the room transcript is
    // third-party speech, not instructions. Losing it in normalisation would
    // silently reopen the injection path, so its passage is pinned here.
    const registerTool = vi.fn();
    Object.defineProperty(document, 'modelContext', {
      value: { registerTool },
      configurable: true,
    });

    render(
      <Harness
        tool={makeTool({ annotations: { readOnlyHint: true, untrustedContentHint: true } })}
      />,
    );

    const [registered] = registerTool.mock.calls[0] as [Record<string, unknown>];
    expect(registered.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });
    unmount();
  });

  it('does not grow an annotations stub on tools that declare none', () => {
    const registerTool = vi.fn();
    Object.defineProperty(document, 'modelContext', {
      value: { registerTool },
      configurable: true,
    });

    render(<Harness tool={makeTool()} />);
    const [plain] = registerTool.mock.calls[0] as [Record<string, unknown>];
    expect('annotations' in plain).toBe(false);
    unmount();
  });

  it('aborts the registration signal on unmount — no zombie tools', () => {
    const signals: AbortSignal[] = [];
    Object.defineProperty(document, 'modelContext', {
      value: {
        registerTool: (_tool: unknown, options?: { signal?: AbortSignal }) => {
          if (options?.signal) signals.push(options.signal);
        },
      },
      configurable: true,
    });

    render(<Harness tool={makeTool()} />);
    unmount();

    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it('also honours implementations that return an unregister function', () => {
    const unregister = vi.fn();
    Object.defineProperty(document, 'modelContext', {
      value: { registerTool: () => unregister },
      configurable: true,
    });

    render(<Harness tool={makeTool()} />);
    unmount();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it('survives an agent surface that throws on registration', () => {
    Object.defineProperty(document, 'modelContext', {
      value: {
        registerTool: () => {
          throw new Error('surface rejected the tool');
        },
      },
      configurable: true,
    });

    expect(() => render(<Harness tool={makeTool()} />)).not.toThrow();
    // The local registry still has it, so on-device prediction keeps working.
    expect(toolRegistry.get('test-tool')).toBeDefined();
    unmount();
  });

  it('answers rather than throwing when a tool handler fails', async () => {
    const registered: Record<string, unknown>[] = [];
    Object.defineProperty(document, 'modelContext', {
      value: { registerTool: (tool: Record<string, unknown>) => registered.push(tool) },
      configurable: true,
    });

    render(
      <Harness
        tool={makeTool({
          execute: () => {
            throw new Error('handler exploded');
          },
        })}
      />,
    );

    const execute = registered[0]?.execute as (args: unknown) => Promise<{ isError?: boolean }>;
    const result = await execute({});
    expect(result.isError).toBe(true);
    unmount();
  });

  it('routes to the latest handler without re-registering on every render', () => {
    const registerTool = vi.fn();
    Object.defineProperty(document, 'modelContext', { value: { registerTool }, configurable: true });

    const first = vi.fn(() => textResult('first'));
    const second = vi.fn(() => textResult('second'));

    render(<Harness tool={makeTool({ execute: first })} />);
    render(<Harness tool={makeTool({ execute: second })} />);

    expect(registerTool).toHaveBeenCalledTimes(1);
    void toolRegistry.invoke('test-tool', {});
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
    unmount();
  });
});

describe('ToolRegistry', () => {
  it('reports a clear error for an unknown tool instead of throwing', async () => {
    const result = await toolRegistry.invoke('does-not-exist', {});
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('does-not-exist');
  });

  it('emits an invocation event so the verification panel can show activity', async () => {
    const seen: string[] = [];
    const stop = toolRegistry.events.on('invoked', ({ name }) => seen.push(name));
    const unregister = toolRegistry.register(makeTool({ name: 'observed' }));

    await toolRegistry.invoke('observed', {});
    expect(seen).toEqual(['observed']);

    unregister();
    stop();
  });
});

describe('AAC context tools', () => {
  function AacHarness() {
    useAacWebMcpTools();
    return null;
  }

  it('registers contextual correction, vocabulary, and theme controls', async () => {
    store.reset();
    render(<AacHarness />);

    expect(toolRegistry.get('correct-low-confidence-transcript')).toBeDefined();
    expect(toolRegistry.get('set-contextual-vocabulary')).toBeDefined();
    expect(toolRegistry.get('set-symbol-theme')).toBeDefined();

    await toolRegistry.invoke('set-contextual-vocabulary', {
      words: [
        { text: 'water', symbol: '💧' },
        { text: 'yes', symbol: '✅' },
        { text: 'wait', symbol: '⏳' },
        { text: 'help', symbol: '🆘' },
        { text: 'more', symbol: '➕' },
        { text: 'please', symbol: '🙏' },
      ],
      phrases: [
        { text: 'Yes, please.', symbol: '✅' },
        { text: 'No, thank you.', symbol: '🚫' },
        { text: 'Please wait.', symbol: '⏳' },
        { text: 'Could you repeat that?', symbol: '🔁' },
      ],
    });
    expect(store.getState().contextualWords).toHaveLength(6);
    expect(store.getState().contextualPhrases).toHaveLength(4);
    expect(store.getState().assistFeatures.suggestions).toMatchObject({
      activeTasks: 0,
      status: 'ready',
      resultCount: 10,
    });

    await toolRegistry.invoke('set-symbol-theme', { theme: 'anime' });
    expect(store.getState().settings.symbolTheme).toBe('anime');
    await toolRegistry.invoke('set-symbol-theme', { theme: 'baby-shark' });
    expect(store.getState().settings.symbolTheme).toBe('baby-shark');
    await toolRegistry.invoke('set-symbol-theme', { theme: 'hello-kitty' });
    expect(store.getState().settings.symbolTheme).toBe('hello-kitty');

    actions.upsertTurn({
      id: 'uncertain',
      source: 'peer',
      text: 'some watter',
      final: true,
      dictated: true,
      words: [{ text: 'some', confidence: 0.9 }, { text: 'watter', confidence: 0.2 }],
    });
    await toolRegistry.invoke('correct-low-confidence-transcript', {
      turnId: 'uncertain',
      originalText: 'some watter',
      correctedText: 'some water',
      reason: 'Water was already being discussed.',
    });
    expect(store.getState().turns[0]?.text).toBe('some water');
    expect(store.getState().assistFeatures.corrections).toMatchObject({
      activeTasks: 0,
      status: 'ready',
      resultCount: 1,
    });

    unmount();
  });

  it('shows all three feature icons and a live working-task count beside the user', () => {
    store.reset();
    const onFeatureSelect = vi.fn();
    render(
      <ChatGPTAuthButton
        identity={{ displayName: 'Danny', email: 'danny@example.com', signOutPath: '/signout' }}
        onFeatureSelect={onFeatureSelect}
      />,
    );

    expect(container.querySelectorAll('.assist-feature')).toHaveLength(3);
    const replies = [...container.querySelectorAll<HTMLElement>('.assist-feature')].find((element) =>
      element.getAttribute('aria-label')?.startsWith('Quick replies:'),
    );
    expect(replies).toBeDefined();
    expect(replies?.querySelector('.assist-feature__count')?.textContent).toBe('0');

    act(() => replies?.click());
    expect(onFeatureSelect).toHaveBeenCalledWith('suggestions');

    act(() => actions.beginAssistTask('suggestions'));
    expect(replies?.querySelector('.assist-feature__count')?.textContent).toBe('1');
    expect(replies?.classList.contains('assist-feature--working')).toBe(true);

    act(() => actions.finishAssistTask('suggestions', 'ready', 6));
    expect(replies?.querySelector('.assist-feature__count')?.textContent).toBe('6');
    expect(replies?.classList.contains('assist-feature--ready')).toBe(true);

    unmount();
  });

  it('shows live WebMCP work in the chat area and provides a large return button', () => {
    store.reset();
    const onClose = vi.fn();
    act(() => actions.setSettings({ symbolTheme: 'anime' }));
    act(() => actions.beginAssistTask('themes'));
    render(<AssistTasksPanel selectedFeature="themes" onClose={onClose} />);

    expect(container.textContent).toContain('What it is doing');
    expect(container.textContent).toContain('Themed pictures');
    expect(container.textContent).toContain('1 task running now');
    expect(container.textContent).toContain('Task 1: Generating and saving pictures');

    const close = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Close — back to chat'),
    );
    expect(close).toBeDefined();
    act(() => close?.click());
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => actions.finishAssistTask('themes', 'ready', 6));
    unmount();
  });
});

describe('result helpers', () => {
  it('shapes text and error results the way an agent expects', () => {
    expect(textResult('hello')).toEqual({ content: [{ type: 'text', text: 'hello' }] });
    expect(errorResult('nope').isError).toBe(true);
  });
});
