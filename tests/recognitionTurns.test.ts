import { beforeEach, describe, expect, it } from 'vitest';
import { RecognitionTurnTracker } from '@/speech/recognitionTurns';
import { actions, store } from '@/state/store';

describe('recognition utterance identity', () => {
  let nextId = 0;

  beforeEach(() => {
    store.reset();
    nextId = 0;
  });

  it('keeps a late duplicate endpoint on the GPT-confirmed turn', () => {
    const tracker = new RecognitionTurnTracker(() => `turn_${++nextId}`);
    const firstId = tracker.resolve('local', 17);

    actions.upsertTurn({
      id: firstId,
      source: 'user',
      text: 'I need watter.',
      final: true,
      dictated: true,
      transcriptionStatus: 'checking',
    });
    tracker.finalize('local', 17);
    expect(actions.applyAccurateTranscription(firstId, 'I need watter.', 'I need water.')).toBe(true);

    // The decoder and VAD both close utterance 17. Its id must survive the
    // first final so the replay cannot become a second, newer chat bubble.
    const replayId = tracker.resolve('local', 17);
    actions.upsertTurn({
      id: replayId,
      source: 'user',
      text: 'Need watter.',
      final: true,
      dictated: true,
      transcriptionStatus: 'local',
    });

    expect(replayId).toBe(firstId);
    expect(store.getState().turns).toHaveLength(1);
    expect(store.getState().turns[0]).toMatchObject({
      id: firstId,
      text: 'I need water.',
      final: true,
      transcriptionStatus: 'accurate',
    });
  });

  it('still creates a fresh turn for the next real utterance', () => {
    const tracker = new RecognitionTurnTracker(() => `turn_${++nextId}`);
    const first = tracker.resolve('local', 41);
    tracker.finalize('local', 41);
    const second = tracker.resolve('local', 42);

    expect(first).toBe('turn_1');
    expect(second).toBe('turn_2');
  });

  it('preserves final-and-release behaviour for providers without utterance ids', () => {
    const tracker = new RecognitionTurnTracker(() => `turn_${++nextId}`);
    const first = tracker.resolve('local');
    tracker.finalize('local');
    const second = tracker.resolve('local');

    expect(first).toBe('turn_1');
    expect(second).toBe('turn_2');
  });
});
