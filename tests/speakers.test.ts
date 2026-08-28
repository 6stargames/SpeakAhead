import { describe, expect, it } from 'vitest';
import { centsBetween, estimatePitch, median } from '@/speech/pitch';
import { SpeakerTracker } from '@/speech/speakers';
import { frameTimbre } from '@/speech/timbre';
import {
  colouredVoice,
  COLOURED_A,
  COLOURED_B,
  formantVoice,
  VOICE_A,
  VOICE_B,
  type Formant,
} from './timbre.test';

/** A synthetic voiced frame: a fundamental plus two harmonics. */
function voiced(f0: number, sampleRate = 16000, length = 1024): Float32Array {
  const frame = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    frame[i] =
      0.6 * Math.sin(2 * Math.PI * f0 * t) +
      0.3 * Math.sin(2 * Math.PI * 2 * f0 * t) +
      0.1 * Math.sin(2 * Math.PI * 3 * f0 * t);
  }
  return frame;
}

describe('estimatePitch', () => {
  it.each([90, 120, 165, 220, 300])('recovers a %i Hz fundamental', (f0) => {
    const estimate = estimatePitch(voiced(f0), 16000);
    expect(estimate).not.toBeNull();
    // Within a semitone is ample for telling voices apart.
    expect(centsBetween(estimate as number, f0)).toBeLessThan(100);
  });

  it('does not report the octave below, which naive autocorrelation does', () => {
    const estimate = estimatePitch(voiced(200), 16000) as number;
    expect(centsBetween(estimate, 100)).toBeGreaterThan(500);
  });

  it('returns null for noise rather than inventing a speaker', () => {
    const noise = new Float32Array(1024);
    let seed = 12345;
    for (let i = 0; i < noise.length; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      noise[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    expect(estimatePitch(noise, 16000)).toBeNull();
  });

  it('returns null for silence', () => {
    expect(estimatePitch(new Float32Array(1024), 16000)).toBeNull();
  });
});

describe('median', () => {
  it('resists an octave-error outlier that would drag a mean', () => {
    // Sorted: 100, 198, 200, 202, 205 — the octave error sits at the edge.
    expect(median([200, 205, 198, 100, 202])).toBe(200);
  });

  it('handles even counts and empties', () => {
    expect(median([100, 200])).toBe(150);
    expect(median([])).toBeNull();
  });
});

describe('SpeakerTracker', () => {
  /** A voice sample: steady pitch, and a brightness typical of that pitch.
      The default length is a sentence's worth — enough to found a speaker. */
  const voice = (hz: number, brightness = 0.08, count = 16) => ({
    pitches: Array.from({ length: count }, () => hz),
    crossingRates: Array.from({ length: count }, () => brightness),
  });

  it('never presumes the first voice is the device owner', () => {
    // The user of this device is speech-impaired: the voices the microphone
    // hears are, by default, other people. A looped video must never become
    // "You"; ownership is claimed explicitly, never guessed.
    const tracker = new SpeakerTracker();
    const id = tracker.observe(voice(110));

    expect(id).toBe('speaker-1');
    expect(tracker.get(id)).toMatchObject({ label: 'Speaker 1', isOwner: false });
    expect(tracker.ownerId()).toBeNull();
  });

  it('makes a voice the owner only when explicitly claimed', () => {
    const tracker = new SpeakerTracker();
    const id = tracker.observe(voice(110)) as string;
    tracker.markAsOwner(id);
    expect(tracker.get(id)).toMatchObject({ label: 'You', isOwner: true });
  });

  it('recognises the same voice again', () => {
    const tracker = new SpeakerTracker();
    const first = tracker.observe(voice(110));
    // Same person, a little higher — well within one speaker's range.
    const again = tracker.observe(voice(118));
    expect(again).toBe(first);
    expect(tracker.profiles()).toHaveLength(1);
    expect(tracker.get(first)?.utterances).toBe(2);
  });

  it('separates a clearly different voice into its own speaker', () => {
    const tracker = new SpeakerTracker();
    tracker.observe(voice(110));
    const other = tracker.observe(voice(210));

    expect(other).toBe('speaker-2');
    expect(tracker.get(other)).toMatchObject({ label: 'Speaker 2', isOwner: false });
    expect(tracker.profiles()).toHaveLength(2);
  });

  it('keeps three distinct voices apart', () => {
    const tracker = new SpeakerTracker();
    const a = tracker.observe(voice(100));
    const b = tracker.observe(voice(160));
    const c = tracker.observe(voice(260));
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('separates two voices that share a pitch but differ widely in brightness', () => {
    const tracker = new SpeakerTracker();
    const a = tracker.observe(voice(150, 0.04));
    const b = tracker.observe(voice(150, 0.30));
    expect(a).not.toBe(b);
    expect(tracker.profiles()).toHaveLength(2);
  });

  it('does not split one person over ordinary brightness variation', () => {
    // The bug this guards: a 0.045 veto rejected every match, so each utterance
    // became a new voice — five speakers for one person. Vowels and consonants
    // move the crossing rate far more than that within one speaker.
    const tracker = new SpeakerTracker();
    const first = tracker.observe(voice(182, 0.06));
    const again = tracker.observe(voice(198, 0.14));
    expect(again).toBe(first);
    expect(tracker.profiles()).toHaveLength(1);
  });

  it('refuses an utterance whose pitch spans more than an octave', () => {
    const tracker = new SpeakerTracker();
    // Two people talking over each other; the median belongs to neither.
    const overlapping = {
      pitches: [100, 105, 98, 240, 250, 245, 102, 248],
      crossingRates: Array.from({ length: 8 }, () => 0.08),
    };
    expect(tracker.observe(overlapping)).toBeNull();
    expect(tracker.profiles()).toHaveLength(0);
  });

  it('can forget a profile that merged two people', () => {
    const tracker = new SpeakerTracker();
    const id = tracker.observe(voice(140)) as string;
    tracker.forget(id);
    expect(tracker.profiles()).toHaveLength(0);
  });

  it('declines to attribute an utterance with too little voiced audio', () => {
    const tracker = new SpeakerTracker();
    // Better an unlabelled turn than a wrong label.
    expect(tracker.observe({ pitches: [180], crossingRates: [0.08] })).toBeNull();
    expect(tracker.observe({ pitches: [], crossingRates: [] })).toBeNull();
    expect(tracker.profiles()).toHaveLength(0);
  });

  it('attributes a short interjection to a nearby known voice', () => {
    // "Yes", "no", someone's name — the turns a conversation is made of. Two
    // voiced frames is about 130 ms, which is what those actually produce.
    // They lean on the nearest known voice, even past the confident band.
    const tracker = new SpeakerTracker();
    const id = tracker.observe(voice(150));
    expect(tracker.observe({ pitches: [180, 182], crossingRates: [0.08, 0.08] })).toBe(id);
  });

  it('never founds a new speaker on a fragment', () => {
    // The looped-video failure: coughs and half-words each became a permanent
    // speaker, and every later utterance had more wrong voices to match. A
    // fragment far from every known voice stays unidentified instead.
    const tracker = new SpeakerTracker();
    tracker.observe(voice(110));
    expect(tracker.observe({ pitches: [300, 305], crossingRates: [0.08, 0.08] })).toBeNull();
    expect(tracker.profiles()).toHaveLength(1);

    const attempt = tracker.attempts().at(-1);
    expect(attempt?.reason).toContain('too brief to establish a new voice');
  });

  it('a leaning fragment does not drag the voice it leaned on', () => {
    const tracker = new SpeakerTracker();
    const id = tracker.observe(voice(150)) as string;
    const before = tracker.get(id)?.pitchHz;

    // 220 Hz is well outside the confident band around 150 Hz but near enough
    // for a fragment to lean on — and the lean must not move the centroid.
    expect(tracker.observe({ pitches: [220, 222], crossingRates: [0.08, 0.08] })).toBe(id);
    expect(tracker.get(id)?.pitchHz).toBe(before);

    const attempt = tracker.attempts().at(-1);
    expect(attempt?.reason).toContain('too brief to justify a new one');
  });

  it('does not fork one voice when a short excited burst jumps high', () => {
    // Replay of an observed session: a single video voice centred near 125 Hz
    // whose bursts of emphasis (205–239 Hz, five to nine voiced frames) used
    // to found a second speaker mid-stream — after which every sentence
    // bounced between the two profiles depending on where its median landed.
    // Bursts that short now lean on the voice when plausible, go unidentified
    // when extreme, and never found a profile.
    const tracker = new SpeakerTracker();
    const first = tracker.observe(voice(123));
    const observed: [number, number][] = [
      [153, 5], [239, 5], [128, 17], [113, 9], [136, 16], [124, 6],
      [205, 5], [127, 18], [224, 9], [127, 6], [125, 49],
    ];
    for (const [hz, frames] of observed) tracker.observe(voice(hz, 0.08, frames));

    expect(first).toBe('speaker-1');
    expect(tracker.profiles()).toHaveLength(1);
  });

  it('a sustained, genuinely different voice still founds a speaker', () => {
    // The founding bar is evidence, not a lock: a new person talking in full
    // sentences separates within their first utterance.
    const tracker = new SpeakerTracker();
    tracker.observe(voice(120));
    expect(tracker.observe(voice(240))).toBe('speaker-2');
    expect(tracker.profiles()).toHaveLength(2);
  });

  it('keeps one expressive voice together across a wide pitch range', () => {
    // One person's per-utterance median easily wanders a fourth. 250-cent
    // matching split a single looped video into three speakers.
    const tracker = new SpeakerTracker();
    const id = tracker.observe(voice(115));
    for (const hz of [97, 104, 109, 117, 136, 145]) {
      expect(tracker.observe(voice(hz))).toBe(id);
    }
    expect(tracker.profiles()).toHaveLength(1);
  });

  it('records why an utterance could not be attributed', () => {
    const tracker = new SpeakerTracker();
    tracker.observe({ pitches: [180], crossingRates: [0.08] });

    const [attempt] = tracker.attempts();
    expect(attempt?.speakerId).toBeNull();
    expect(attempt?.voicedFrames).toBe(1);
    expect(attempt?.reason).toContain('too little voiced audio');
  });

  it('records a successful attribution with the pitch it measured', () => {
    const tracker = new SpeakerTracker();
    tracker.observe(voice(198));

    const [attempt] = tracker.attempts();
    expect(attempt?.speakerId).toBe('speaker-1');
    expect(attempt?.pitchHz).toBe(198);
    expect(attempt?.reason).toBe('new voice');
  });

  it('keeps the attempt log bounded', () => {
    const tracker = new SpeakerTracker();
    for (let i = 0; i < 30; i += 1) tracker.observe(voice(150));
    expect(tracker.attempts().length).toBeLessThanOrEqual(12);
  });

  it('tracks a speaker whose pitch drifts across a conversation', () => {
    const tracker = new SpeakerTracker();
    const id = tracker.observe(voice(120));
    for (const hz of [125, 130, 135, 140]) tracker.observe(voice(hz));

    expect(tracker.profiles()).toHaveLength(1);
    expect(tracker.get(id)?.pitchHz).toBeGreaterThan(120);
  });

  it('identifies a voice mid-utterance without disturbing the profile', () => {
    const tracker = new SpeakerTracker();
    const id = tracker.observe(voice(180)) as string;
    const before = tracker.get(id);

    const guess = tracker.identify(voice(186));
    expect(guess?.id).toBe(id);
    // A provisional guess must not drag the centroid: a mistaken mid-utterance
    // match would corrupt the very voice it was mistaken for.
    expect(tracker.get(id)?.pitchHz).toBe(before?.pitchHz);
    expect(tracker.get(id)?.utterances).toBe(before?.utterances);
  });

  it('returns nothing for a voice it has not heard before', () => {
    const tracker = new SpeakerTracker();
    tracker.observe(voice(110));
    expect(tracker.identify(voice(280))).toBeNull();
  });

  it('needs enough voiced audio before guessing', () => {
    const tracker = new SpeakerTracker();
    tracker.observe(voice(180));
    expect(tracker.identify({ pitches: [180], crossingRates: [0.08] })).toBeNull();
  });

  it('lets a speaker be renamed', () => {
    const tracker = new SpeakerTracker();
    const id = tracker.observe(voice(200)) as string;
    tracker.rename(id, 'Dr Chen');
    expect(tracker.get(id)?.label).toBe('Dr Chen');
  });

  it('ignores a blank rename rather than leaving a nameless bubble', () => {
    const tracker = new SpeakerTracker();
    const id = tracker.observe(voice(200)) as string;
    tracker.rename(id, '   ');
    expect(tracker.get(id)?.label).toBe('Speaker 1');
  });

  it('moves ownership when the guess was wrong', () => {
    const tracker = new SpeakerTracker();
    const first = tracker.observe(voice(110)) as string;
    const second = tracker.observe(voice(230)) as string;

    tracker.markAsOwner(second);

    expect(tracker.get(second)?.isOwner).toBe(true);
    expect(tracker.get(first)?.isOwner).toBe(false);
    // The demoted profile must not still be called "You".
    expect(tracker.get(first)?.label).not.toBe('You');
    expect(tracker.ownerId()).toBe(second);
  });

  it('keeps a custom name when ownership moves away', () => {
    const tracker = new SpeakerTracker();
    const first = tracker.observe(voice(110)) as string;
    tracker.rename(first, 'Sam');
    const second = tracker.observe(voice(230)) as string;
    tracker.markAsOwner(second);
    expect(tracker.get(first)?.label).toBe('Sam');
  });
});

describe('SpeakerTracker with neural voiceprints', () => {
  /** Synthetic voiceprints with exact geometry: unit vectors we control. */
  const print = (direction: number, mix = 1): Float32Array => {
    const v = new Float32Array(16);
    v[direction] = mix;
    v[15] = Math.sqrt(Math.max(0, 1 - mix * mix));
    return v;
  };
  const sample = (embedding: Float32Array, f0 = 120, frames = 16) => ({
    pitches: Array.from({ length: frames }, () => f0),
    crossingRates: Array.from({ length: frames }, () => 0.08),
    embedding,
  });

  it('one voiceprint is one speaker, an octave of pitch apart', () => {
    const tracker = new SpeakerTracker();
    const a = tracker.observe(sample(print(0), 110));
    expect(tracker.observe(sample(print(0), 220))).toBe(a);
    expect(tracker.profiles()).toHaveLength(1);
  });

  it('two voiceprints at the same pitch are two speakers', () => {
    const tracker = new SpeakerTracker();
    const a = tracker.observe(sample(print(0), 120));
    const b = tracker.observe(sample(print(1), 120));
    expect(b).not.toBe(a);
    expect(tracker.profiles()).toHaveLength(2);
    expect(tracker.attempts().at(-1)?.reason).toContain('new voice');
  });

  it('a possible-band print needs pitch to agree before matching', () => {
    const tracker = new SpeakerTracker();
    const a = tracker.observe(sample(print(0), 120));
    // cosine ≈ 0.47: above possible (0.40), below confident (0.55).
    const grey = print(0, 0.47);
    expect(tracker.observe(sample(grey, 125))).toBe(a);
    expect(tracker.attempts().at(-1)?.reason).toContain('agree');
  });

  it('a brief unfamiliar print stays unidentified, never instantly a speaker', () => {
    const tracker = new SpeakerTracker();
    tracker.observe(sample(print(0), 120));
    expect(tracker.observe(sample(print(1), 120, 4))).toBeNull();
    expect(tracker.profiles()).toHaveLength(1);
    // Not discarded — forming in the nursery — but a single fragment is not
    // yet advertised to the interface as a voice.
    expect(tracker.pendingCount()).toBe(0);
  });

  it('a new voice earns its profile from fragments alone', () => {
    // Fast conversation never grants a founding-length utterance. Two
    // fragments that match nobody but match each other are a voice.
    const tracker = new SpeakerTracker();
    tracker.observe(sample(print(0), 120));
    expect(tracker.observe(sample(print(1), 120, 4))).toBeNull();
    const second = tracker.observe(sample(print(1), 120, 5));
    expect(second).toBe('speaker-2');
    expect(tracker.profiles()).toHaveLength(2);
    expect(tracker.pendingCount()).toBe(0);
    expect(tracker.attempts().at(-1)?.reason).toContain('separated across');
  });

  it('a second podcast host separates instead of blending into the first', () => {
    // The field failure: host B's short turns scored 0.40-0.51 against host
    // A with agreeing pitch, were absorbed into A, and taught the profile
    // until it matched everyone. Now the possible band never teaches, the
    // uncertain prints shadow-cluster, and B graduates after three turns.
    const tracker = new SpeakerTracker();
    const a = tracker.observe(sample(print(0), 120));
    const hostB = print(0, 0.45); // possible band vs A, coherent with itself

    expect(tracker.observe(sample(hostB, 122, 5))).toBe(a); // absorbed, not taught
    expect(tracker.observe(sample(hostB, 118, 6))).toBe(a); // absorbed, not taught
    const third = tracker.observe(sample(hostB, 121, 5));
    expect(third).toBe('speaker-2'); // the cluster graduated
    expect(tracker.profiles()).toHaveLength(2);

    // From here both hosts hold their lanes confidently.
    expect(tracker.observe(sample(hostB, 119, 5))).toBe('speaker-2');
    expect(tracker.observe(sample(print(0), 120, 5))).toBe(a);
  });

  it('a match does not teach unless the evidence is strong', () => {
    // The poisoning cascade: a 0.60 crossing the match line used to teach the
    // profile, blending two podcast hosts into one until the blend matched
    // everyone. Now 0.55-0.70 attributes without teaching, shadows into the
    // nursery, and a voice consistently at 0.60 separates on its third turn.
    const tracker = new SpeakerTracker();
    const a = tracker.observe(sample(print(0), 120));
    const midBand = print(0, 0.6);

    expect(tracker.observe(sample(midBand, 121, 5))).toBe(a);
    expect(tracker.observe(sample(midBand, 119, 6))).toBe(a);
    const third = tracker.observe(sample(midBand, 120, 5));
    expect(third).toBe('speaker-2');
    expect(tracker.profiles()).toHaveLength(2);

    // And the original profile was never dragged: pure A still matches A
    // strongly, not the blend both would have become.
    expect(tracker.observe(sample(print(0), 120, 5))).toBe(a);
  });

  it('one voice having a noisy day never splits itself', () => {
    // Same-voice noise deviates in a different direction every utterance, so
    // the shadows never cohere into a cluster; a real second voice deviates
    // the same way every time. The geometry is the safety mechanism.
    const tracker = new SpeakerTracker();
    const a = tracker.observe(sample(print(0), 120));
    const noisy = (direction: number): Float32Array => {
      const v = new Float32Array(16);
      v[0] = 0.45;
      v[direction] = Math.sqrt(1 - 0.45 * 0.45);
      return v;
    };
    expect(tracker.observe(sample(noisy(3), 120, 5))).toBe(a);
    expect(tracker.observe(sample(noisy(7), 121, 5))).toBe(a);
    expect(tracker.observe(sample(noisy(11), 119, 5))).toBe(a);
    expect(tracker.profiles()).toHaveLength(1);
  });
});

describe('SpeakerTracker with timbre', () => {
  /** A sample with real fingerprints: f0s carried as pitches, frames rendered
      through the synthetic vocal tract and analysed like live audio. */
  const timbreVoice = (f0s: number[], formants: Formant[], brightness = 0.08) => ({
    pitches: f0s,
    crossingRates: f0s.map(() => brightness),
    timbres: f0s
      .map((f0) => frameTimbre(formantVoice(f0, formants), 16000))
      .filter((t): t is Float32Array => t !== null),
  });

  /** Sixteen frames spread around a centre — a sentence's worth. */
  const spread = (centre: number) => Array.from({ length: 16 }, (_, i) => centre - 8 + i);

  /** A voice sample without timbre data, for the legacy-profile test. */
  const voice = (hz: number, brightness = 0.08, count = 16) => ({
    pitches: Array.from({ length: count }, () => hz),
    crossingRates: Array.from({ length: count }, () => brightness),
  });

  it('keeps one voice as one speaker across an octave', () => {
    // THE case pitch could never solve, and the cause of every "bouncing
    // speaker" report: the same person at 115 Hz and at 230 Hz. The
    // fingerprint identifies the vocal tract, not the note.
    const tracker = new SpeakerTracker();
    const id = tracker.observe(timbreVoice(spread(115), VOICE_A));
    expect(tracker.observe(timbreVoice(spread(230), VOICE_A))).toBe(id);
    expect(tracker.observe(timbreVoice(spread(160), VOICE_A))).toBe(id);
    expect(tracker.profiles()).toHaveLength(1);
  });

  it('separates two voices speaking at exactly the same pitch', () => {
    // The converse pitch could never solve: two vocal tracts, one fundamental.
    const tracker = new SpeakerTracker();
    const a = tracker.observe(timbreVoice(spread(120), VOICE_A));
    const b = tracker.observe(timbreVoice(spread(120), VOICE_B));
    expect(b).not.toBe(a);
    expect(tracker.profiles()).toHaveLength(2);
  });

  it('attributes a short excited burst by its sound, not its pitch', () => {
    // The 224 Hz · 9 frame burst that used to found "speaker-2": with a
    // fingerprint it is recognisably the same voice, however high it jumped.
    const tracker = new SpeakerTracker();
    const id = tracker.observe(timbreVoice(spread(120), VOICE_A));
    expect(tracker.observe(timbreVoice([220, 224, 228, 232], VOICE_A))).toBe(id);
    expect(tracker.profiles()).toHaveLength(1);
  });

  it('a short burst that sounds like nobody stays unidentified', () => {
    const tracker = new SpeakerTracker();
    tracker.observe(timbreVoice(spread(120), VOICE_A));
    expect(tracker.observe(timbreVoice([118, 120, 122, 124], VOICE_B))).toBeNull();
    expect(tracker.profiles()).toHaveLength(1);
  });

  it('the attribution log names the similarity it measured', () => {
    const tracker = new SpeakerTracker();
    tracker.observe(timbreVoice(spread(120), VOICE_A));
    tracker.observe(timbreVoice(spread(230), VOICE_A));
    const attempt = tracker.attempts().at(-1);
    expect(attempt?.reason).toContain('timbre');
  });

  it('a profile founded before timbre existed is still matchable by pitch', () => {
    const tracker = new SpeakerTracker();
    const legacy = tracker.observe(voice(140));
    // The same voice, now arriving with fingerprints: pitch carries the match,
    // and the profile learns its first embedding from it.
    expect(tracker.observe(timbreVoice(spread(145), VOICE_A))).toBe(legacy);
    expect(tracker.profiles()).toHaveLength(1);
  });

  it('identifies a voice live by its fingerprint', () => {
    const tracker = new SpeakerTracker();
    const id = tracker.observe(timbreVoice(spread(120), VOICE_A)) as string;
    const guess = tracker.identify(timbreVoice(spread(235), VOICE_A));
    expect(guess?.id).toBe(id);
  });

  /** As heard through one shared channel: the same room, speakers and mic. */
  const roomVoice = (f0s: number[], formants: Formant[], brightness = 0.08) => ({
    pitches: f0s,
    crossingRates: f0s.map(() => brightness),
    timbres: f0s
      .map((f0) => frameTimbre(colouredVoice(f0, formants), 16000))
      .filter((t): t is Float32Array => t !== null),
  });

  it('separates two videos heard through the same room and channel', () => {
    // The field failure this guards: two different videos through one set of
    // speakers scored 0.93-0.97 raw similarity — the shared channel colouring
    // dwarfed the voices — and everything merged into speaker-1. Once the
    // room average has been learned, comparison is against what makes a voice
    // deviate from the room, and the second video separates.
    const tracker = new SpeakerTracker();
    const a = tracker.observe(roomVoice(spread(105), COLOURED_A));
    for (const centre of [120, 95, 210, 112, 150, 108]) {
      expect(tracker.observe(roomVoice(spread(centre), COLOURED_A))).toBe(a);
    }

    const b = tracker.observe(roomVoice(spread(110), COLOURED_B));
    expect(b).not.toBe(a);
    expect(tracker.profiles()).toHaveLength(2);

    // And both remain themselves afterwards.
    expect(tracker.observe(roomVoice(spread(125), COLOURED_A))).toBe(a);
    expect(tracker.observe(roomVoice(spread(118), COLOURED_B))).toBe(b);
  });

  it('a warm-but-unconfident timbre holds the voice instead of founding', () => {
    // Field replay: one voice note's centered similarity wobbled to 0.75 on a
    // 72-frame utterance and founded "speaker-2". Warm MFCC scores are the
    // same voice on a bad day far more often than a stranger; they hold the
    // nearest voice, without teaching it, and never found. The timbre frames
    // here are crafted vectors, so the similarity is exact by construction.
    const mkTimbre = (cos: number): Float32Array => {
      const v = new Float32Array(12);
      v[0] = cos;
      v[1] = Math.sqrt(Math.max(0, 1 - cos * cos));
      return v;
    };
    const crafted = (cos: number, frames: number) => ({
      pitches: Array.from({ length: frames }, () => 240),
      crossingRates: Array.from({ length: frames }, () => 0.08),
      timbres: Array.from({ length: frames }, () => mkTimbre(cos)),
    });

    const tracker = new SpeakerTracker();
    const id = tracker.observe(crafted(1, 16));
    expect(tracker.observe(crafted(0.75, 72))).toBe(id);
    expect(tracker.profiles()).toHaveLength(1);
    expect(tracker.attempts().at(-1)?.reason).toContain('held');

    // Genuinely cold similarity still founds, exactly as before.
    expect(tracker.observe(crafted(0.1, 16))).toBe('speaker-2');
  });

  it('the neural voiceprint outranks the MFCC timbre', () => {
    // The voice sounds different through the cheap fingerprint (different
    // formant synth) but the network says it is the same person — and the
    // network is the stronger witness.
    const tracker = new SpeakerTracker();
    const printA = new Float32Array(16);
    printA[0] = 1;
    const a = tracker.observe({ ...timbreVoice(spread(120), VOICE_A), embedding: printA });
    const again = tracker.observe({ ...timbreVoice(spread(120), VOICE_B), embedding: printA });
    expect(again).toBe(a);
    expect(tracker.profiles()).toHaveLength(1);
    expect(tracker.attempts().at(-1)?.reason).toContain('voiceprint');
  });

  it('a long single-voice session stays one speaker after centering activates', () => {
    // Room centering must not destabilise the common case where the room
    // average IS the one voice: partial subtraction keeps its own utterances
    // matching itself.
    const tracker = new SpeakerTracker();
    const id = tracker.observe(roomVoice(spread(115), COLOURED_A));
    for (const centre of [100, 130, 95, 205, 118, 142, 110, 125, 98, 160, 120]) {
      expect(tracker.observe(roomVoice(spread(centre), COLOURED_A))).toBe(id);
    }
    expect(tracker.profiles()).toHaveLength(1);
  });
});
