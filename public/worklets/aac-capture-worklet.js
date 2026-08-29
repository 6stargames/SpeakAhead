/**
 * AAC capture worklet.
 *
 * Runs on the audio rendering thread. Its entire job is to convert 128-frame
 * render quanta into 16 kHz analysis frames and hand them off. It must never
 * allocate unpredictably or block: an overrun here is an audible glitch in a
 * device somebody relies on to speak.
 *
 * Registered with `numberOfOutputs: 0`. A worklet with no outputs is still
 * actively processed while it has an input connection, which means the capture
 * path never needs a connection to `destination` — so there is physically no
 * route from the microphone to the speakers or to the peer connection.
 */

import { computePeak, computeRms, createResampler } from './resampler.js?coep=v1';

const DEFAULT_FRAME_SIZE = 1024;

class AacCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const processorOptions = options?.processorOptions ?? {};
    this.targetSampleRate = processorOptions.targetSampleRate ?? 16000;
    this.frameSize = processorOptions.frameSize ?? DEFAULT_FRAME_SIZE;
    this.channel = processorOptions.channel ?? 'unknown';

    // `sampleRate` is a global provided by the AudioWorkletGlobalScope.
    this.resampler = createResampler(sampleRate, this.targetSampleRate);

    this.buffer = new Float32Array(this.frameSize);
    this.filled = 0;
    this.active = true;
    this.framesEmitted = 0;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data?.type === 'stop') {
        this.active = false;
      } else if (data?.type === 'reset') {
        this.resampler.reset();
        this.filled = 0;
      }
    };

    this.port.postMessage({
      type: 'ready',
      channel: this.channel,
      contextSampleRate: sampleRate,
      targetSampleRate: this.targetSampleRate,
      resampling: !this.resampler.passthrough,
    });
  }

  process(inputs) {
    if (!this.active) return false;

    const input = inputs[0];
    // No connection yet, or a silent render quantum: keep the processor alive.
    if (!input || input.length === 0) return true;

    const channelData = input[0];
    if (!channelData || channelData.length === 0) return true;

    const resampled = this.resampler.process(channelData);

    let offset = 0;
    while (offset < resampled.length) {
      const room = this.frameSize - this.filled;
      const take = Math.min(room, resampled.length - offset);
      this.buffer.set(resampled.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;

      if (this.filled === this.frameSize) {
        // Transfer ownership rather than copying: no GC pressure on this thread.
        const frame = this.buffer.slice();
        this.framesEmitted += 1;
        this.port.postMessage(
          {
            type: 'frame',
            channel: this.channel,
            samples: frame,
            sampleRate: this.targetSampleRate,
            rms: computeRms(frame),
            peak: computePeak(frame),
            sequence: this.framesEmitted,
          },
          [frame.buffer],
        );
        this.filled = 0;
      }
    }

    return true;
  }
}

registerProcessor('aac-capture', AacCaptureProcessor);
