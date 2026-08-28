/**
 * A stable colour per voice.
 *
 * Speakers are numbered in the order they are first heard, so the hue is
 * derived from that number by the golden angle: consecutive speakers land far
 * apart on the wheel instead of shading into one another, which is what makes
 * two voices distinguishable at a glance in a waveform.
 */

const GOLDEN_ANGLE = 137.508;

/** @returns a hue in degrees, or null when the voice is unknown. */
export function speakerHue(speakerId: string | null | undefined): number | null {
  if (!speakerId) return null;
  const index = Number.parseInt(speakerId.replace(/^speaker-/, ''), 10);
  if (!Number.isFinite(index)) return null;
  // Offset so speaker 1 is a calm blue rather than a startling red.
  return (215 + (index - 1) * GOLDEN_ANGLE) % 360;
}
