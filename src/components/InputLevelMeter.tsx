import { useEffect, useRef, type JSX } from 'react';
import { session } from '@/session/AacSession';
import type { AudioFrame } from '@/audio/AudioGraph';

/** Quietest level worth drawing, in dBFS. Below this is room tone. */
const FLOOR_DB = -60;

/**
 * Live microphone level.
 *
 * Answers the one question dictation always raises - "is it hearing me?" -
 * without waiting for the recogniser to commit a word. That matters most
 * precisely when recognition is struggling, which is when a user would
 * otherwise have no way to tell a muted microphone from a model that cannot
 * make out their speech. For a dysarthric speaker those two look identical, and
 * the difference is whether it is worth trying again.
 *
 * Writes to the DOM through a ref rather than React state. Frames arrive around
 * sixteen times a second, and re-rendering the tree at that rate to move one
 * bar would be a poor trade on a device that must never stutter its audio.
 */
export function InputLevelMeter({ active }: { active: boolean }): JSX.Element | null {
  const fillRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef(0);

  useEffect(() => {
    if (!active) return undefined;

    const stop = session.graph.events.on('frame', (frame: AudioFrame) => {
      if (frame.channel !== 'local' || !fillRef.current) return;

      const db = frame.rms <= 1e-10 ? FLOOR_DB : 20 * Math.log10(frame.rms);
      const level = Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB));

      // Fast attack, slow release: the bar tracks speech onsets immediately but
      // does not flicker to zero between syllables.
      peakRef.current = level > peakRef.current ? level : peakRef.current * 0.82 + level * 0.18;
      fillRef.current.style.width = `${Math.round(peakRef.current * 100)}%`;
    });

    return () => {
      stop();
      peakRef.current = 0;
      if (fillRef.current) fillRef.current.style.width = '0%';
    };
  }, [active]);

  if (!active) return null;

  return (
    <div
      className="meter"
      role="meter"
      aria-label="Microphone input level"
      aria-valuemin={0}
      aria-valuemax={100}
      // The live number is not announced: a screen reader reading a changing
      // percentage several times a second would bury everything else.
      aria-valuetext="Microphone is active"
    >
      <div className="meter__fill" ref={fillRef} style={{ width: '0%' }} />
    </div>
  );
}
