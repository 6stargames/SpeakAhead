import type { AudioFrame, CaptureChannel } from '@/audio/AudioGraph';
import { Emitter } from '@/lib/events';
import type { AsrEvents, AsrProvider, EngineInfo } from '../types';

/**
 * The engine used when no recogniser is installed.
 *
 * It reports `unavailable` rather than throwing, so the composition board, the
 * phrase board, synthesis and the WebMCP tools all keep working. Dictation is
 * one input method among several; losing it must not take the device down.
 */
export class NullAsrProvider implements AsrProvider {
  readonly events = new Emitter<AsrEvents>();

  readonly info: EngineInfo = {
    status: 'unavailable',
    implementation: 'none',
    offline: true,
    detail: 'No recognition model installed. Run `npm run fetch:models` to enable dictation.',
  };

  async init(): Promise<void> {
    this.events.emit('info', this.info);
  }
  acceptFrame(_frame: AudioFrame): void {
    void _frame;
  }
  flush(_channel: CaptureChannel): void {
    void _channel;
  }
  reset(_channel: CaptureChannel): void {
    void _channel;
  }
  async dispose(): Promise<void> {}
}
