import { centsBetween, median, pitchSpreadCents } from './pitch';
import { cosineSimilarity, utteranceEmbedding } from './timbre';

/**
 * Who is speaking in the room.
 *
 * Voices are separated primarily by timbre: a mel-cepstral fingerprint of the
 * vocal tract (see timbre.ts), compared by cosine similarity. Timbre is what
 * actually distinguishes voices - it survives the octave of pitch range one
 * person covers in an animated conversation, and it differs between two
 * people who happen to share a fundamental. Pitch remains as the assistant:
 * it breaks ties in the uncertain band, and it carries the whole judgement
 * for samples that arrive without timbre data.
 *
 * This is still not perfect speaker recognition. It separates voices that
 * differ audibly and can confuse ones that genuinely do not, so every
 * judgement it makes is correctable and it declines to guess when the
 * evidence is thin. Declining matters more than it sounds: an unattributed
 * turn is shown as somebody unidentified, never as the device's owner,
 * because putting a stranger's sentence in the user's mouth is the worst
 * thing this component can do.
 */

export interface SpeakerProfile {
  readonly id: string;
  readonly label: string;
  /** Running median pitch in Hz. */
  readonly pitchHz: number;
  /** Running median zero-crossing rate, as a fraction of samples. */
  readonly brightness: number;
  readonly utterances: number;
  /** True for the voice treated as the device's owner. */
  readonly isOwner: boolean;
}

export interface VoiceSample {
  readonly pitches: readonly number[];
  readonly crossingRates: readonly number[];
  /** Per-frame timbre vectors (see timbre.ts). Optional: pitch-only callers
      and old recordings still work, on the pitch rules alone. */
  readonly timbres?: readonly Float32Array[];
  /**
   * A neural voiceprint from the CAM++ speaker-verification network, when the
   * model has produced one for this utterance. The strongest evidence there
   * is; it outranks both timbre and pitch when present.
   */
  readonly embedding?: Float32Array | null;
}

/**
 * What happened to one utterance.
 *
 * Kept so the Diagnostics panel can show why a voice went unidentified. Tuning
 * this blind - guessing at thresholds without seeing what a real room produces
 * - is how it ended up mis-tuned in the first place.
 */
export interface AttributionAttempt {
  readonly at: number;
  readonly speakerId: string | null;
  readonly voicedFrames: number;
  readonly pitchHz: number | null;
  readonly spreadCents: number;
  readonly reason: string;
}

/**
 * How far a voice may sit from a profile and still be the same person.
 *
 * Four and a half semitones. The previous 250 cents split one looped video
 * voice into three speakers, because a single person's per-utterance median
 * pitch routinely wanders that far - expressive speech easily spans a fourth
 * between one sentence and the next. Wider than this starts merging genuinely
 * different adults; the residual confusions (two people near one pitch, one
 * person spanning an octave) are what a diarization model is for, not more
 * tuning here.
 */
const PITCH_TOLERANCE_CENTS = 450;

/**
 * Brightness difference large enough to overrule a pitch match.
 *
 * 0.045 was catastrophically tight. Zero-crossing rate swings with vowels and
 * consonants far more than that between two utterances by the same person, so
 * it rejected every candidate and each utterance became a brand new voice -
 * five speakers for one person. Brightness now only disqualifies a match when
 * the gap is wide enough to be a genuinely different voice; below that it is a
 * tie-breaker between candidates, never a veto.
 */
const BRIGHTNESS_VETO = 0.18;

/**
 * Utterances with less voiced audio than this cannot be judged.
 *
 * Two frames is ~130 ms of voiced speech. Lower than is comfortable, but the
 * alternative is refusing short interjections - "yes", "no", someone's name -
 * which are exactly the turns a conversation is made of.
 */
const MIN_VOICED_FRAMES = 2;

/**
 * A pitch track wandering more than an octave within one utterance almost
 * always means two people spoke over each other. Attributing the median of
 * that to either of them would be worse than admitting ignorance.
 */
const MAX_UTTERANCE_SPREAD_CENTS = 1500;

/**
 * Founding a new speaker takes real evidence: roughly a second of voiced
 * audio.
 *
 * Set from two observed failures. First a looped video filled the roster
 * with speakers spawned from fragments - "Ta.", a cough's worth of audio.
 * Then, with a six-frame bar, a nine-frame burst of excitement (224 Hz from
 * a voice centred at 125) founded a second profile mid-stream, and every
 * later sentence bounced between the two depending on where its median
 * landed. A voice that is genuinely new demonstrates it within a sentence
 * or two of ordinary speech; a pitch excursion does not sustain this long.
 * An utterance shorter than this can still *match* a known voice, and can
 * lean on the nearest one when it is reasonably close, but it can never
 * establish a new one: a wrong new speaker pollutes every later match,
 * while an unidentified turn costs nothing.
 */
const NEW_VOICE_MIN_FRAMES = 12;

/**
 * How near the closest known voice must be for an utterance too short to
 * found a speaker to be attributed to it instead of going unidentified.
 * Deliberately generous: for a short swing, "probably the same person who
 * was just talking, pitched up" is a far better answer than a brand-new
 * voice, and better than nothing when the distance is plausible.
 */
const THIN_MATCH_CENTS = 900;

/**
 * Timbre thresholds, on cosine similarity of utterance embeddings.
 *
 * Above SIM_CONFIDENT the fingerprint alone decides - the same vocal tract,
 * whatever the pitch is doing. Between SIM_POSSIBLE and SIM_CONFIDENT the
 * evidence is real but not conclusive, so pitch gets the casting vote. Below
 * SIM_POSSIBLE the voice does not sound like this profile, however close the
 * pitch - which is exactly the case pitch-only matching got wrong.
 */
const SIM_CONFIDENT = 0.9;
const SIM_POSSIBLE = 0.8;

/**
 * Neural voiceprint thresholds, on cosine similarity of CAM++ embeddings.
 *
 * Calibrated against the network itself (tests/speakerModel.test.ts): the
 * same synthetic voice saying different things scores ~0.87, a different
 * voice at the same pitch ~0.58; on real VoxCeleb speech the customary
 * verification threshold for this model family sits near 0.5. The scales are
 * unrelated to the MFCC thresholds above - a neural 0.6 is strong evidence,
 * a timbre 0.6 is nothing.
 */
const NEURAL_CONFIDENT = 0.55;
const NEURAL_POSSIBLE = 0.4;

/**
 * Matching and teaching are different bars.
 *
 * Field data from a two-person podcast: any single utterance crossing the
 * 0.55 match line taught the profile, and one early crossing was enough to
 * start a blend - the profile drifted toward the average of both hosts,
 * after which both matched it confidently (0.56–0.77 observed) and nothing
 * could ever graduate as a second voice, because nothing was "distinct from"
 * the blend. Against a *pure* profile the hosts sat apart (same voice
 * 0.58–0.98, other voice 0.40–0.51), so the profile's purity is the whole
 * game: only strong evidence may teach.
 */
const NEURAL_TEACH = 0.7;

/** How many voiceprints a profile remembers. A rolling window rather than a
    lifetime sum, so a profile that absorbed a few wrong utterances heals as
    clean evidence displaces them. */
const NEURAL_HISTORY = 16;

/**
 * The nursery: where uncertain voices accumulate evidence.
 *
 * Fast conversation produces utterances of five to nine voiced frames, and a
 * new speaker in that regime can never clear the founding bar - every turn
 * they take is "too brief", or worse, lands in the possible band against an
 * existing profile and is absorbed into it. Field data showed a two-person
 * podcast merging entirely into speaker-1 this way.
 *
 * So uncertain voiceprints are clustered instead of discarded: each
 * non-confident utterance joins (or starts) a pending cluster, and a cluster
 * graduates into a real speaker once it is coherent, sufficiently evidenced,
 * and distinct from every known profile. The geometry does the safety work -
 * one voice's noisy short utterances deviate in random directions and never
 * cohere into a cluster, while a genuinely different voice deviates the same
 * way every time.
 */
const NURSERY_JOIN = 0.5;
/** Two utterances that matched nobody, or three that only ever matched weakly. */
const NURSERY_GRADUATE_UNMATCHED = 2;
const NURSERY_GRADUATE_SHADOW = 3;
/**
 * A cluster may graduate while resembling a profile up to this much. Sits
 * between the match line (0.55) and the teach line (0.7) deliberately: a
 * voice that keeps scoring ~0.6 against a profile is exactly the second
 * podcast host the match line kept absorbing, and it must be allowed out.
 */
const NURSERY_GRADUATE_DISTINCT = 0.62;
const NURSERY_MAX_CLUSTERS = 8;
const NURSERY_EXPIRY_MS = 5 * 60 * 1000;

/**
 * The MFCC hold band. Field data showed one voice's centered timbre
 * similarity wobbling across the possible line (0.75 founded a duplicate
 * speaker; 0.86 matched) - the single-channel ceiling of these features, and
 * exactly why the neural network exists. While the network is absent, a warm
 * MFCC score is far more often the same voice on a bad day than a stranger,
 * so it holds the existing voice (without teaching it) instead of founding.
 * Neural verdicts have real discrimination and no such band.
 */
const MFCC_HOLD = 0.6;

/**
 * Room centering, the fix for the channel problem.
 *
 * Everything this microphone hears passes through the same chain - the same
 * loudspeakers, room, microphone and noise suppression - and that shared
 * colouring dominates raw fingerprints, inflating every comparison toward 1:
 * observed in the field as two different videos scoring 0.93–0.97 against
 * one another. Subtracting most of the running average of everything heard
 * (the "room average voice") leaves the part that distinguishes this voice
 * from the room, which is the part that distinguishes speakers.
 *
 * The subtraction is deliberately partial (ROOM_SHRINK < 1): full centering
 * degenerates when one voice dominates the room average - its own centered
 * vectors collapse toward noise - while partial centering keeps a stable
 * anchor. Calibration on channel-dominated synthetics: raw cross-voice 0.92
 * becomes 0.2–0.3 centered, while same-voice similarity stays above 0.99.
 * Centering activates only once the room has been heard enough to average.
 */
const ROOM_SHRINK = 0.85;
const ROOM_MIN_SAMPLES = 6;
const ROOM_WINDOW = 64;

interface MutableProfile {
  id: string;
  label: string;
  pitches: number[];
  crossings: number[];
  pitchHz: number;
  brightness: number;
  utterances: number;
  isOwner: boolean;
  /**
   * Sum of the MFCC utterance embeddings accepted into this profile. Cosine
   * similarity ignores scale, so comparing against the sum is identical to
   * comparing against the mean - no renormalisation bookkeeping.
   */
  embeddingSum: Float32Array | null;
  embeddingCount: number;
  /** Sum of the rolling window of neural voiceprints accepted here. */
  neuralSum: Float32Array | null;
  neuralCount: number;
  /** The window itself, so old evidence can be evicted as new arrives. */
  neuralHistory: Float32Array[];
}

/** How one utterance compares to one profile, on every axis we have. */
interface Candidate {
  profile: MutableProfile;
  pitchDistance: number;
  brightnessGap: number;
  similarity: number | null;
  /** Which fingerprint produced `similarity` - the scales are unrelated. */
  kind: 'neural' | 'mfcc' | null;
}

type Verdict =
  | { kind: 'match'; candidate: Candidate; update: boolean; reason: string }
  | { kind: 'new'; reason: string }
  | { kind: 'unidentified'; reason: string };

const describeSim = (candidate: { similarity: number; kind: 'neural' | 'mfcc' | null }): string =>
  `${candidate.kind === 'neural' ? 'voiceprint' : 'timbre'} ${candidate.similarity.toFixed(2)}`;

const thresholdsFor = (kind: 'neural' | 'mfcc'): { confident: number; possible: number } =>
  kind === 'neural'
    ? { confident: NEURAL_CONFIDENT, possible: NEURAL_POSSIBLE }
    : { confident: SIM_CONFIDENT, possible: SIM_POSSIBLE };

/** A profile's (or utterance's) vector with most of the room subtracted. */
function centreByRoom(sum: Float32Array, count: number, room: Float32Array): Float32Array {
  const out = new Float32Array(sum.length);
  for (let d = 0; d < sum.length; d += 1) {
    out[d] = (sum[d] as number) / count - ROOM_SHRINK * (room[d] as number);
  }
  return out;
}

/**
 * The attribution policy, pure and in one place.
 *
 * Evidence ranks: a neural voiceprint outranks the MFCC timbre, which
 * outranks pitch. A confident fingerprint match wins whatever the pitch is
 * doing; a possible one needs pitch to agree before the profile is allowed
 * to learn from it; below possible, the voice does not sound like anyone
 * known and pitch proximity cannot overrule that. Without any fingerprint -
 * old callers, tests, degraded input - the original pitch rules apply
 * unchanged.
 */
function decide(candidates: Candidate[], frames: number, hasFingerprint: boolean): Verdict {
  const thin = frames < NEW_VOICE_MIN_FRAMES;

  if (hasFingerprint) {
    type Judged = Candidate & { similarity: number; kind: 'neural' | 'mfcc' };
    const judged = candidates.filter((c): c is Judged => c.similarity !== null && c.kind !== null);
    const bestOf = (kind: 'neural' | 'mfcc'): Judged | null => {
      let best: Judged | null = null;
      for (const c of judged) {
        if (c.kind !== kind) continue;
        if (best === null || c.similarity > best.similarity) best = c;
      }
      return best;
    };
    // Neural first at every level: it is the stronger witness.
    const ranked = [bestOf('neural'), bestOf('mfcc')].filter((c): c is Judged => c !== null);

    for (const best of ranked) {
      if (best.similarity >= thresholdsFor(best.kind).confident) {
        // A confident match attributes; only a STRONG one teaches. Teaching at
        // the match line is how one podcast host's profile blended into both.
        const teach = best.kind === 'mfcc' || best.similarity >= NEURAL_TEACH;
        return {
          kind: 'match',
          candidate: best,
          update: teach,
          reason: `matched by voice - ${describeSim(best)}`,
        };
      }
    }
    for (const best of ranked) {
      if (
        best.similarity >= thresholdsFor(best.kind).possible &&
        best.pitchDistance <= PITCH_TOLERANCE_CENTS
      ) {
        // Attribute, but never teach: a possible-band match is the likeliest
        // label, not proof. Teaching on these is how a two-person podcast
        // blended into one profile - each absorbed utterance dragged the
        // voiceprint toward the average of both people, and the blend then
        // matched everyone confidently.
        return {
          kind: 'match',
          candidate: best,
          update: false,
          reason: `fingerprint and pitch agree - ${describeSim(best)}`,
        };
      }
    }

    // Profiles from before fingerprints existed can only be judged by pitch;
    // give them that chance before founding a duplicate of one of them.
    const unjudged = candidates.filter((c) => c.similarity === null);
    const pitchVerdict = decideByPitch(unjudged, frames);
    if (pitchVerdict.kind === 'match') return pitchVerdict;

    for (const best of ranked) {
      if (best.similarity >= thresholdsFor(best.kind).possible) {
        // Sounds like them, pitched far away - an excited swing more often
        // than a stranger. Attribute without letting it move the profile.
        return {
          kind: 'match',
          candidate: best,
          update: false,
          reason: `similar voice across a wide pitch move - ${describeSim(best)}`,
        };
      }
      if (best.kind === 'mfcc' && best.similarity >= MFCC_HOLD) {
        return {
          kind: 'match',
          candidate: best,
          update: false,
          reason: `held to the nearest voice - ${describeSim(best)}`,
        };
      }
    }

    const nearest = ranked[0] ?? null;
    if (thin) {
      return {
        kind: 'unidentified',
        reason: `too brief to establish a new voice (${frames} frames${
          nearest ? `, nearest ${describeSim(nearest)}` : ''
        })`,
      };
    }
    return {
      kind: 'new',
      reason: `new voice${nearest ? ` - nearest ${describeSim(nearest)}` : ''}`,
    };
  }

  return decideByPitch(candidates, frames);
}

/** The pre-timbre rules, kept verbatim for samples without fingerprints. */
function decideByPitch(candidates: Candidate[], frames: number): Verdict {
  const thin = frames < NEW_VOICE_MIN_FRAMES;

  let closest: Candidate | null = null;
  let closestScore = Infinity;
  for (const c of candidates) {
    // Only a wide gap overrules a pitch match. Anything narrower is ordinary
    // variation between two sentences by the same person.
    if (c.brightnessGap > BRIGHTNESS_VETO) continue;
    // Pitch decides; brightness separates otherwise equal candidates.
    const score = c.pitchDistance + c.brightnessGap * 400;
    if (score < closestScore) {
      closest = c;
      closestScore = score;
    }
  }

  if (closest && closest.pitchDistance <= PITCH_TOLERANCE_CENTS) {
    return { kind: 'match', candidate: closest, update: true, reason: 'matched an existing voice' };
  }
  if (closest && thin && closest.pitchDistance <= THIN_MATCH_CENTS) {
    return {
      kind: 'match',
      candidate: closest,
      update: false,
      reason: 'near an existing voice - too brief to justify a new one',
    };
  }
  if (thin) {
    return { kind: 'unidentified', reason: `too brief to establish a new voice (${frames} frames)` };
  }
  return { kind: 'new', reason: 'new voice' };
}

/** A voice forming in the nursery: not yet a speaker, no longer noise. */
interface PendingVoice {
  sum: Float32Array;
  count: number;
  /** Members that matched no profile at all - stronger evidence of newness. */
  unmatchedCount: number;
  lastAt: number;
}

export class SpeakerTracker {
  #profiles = new Map<string, MutableProfile>();
  #nextIndex = 1;
  #attempts: AttributionAttempt[] = [];
  /** Recent utterance embeddings from everyone - the room's average voice. */
  #roomEmbeddings: Float32Array[] = [];
  /** Voices accumulating evidence before they earn a profile. */
  #pending: PendingVoice[] = [];

  /** How many voices are forming but not yet assigned. For the interface.
      A single stray fragment is not a voice; it takes two coherent
      utterances before the room is told someone new might be here. */
  pendingCount(): number {
    return this.#pending.filter((cluster) => cluster.count >= 2).length;
  }

  /** Add an uncertain voiceprint to the nursery; returns the cluster joined. */
  #nurseryAdd(embedding: Float32Array, unmatched: boolean, at: number): PendingVoice {
    this.#pending = this.#pending.filter((cluster) => at - cluster.lastAt < NURSERY_EXPIRY_MS);

    let best: PendingVoice | null = null;
    let bestSim = -1;
    for (const cluster of this.#pending) {
      const sim = cosineSimilarity(embedding, cluster.sum);
      if (sim > bestSim) {
        best = cluster;
        bestSim = sim;
      }
    }

    if (best && bestSim >= NURSERY_JOIN) {
      for (let d = 0; d < embedding.length; d += 1) {
        best.sum[d] = (best.sum[d] as number) + (embedding[d] as number);
      }
      best.count += 1;
      if (unmatched) best.unmatchedCount += 1;
      best.lastAt = at;
      return best;
    }

    const cluster: PendingVoice = {
      sum: Float32Array.from(embedding),
      count: 1,
      unmatchedCount: unmatched ? 1 : 0,
      lastAt: at,
    };
    this.#pending.push(cluster);
    if (this.#pending.length > NURSERY_MAX_CLUSTERS) {
      this.#pending.sort((a, b) => a.lastAt - b.lastAt);
      this.#pending.shift();
    }
    return cluster;
  }

  /** Coherent, evidenced, and distinct from everyone known → a real voice. */
  #shouldGraduate(cluster: PendingVoice): boolean {
    const enough =
      cluster.unmatchedCount >= NURSERY_GRADUATE_UNMATCHED ||
      cluster.count >= NURSERY_GRADUATE_SHADOW;
    if (!enough) return false;
    for (const profile of this.#profiles.values()) {
      if (
        profile.neuralSum &&
        cosineSimilarity(cluster.sum, profile.neuralSum) >= NURSERY_GRADUATE_DISTINCT
      ) {
        return false;
      }
    }
    return true;
  }

  #graduate(cluster: PendingVoice, pitch: number, brightness: number): MutableProfile {
    this.#pending = this.#pending.filter((candidate) => candidate !== cluster);
    const index = this.#nextIndex;
    this.#nextIndex += 1;
    const id = `speaker-${index}`;
    const mean = new Float32Array(cluster.sum.length);
    for (let d = 0; d < mean.length; d += 1) mean[d] = (cluster.sum[d] as number) / cluster.count;
    const profile: MutableProfile = {
      id,
      label: `Speaker ${index}`,
      pitches: [pitch],
      crossings: [brightness],
      pitchHz: pitch,
      brightness,
      utterances: cluster.count,
      isOwner: false,
      embeddingSum: null,
      embeddingCount: 0,
      neuralSum: Float32Array.from(mean),
      neuralCount: 1,
      neuralHistory: [mean],
    };
    this.#profiles.set(id, profile);
    return profile;
  }

  #roomMean(): Float32Array | null {
    if (this.#roomEmbeddings.length < ROOM_MIN_SAMPLES) return null;
    const first = this.#roomEmbeddings[0] as Float32Array;
    const mean = new Float32Array(first.length);
    for (const e of this.#roomEmbeddings) {
      for (let d = 0; d < mean.length; d += 1) mean[d] = (mean[d] as number) + (e[d] as number);
    }
    for (let d = 0; d < mean.length; d += 1) mean[d] = (mean[d] as number) / this.#roomEmbeddings.length;
    return mean;
  }

  /** The most recent attribution attempts, newest last. */
  attempts(): readonly AttributionAttempt[] {
    return this.#attempts;
  }

  #record(attempt: AttributionAttempt): void {
    this.#attempts.push(attempt);
    if (this.#attempts.length > 12) this.#attempts.shift();
  }

  /**
   * Attribute an utterance to a voice.
   *
   * @returns the speaker id, or null when there was too little voiced audio, or
   *   when the utterance appears to contain more than one person.
   */
  observe(sample: VoiceSample): string | null {
    const { pitches, crossingRates } = sample;
    const spread = pitchSpreadCents(pitches);
    const at = Date.now();

    if (pitches.length < MIN_VOICED_FRAMES) {
      this.#record({
        at,
        speakerId: null,
        voicedFrames: pitches.length,
        pitchHz: null,
        spreadCents: 0,
        reason: `too little voiced audio (${pitches.length} frames)`,
      });
      return null;
    }

    if (spread > MAX_UTTERANCE_SPREAD_CENTS) {
      this.#record({
        at,
        speakerId: null,
        voicedFrames: pitches.length,
        pitchHz: (() => {
          const m = median(pitches);
          return m === null ? null : Math.round(m);
        })(),
        spreadCents: Math.round(spread),
        reason: 'pitch spanned more than an octave - probably two people at once',
      });
      return null;
    }

    const pitch = median(pitches);
    if (pitch === null) {
      this.#record({ at, speakerId: null, voicedFrames: pitches.length, pitchHz: null, spreadCents: 0, reason: 'no median pitch' });
      return null;
    }
    const brightness = median(crossingRates) ?? 0;
    const mfccEmbedding = sample.timbres ? utteranceEmbedding(sample.timbres) : null;
    const neural = sample.embedding ?? null;

    const candidates = this.#candidates(pitch, brightness, mfccEmbedding, neural);
    const verdict = decide(candidates, pitches.length, mfccEmbedding !== null || neural !== null);

    // Every utterance teaches the room average, whoever said it - including
    // the ones that go unidentified. The mean of everything heard is exactly
    // what makes individual voices distinguishable from it.
    if (mfccEmbedding) {
      this.#roomEmbeddings.push(mfccEmbedding);
      if (this.#roomEmbeddings.length > ROOM_WINDOW) this.#roomEmbeddings.shift();
    }

    // The nursery. Any utterance the network did not confidently place - an
    // uncertain attribution (match without teaching) or no attribution at all
    // - deposits its voiceprint here. A new speaker in fast conversation
    // never gets a long utterance to found with; they earn their profile a
    // few short utterances at a time, and graduate the moment their cluster
    // is coherent, evidenced, and unlike everyone known.
    if (neural && (verdict.kind === 'unidentified' || (verdict.kind === 'match' && !verdict.update))) {
      let bestNeuralSim = -1;
      for (const c of candidates) {
        if (c.kind === 'neural' && c.similarity !== null && c.similarity > bestNeuralSim) {
          bestNeuralSim = c.similarity;
        }
      }
      const cluster = this.#nurseryAdd(neural, bestNeuralSim < NEURAL_POSSIBLE, at);
      if (this.#shouldGraduate(cluster)) {
        const graduated = this.#graduate(cluster, pitch, brightness);
        this.#record({
          at,
          speakerId: graduated.id,
          voicedFrames: pitches.length,
          pitchHz: Math.round(pitch),
          spreadCents: Math.round(spread),
          reason: `new voice, separated across ${graduated.neuralCount} short utterances`,
        });
        return graduated.id;
      }
    }

    if (verdict.kind === 'match') {
      const profile = verdict.candidate.profile;
      if (verdict.update) {
        // A bounded history keeps the centroid tracking the speaker without
        // one outlier dragging it, or slow drift across a long conversation.
        profile.pitches.push(pitch);
        profile.crossings.push(brightness);
        if (profile.pitches.length > 32) profile.pitches.shift();
        if (profile.crossings.length > 32) profile.crossings.shift();
        profile.pitchHz = median(profile.pitches) ?? profile.pitchHz;
        profile.brightness = median(profile.crossings) ?? profile.brightness;
        if (mfccEmbedding) {
          if (profile.embeddingSum === null) {
            profile.embeddingSum = Float32Array.from(mfccEmbedding);
            profile.embeddingCount = 1;
          } else {
            for (let d = 0; d < mfccEmbedding.length; d += 1) {
              profile.embeddingSum[d] =
                (profile.embeddingSum[d] as number) + (mfccEmbedding[d] as number);
            }
            profile.embeddingCount += 1;
          }
        }
        if (neural) {
          const copy = Float32Array.from(neural);
          profile.neuralHistory.push(copy);
          if (profile.neuralSum === null) profile.neuralSum = new Float32Array(neural.length);
          for (let d = 0; d < neural.length; d += 1) {
            profile.neuralSum[d] = (profile.neuralSum[d] as number) + (copy[d] as number);
          }
          // Rolling window: a profile heals from a wrongly-absorbed utterance
          // as clean evidence displaces it, instead of carrying it forever.
          if (profile.neuralHistory.length > NEURAL_HISTORY) {
            const evicted = profile.neuralHistory.shift() as Float32Array;
            for (let d = 0; d < evicted.length; d += 1) {
              profile.neuralSum[d] = (profile.neuralSum[d] as number) - (evicted[d] as number);
            }
          }
          profile.neuralCount = profile.neuralHistory.length;
        }
      }
      // An uncertain match never moves the profile: the evidence was too thin
      // or too ambiguous to let a possibly-wrong utterance drag the voice it
      // was attributed to.
      profile.utterances += 1;
      this.#record({
        at,
        speakerId: profile.id,
        voicedFrames: pitches.length,
        pitchHz: Math.round(pitch),
        spreadCents: Math.round(spread),
        reason: verdict.reason,
      });
      return profile.id;
    }

    if (verdict.kind === 'unidentified') {
      // A fragment far from every known voice stays unidentified. It must
      // never found a speaker: a wrong new profile pollutes every later match,
      // while an unlabelled turn costs nothing.
      this.#record({
        at,
        speakerId: null,
        voicedFrames: pitches.length,
        pitchHz: Math.round(pitch),
        spreadCents: Math.round(spread),
        reason: verdict.reason,
      });
      return null;
    }

    const index = this.#nextIndex;
    this.#nextIndex += 1;
    const id = `speaker-${index}`;
    this.#profiles.set(id, {
      id,
      label: `Speaker ${index}`,
      pitches: [pitch],
      crossings: [brightness],
      pitchHz: pitch,
      brightness,
      utterances: 1,
      // Never presumed. The device's user is speech-impaired: the voices this
      // microphone hears are, by default, other people. A voice becomes the
      // owner's only when someone explicitly says "this is me".
      isOwner: false,
      embeddingSum: mfccEmbedding ? Float32Array.from(mfccEmbedding) : null,
      embeddingCount: mfccEmbedding ? 1 : 0,
      neuralSum: neural ? Float32Array.from(neural) : null,
      neuralCount: neural ? 1 : 0,
      neuralHistory: neural ? [Float32Array.from(neural)] : [],
    });
    this.#record({
      at,
      speakerId: id,
      voicedFrames: pitches.length,
      pitchHz: Math.round(pitch),
      spreadCents: Math.round(spread),
      reason: verdict.reason,
    });
    return id;
  }

  /** Compare an utterance to every profile, on every axis available. */
  #candidates(
    pitch: number,
    brightness: number,
    mfccEmbedding: Float32Array | null,
    neural: Float32Array | null,
  ): Candidate[] {
    // Once the room has been heard enough, MFCC comparisons happen on what
    // makes a voice deviate from the room average, not on the colouring the
    // room stamps on everyone. Neural voiceprints need no such correction -
    // channel robustness is what the network was trained for.
    const room = mfccEmbedding ? this.#roomMean() : null;
    const centred = mfccEmbedding && room ? centreByRoom(mfccEmbedding, 1, room) : mfccEmbedding;

    const out: Candidate[] = [];
    for (const profile of this.#profiles.values()) {
      let similarity: number | null = null;
      let kind: Candidate['kind'] = null;
      if (neural && profile.neuralSum) {
        similarity = cosineSimilarity(neural, profile.neuralSum);
        kind = 'neural';
      } else if (centred && profile.embeddingSum) {
        const profileVector = room
          ? centreByRoom(profile.embeddingSum, profile.embeddingCount, room)
          : profile.embeddingSum;
        similarity = cosineSimilarity(centred, profileVector);
        kind = 'mfcc';
      }
      out.push({
        profile,
        pitchDistance: centsBetween(pitch, profile.pitchHz),
        brightnessGap: Math.abs(brightness - profile.brightness),
        similarity,
        kind,
      });
    }
    return out;
  }

  /**
   * Best guess at who is speaking, without changing anything.
   *
   * Used while someone is still talking, so the interface can name them as they
   * speak rather than only once they stop. Deliberately read-only: a provisional
   * guess must not pull a profile's centroid around, or a mistaken mid-utterance
   * match would corrupt the voice it was mistaken for.
   */
  identify(sample: VoiceSample): SpeakerProfile | null {
    const { pitches, crossingRates } = sample;
    if (pitches.length < MIN_VOICED_FRAMES) return null;

    const pitch = median(pitches);
    if (pitch === null) return null;
    const brightness = median(crossingRates) ?? 0;
    const mfccEmbedding = sample.timbres ? utteranceEmbedding(sample.timbres) : null;
    const neural = sample.embedding ?? null;

    const candidates = this.#candidates(pitch, brightness, mfccEmbedding, neural);
    // A live guess must be at least as careful as a final attribution, so it
    // reuses the same policy - but a guess that would found or lean is no
    // guess at all, so only a real match names anyone.
    const verdict = decide(candidates, pitches.length, mfccEmbedding !== null || neural !== null);
    return verdict.kind === 'match' && verdict.update
      ? this.#snapshot(verdict.candidate.profile)
      : null;
  }

  #snapshot(profile: MutableProfile): SpeakerProfile {
    return {
      id: profile.id,
      label: profile.label,
      pitchHz: Math.round(profile.pitchHz),
      brightness: Number(profile.brightness.toFixed(3)),
      utterances: profile.utterances,
      isOwner: profile.isOwner,
    };
  }

  profiles(): SpeakerProfile[] {
    return [...this.#profiles.values()].map((profile) => this.#snapshot(profile));
  }

  get(id: string | null | undefined): SpeakerProfile | null {
    if (!id) return null;
    const profile = this.#profiles.get(id);
    return profile ? this.#snapshot(profile) : null;
  }

  ownerId(): string | null {
    for (const profile of this.#profiles.values()) if (profile.isOwner) return profile.id;
    return null;
  }

  rename(id: string, label: string): void {
    const profile = this.#profiles.get(id);
    if (profile && label.trim().length > 0) profile.label = label.trim();
  }

  /**
   * Exactly one voice is the owner's; marking a new one clears the previous.
   *
   * This is the only way a voice ever becomes "You" - ownership is claimed,
   * never presumed, because the user of this device may produce no voice for
   * the microphone to hear at all.
   */
  markAsOwner(id: string): void {
    if (!this.#profiles.has(id)) return;
    for (const profile of this.#profiles.values()) {
      const isOwner = profile.id === id;
      if (profile.isOwner && !isOwner && profile.label === 'You') {
        // Give the demoted profile a neutral name rather than leaving it "You".
        profile.label = `Speaker ${profile.id.replace('speaker-', '')}`;
      }
      if (isOwner && /^Speaker \d+$/.test(profile.label)) {
        // A claimed voice with only its default name becomes "You"; a custom
        // name (their own name, say) is kept.
        profile.label = 'You';
      }
      profile.isOwner = isOwner;
    }
  }

  /** Split a profile that has merged two people, so they can re-separate. */
  forget(id: string): void {
    this.#profiles.delete(id);
  }

  reset(): void {
    this.#profiles.clear();
    this.#attempts = [];
    this.#nextIndex = 1;
    this.#roomEmbeddings = [];
  }
}
