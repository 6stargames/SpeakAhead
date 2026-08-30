import { useEffect, useRef, type JSX } from 'react';
import type { AudioFrame, CaptureChannel } from '@/audio/AudioGraph';
import { session } from '@/session/AacSession';
import { speakerHue } from '@/lib/speakerColour';

/** Columns kept on screen - about four seconds at sixteen frames a second. */
const COLUMNS = 256;
/** Columns drawn per incoming frame. More detail, at no extra data cost. */
const COLUMNS_PER_FRAME = 4;

interface Column {
  min: number;
  max: number;
  hue: number | null;
}

/**
 * Live waveform of what the microphone is hearing.
 *
 * A level bar answers "is it hearing anything". A waveform answers "is it
 * hearing *me*, and did it catch that word" - you can see a syllable land,
 * see a gap where the recogniser will end the turn, and see a neighbour's
 * voice arrive as a separate shape. For a device whose speech recognition will
 * sometimes fail, being able to see what it received is the difference between
 * a mysterious failure and an obvious one.
 *
 * Each column is tinted with the colour of the voice detected at that moment,
 * so a change of speaker is visible in the trace itself rather than only in the
 * transcript afterwards.
 *
 * Drawn on a canvas through refs. Frames arrive around sixteen times a second
 * and re-rendering the React tree at that rate to move a waveform would be a
 * poor trade on a device that must not stutter its audio.
 */
export function Waveform({
  active,
  channel = 'local',
}: {
  active: boolean;
  channel?: CaptureChannel;
}): JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const columnsRef = useRef<Column[]>([]);

  useEffect(() => {
    if (!active) return undefined;

    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const context = canvas.getContext('2d');
    if (!context) return undefined;

    const style = getComputedStyle(canvas);
    const baseColour = style.getPropertyValue('--waveform-line').trim() || '#7aa0ff';
    const midColour = style.getPropertyValue('--waveform-axis').trim() || '#3d4a63';

    // Declared before `resize`, which has to repaint: assigning width or height
    // to a canvas clears its bitmap, so without an immediate redraw the trace
    // disappears on every layout change and stays gone until the next frame -
    // and if the microphone has fallen quiet, that is never.
    let draw = () => {};

    const resize = () => {
      const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
      const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      draw();
    };

    draw = () => {
      const { width, height } = canvas;
      const middle = height / 2;
      context.clearRect(0, 0, width, height);

      // Centre line, so silence reads as deliberate rather than as a dead canvas.
      context.strokeStyle = midColour;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, middle);
      context.lineTo(width, middle);
      context.stroke();

      const columns = columnsRef.current;
      if (columns.length === 0) return;

      const columnWidth = width / COLUMNS;
      columns.forEach((column, index) => {
        const x = index * columnWidth;
        // A minimum height keeps quiet speech visible rather than vanishing
        // into the axis, which would read as "not hearing you".
        const top = middle - Math.max(1, column.max * middle);
        const bottom = middle + Math.max(1, -column.min * middle);

        context.fillStyle =
          column.hue === null ? baseColour : `hsl(${column.hue} 70% 62%)`;
        context.fillRect(x, top, Math.max(1, columnWidth - 0.5), bottom - top);
      });
    };

    const onFrame = (frame: AudioFrame) => {
      if (frame.channel !== channel) return;

      const hue = speakerHue(session.liveSpeakerId(channel));
      const samples = frame.samples;
      const chunk = Math.max(1, Math.floor(samples.length / COLUMNS_PER_FRAME));

      for (let c = 0; c < COLUMNS_PER_FRAME; c += 1) {
        let min = 0;
        let max = 0;
        const start = c * chunk;
        const end = Math.min(samples.length, start + chunk);
        for (let i = start; i < end; i += 1) {
          const value = samples[i] as number;
          if (value < min) min = value;
          if (value > max) max = value;
        }
        columnsRef.current.push({ min, max, hue });
      }

      while (columnsRef.current.length > COLUMNS) columnsRef.current.shift();
      draw();
    };

    resize();
    draw();

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);

    const stop = session.graph.events.on('frame', onFrame);

    return () => {
      stop();
      observer?.disconnect();
      columnsRef.current = [];
    };
  }, [active, channel]);

  if (!active) return null;

  return (
    <canvas
      className={`waveform waveform--${channel}`}
      data-audio-channel={channel}
      ref={canvasRef}
      // The waveform is decorative for anyone who cannot see it; the spoken
      // words themselves are announced by the transcript's live region.
      aria-hidden="true"
    />
  );
}
