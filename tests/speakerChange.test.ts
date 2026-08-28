import { describe, expect, it } from 'vitest';
import { SpeakerChangeDetector } from '@/speech/speakerChange';

/** Feed a run of frames, returning the indices where a change was declared. */
function feed(detector: SpeakerChangeDetector, pitches: number[]): number[] {
  const changes: number[] = [];
  pitches.forEach((pitch, index) => {
    if (detector.push(pitch)) changes.push(index);
  });
  return changes;
}

const run = (hz: number, count: number, jitter = 4) =>
  Array.from({ length: count }, (_, i) => hz + ((i % 3) - 1) * jitter);

describe('SpeakerChangeDetector', () => {
  it('stays quiet while one person speaks', () => {
    const detector = new SpeakerChangeDetector();
    expect(feed(detector, run(180, 40))).toEqual([]);
  });

  it('declares a change when a much lower voice takes over', () => {
    const detector = new SpeakerChangeDetector();
    const changes = feed(detector, [...run(220, 12), ...run(110, 12)]);
    expect(changes).toHaveLength(1);
  });

  it('declares a change when a much higher voice takes over', () => {
    const detector = new SpeakerChangeDetector();
    expect(feed(detector, [...run(110, 12), ...run(240, 12)])).toHaveLength(1);
  });

  it('ignores a single stray frame, which is an octave error not a person', () => {
    const detector = new SpeakerChangeDetector();
    const pitches = run(180, 20);
    pitches[12] = 90; // one bad estimate
    expect(feed(detector, pitches)).toEqual([]);
  });

  it('ignores two stray frames', () => {
    const detector = new SpeakerChangeDetector();
    const pitches = run(180, 20);
    pitches[10] = 90;
    pitches[11] = 92;
    expect(feed(detector, pitches)).toEqual([]);
  });

  it('does not split one person whose intonation rises across a question', () => {
    const detector = new SpeakerChangeDetector();
    // A fourth of rise over a sentence is ordinary; splitting here would chop
    // one person into fragments, which is worse than merging two.
    const rising = Array.from({ length: 30 }, (_, i) => 150 + i * 2);
    expect(feed(detector, rising)).toEqual([]);
  });

  it('needs sustained evidence, not an instant jump', () => {
    const detector = new SpeakerChangeDetector();
    const changes = feed(detector, [...run(200, 10), ...run(100, 5)]);
    // The window holds five frames and is judged on its median, so the change
    // is declared once a majority of it is the new voice — three frames in,
    // about 190 ms. Fast enough not to lose the newcomer's opening words, slow
    // enough that one bad estimate cannot trigger it.
    expect(changes).toEqual([12]);
  });

  it('tracks the new voice after a change, so the next one is judged against it', () => {
    const detector = new SpeakerChangeDetector();
    const changes = feed(detector, [...run(110, 12), ...run(240, 12), ...run(115, 12)]);
    expect(changes).toHaveLength(2);
  });

  it('reports the voice it is currently tracking', () => {
    const detector = new SpeakerChangeDetector();
    feed(detector, run(190, 10));
    expect(detector.referencePitch()).toBeGreaterThan(180);
    expect(detector.referencePitch()).toBeLessThan(200);
  });

  it('forgets everything on reset', () => {
    const detector = new SpeakerChangeDetector();
    feed(detector, run(110, 12));
    detector.reset();
    expect(detector.referencePitch()).toBeNull();
    // A different voice straight after a reset is simply the new reference.
    expect(feed(detector, run(240, 12))).toEqual([]);
  });
});
