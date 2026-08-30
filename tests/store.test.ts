import { beforeEach, describe, expect, it } from 'vitest';
import {
  actions,
  CONTEXT_WINDOW,
  selectContextWindow,
  selectTranscriptText,
  store,
} from '@/state/store';

describe('turn management', () => {
  beforeEach(() => {
    store.reset();
  });

  it('updates an interim turn in place instead of appending fragments', () => {
    actions.upsertTurn({ id: 'turn_1', source: 'peer', text: 'would you', final: false });
    actions.upsertTurn({ id: 'turn_1', source: 'peer', text: 'would you like', final: false });
    actions.upsertTurn({ id: 'turn_1', source: 'peer', text: 'Would you like tea?', final: true });

    const turns = store.getState().turns;
    expect(turns).toHaveLength(1);
    expect(turns[0]?.text).toBe('Would you like tea?');
    expect(turns[0]?.final).toBe(true);
  });

  it('carries the speaker attribution onto the turn', () => {
    // The bug this guards: the merge listed its fields by hand, so speakerId
    // and voice were forgotten when added. Every update discarded the speaker
    // the tracker had just identified, and the transcript said "Unidentified
    // voice" for turns that had matched perfectly well. Both fields are
    // optional, so the compiler had nothing to object to.
    actions.upsertTurn({
      id: 'turn_1',
      source: 'user',
      text: 'hello',
      final: true,
      dictated: true,
      speakerId: 'speaker-2',
      voice: { pitchHz: 198, frames: 12, considered: 31, reason: 'matched an existing voice' },
    });

    const turn = store.getState().turns[0];
    expect(turn?.speakerId).toBe('speaker-2');
    expect(turn?.voice?.pitchHz).toBe(198);
  });

  it('keeps an attribution already on the turn when a later update omits it', () => {
    actions.upsertTurn({ id: 'turn_1', source: 'user', text: 'hi', dictated: true, speakerId: 'speaker-3' });
    actions.upsertTurn({ id: 'turn_1', source: 'user', text: 'hi there', final: true, dictated: true });

    expect(store.getState().turns[0]?.speakerId).toBe('speaker-3');
  });

  it('preserves the original timestamp across interim updates', () => {
    actions.upsertTurn({ id: 'turn_1', source: 'user', text: 'hello', final: false, at: 1000 });
    actions.upsertTurn({ id: 'turn_1', source: 'user', text: 'hello there', final: true });
    expect(store.getState().turns[0]?.at).toBe(1000);
  });

  it('keeps separate turns for the two speakers', () => {
    actions.addTurn('peer', 'How are you?');
    actions.addTurn('user', 'I am well.');
    expect(store.getState().turns).toHaveLength(2);
  });

  it('limits the agent context window to the last ten final turns', () => {
    for (let index = 0; index < 25; index += 1) {
      actions.addTurn(index % 2 === 0 ? 'peer' : 'user', `turn ${index}`);
    }
    const window = selectContextWindow(store.getState());
    expect(window).toHaveLength(CONTEXT_WINDOW);
    expect(window.at(-1)?.text).toBe('turn 24');
  });

  it('excludes interim turns from the context window', () => {
    actions.addTurn('peer', 'Finished sentence.');
    actions.upsertTurn({ id: 'partial', source: 'peer', text: 'still going', final: false });

    const window = selectContextWindow(store.getState());
    expect(window).toHaveLength(1);
    expect(window[0]?.text).toBe('Finished sentence.');
  });

  it('renders the transcript with explicit speaker attribution', () => {
    actions.addTurn('peer', 'Would you like tea?');
    actions.addTurn('user', 'Yes, please.');
    expect(selectTranscriptText(store.getState())).toBe('Partner: Would you like tea?\nUser: Yes, please.');
  });
});

describe('composition', () => {
  beforeEach(() => {
    store.reset();
  });

  it('inserts a separating space when appending a word', () => {
    actions.setComposition('I need');
    actions.appendComposition('water');
    expect(store.getState().composition).toBe('I need water');
  });

  it('does not insert a space before punctuation', () => {
    actions.setComposition('Hello');
    actions.appendComposition(', please');
    expect(store.getState().composition).toBe('Hello, please');
  });

  it('holds a live dictation preview separate from the committed text', () => {
    // The preview is what the recogniser is hearing right now; it must not be
    // mixed into the composition until the utterance is finished, or editing
    // fights with the incoming words.
    actions.setComposition('I need');
    actions.setDictationPreview('some wa');
    expect(store.getState().composition).toBe('I need');
    expect(store.getState().dictationPreview).toBe('some wa');
  });

  it('clears the preview when the composition is cleared', () => {
    actions.setDictationPreview('half a sentence');
    actions.clearComposition();
    expect(store.getState().dictationPreview).toBe('');
  });

  it('remembers when an agent wrote the buffer, until the user takes over', () => {
    // The composer shows a "the assistant wrote this" marker off this flag; it
    // must survive nothing and no one except the user actually editing.
    actions.setComposition('I would like some cold water, please.', 'agent');
    expect(store.getState().compositionAuthor).toBe('agent');

    actions.setComposition('I would like some cold water.');
    expect(store.getState().compositionAuthor).toBe('user');
  });

  it('appending is a user gesture and claims the buffer for the user', () => {
    actions.setComposition('Machine wrote this', 'agent');
    actions.appendComposition('and I added this');
    expect(store.getState().compositionAuthor).toBe('user');
  });

  it('an emptied buffer has no author to warn about', () => {
    actions.setComposition('agent text', 'agent');
    actions.setComposition('', 'agent');
    expect(store.getState().compositionAuthor).toBe('user');

    actions.setComposition('agent text', 'agent');
    actions.clearComposition();
    expect(store.getState().compositionAuthor).toBe('user');
  });

  it('clearing also discards anything an agent staged', () => {
    actions.setComposition('draft');
    actions.stageSpeech('agent wrote this');
    actions.clearComposition();

    expect(store.getState().composition).toBe('');
    expect(store.getState().stagedSpeech).toBeNull();
  });
});

describe('predictions and notices', () => {
  beforeEach(() => {
    store.reset();
  });

  it('never shows more than three suggestions', () => {
    actions.setPredictions(
      ['a', 'b', 'c', 'd', 'e'].map((text) => ({ text, source: 'heuristic' as const })),
    );
    expect(store.getState().predictions).toHaveLength(3);
  });

  it('clears the thinking state when suggestions arrive', () => {
    actions.setPredicting(true);
    actions.setPredictions([{ text: 'Yes.', source: 'heuristic' }]);
    expect(store.getState().predicting).toBe(false);
  });

  it('caps the notice stack so it cannot bury the interface', () => {
    for (let index = 0; index < 12; index += 1) actions.notify('info', `notice ${index}`);
    expect(store.getState().notices.length).toBeLessThanOrEqual(6);
    expect(store.getState().notices.at(-1)?.text).toBe('notice 11');
  });
});

describe('assistant activity', () => {
  beforeEach(() => {
    store.reset();
  });

  it('tracks concurrent work without allowing a negative task count', () => {
    const firstTask = actions.beginAssistTask('themes', 'Pictures for “help”');
    const secondTask = actions.beginAssistTask('themes', 'Pictures for “water”');
    expect(store.getState().assistFeatures.themes.activeTasks).toBe(2);

    actions.finishAssistTask('themes', 'ready', 9, firstTask);
    expect(store.getState().assistFeatures.themes).toMatchObject({
      activeTasks: 1,
      status: 'working',
    });

    actions.finishAssistTask('themes', 'ready', 18, secondTask);
    actions.finishAssistTask('themes', 'ready', 18);
    expect(store.getState().assistFeatures.themes).toMatchObject({
      activeTasks: 0,
      status: 'ready',
      resultCount: 18,
    });
    expect(store.getState().assistFeatures.themes.tasks).toHaveLength(2);
    expect(store.getState().assistFeatures.themes.tasks.map((task) => task.label)).toEqual([
      'Pictures for “water”',
      'Pictures for “help”',
    ]);
  });

  it('keeps the latest and immediately previous context generations', () => {
    const firstWords = [{ text: 'water', symbol: '💧' }];
    const firstPhrases = [{ text: 'Water, please.', symbol: '💧' }];
    actions.setContextSuggestions(firstWords, firstPhrases);
    actions.setContextSuggestions(
      [{ text: 'cold', symbol: '🥶' }],
      [{ text: 'I am cold.', symbol: '🥶' }],
    );

    expect(store.getState().contextualWords[0]?.text).toBe('cold');
    expect(store.getState().previousContextualWords[0]?.text).toBe('water');
    expect(store.getState().previousContextualPhrases[0]?.text).toBe('Water, please.');

    actions.setContextSuggestions([], []);
    expect(store.getState().contextualWords).toEqual([]);
    expect(store.getState().previousContextualWords).toEqual([]);
  });

  it('never accepts fixed-board or already-visible context choices', () => {
    actions.setContextSuggestions(
      [{ text: 'water', symbol: '💧' }],
      [{ text: 'I agree.', symbol: '✅' }],
    );
    actions.setContextSuggestions(
      [
        { text: 'help', symbol: '🆘' },
        { text: 'water', symbol: '💧' },
      ],
      [
        { text: 'Please stop', symbol: '✋' },
        { text: 'I agree.', symbol: '✅' },
      ],
    );

    expect(store.getState().contextualWords.map((choice) => choice.text)).toEqual(['water']);
    expect(store.getState().contextualPhrases.map((choice) => choice.text)).toEqual(['I agree.']);
  });
});

describe('settings persistence', () => {
  beforeEach(() => {
    store.reset();
    localStorage.clear();
  });

  it('drops retired settings keys lingering in old local storage', () => {
    localStorage.setItem(
      'aac.settings.v1',
      JSON.stringify({
        speechRate: 1.25,
        largeText: false,
        autoSpeakPredictions: false,
        chatGPTAssist: false,
      }),
    );
    actions.loadSettings();
    const settings = store.getState().settings as unknown as Record<string, unknown>;
    expect(settings.speechRate).toBe(1.25);
    expect('largeText' in settings).toBe(false);
    expect('autoSpeakPredictions' in settings).toBe(false);
    expect('chatGPTAssist' in settings).toBe(false);
  });

  it('round-trips through local storage', () => {
    actions.setSettings({
      speechRate: 1.4,
      highContrast: true,
      symbolTheme: 'anime',
    });
    store.reset();
    expect(store.getState().settings.speechRate).toBe(1);

    actions.loadSettings();
    expect(store.getState().settings.speechRate).toBe(1.4);
    expect(store.getState().settings.highContrast).toBe(true);
    expect(store.getState().settings.symbolTheme).toBe('anime');
  });

  it('survives corrupt stored settings', () => {
    localStorage.setItem('aac.settings.v1', '{not json');
    expect(() => actions.loadSettings()).not.toThrow();
    expect(store.getState().settings.speechRate).toBe(1);
  });
});

describe('context corrections', () => {
  beforeEach(() => {
    store.reset();
  });

  it('applies only to the exact current dictated turn and remains undoable', () => {
    actions.upsertTurn({
      id: 'turn_uncertain',
      source: 'peer',
      text: 'Would you like watter?',
      final: true,
      dictated: true,
      words: [
        { text: 'Would', confidence: 0.96 },
        { text: 'you', confidence: 0.98 },
        { text: 'like', confidence: 0.91 },
        { text: 'watter?', confidence: 0.31 },
      ],
    });

    expect(
      actions.applyContextCorrection(
        'turn_uncertain',
        'Would you like watter?',
        'Would you like water?',
        'Water was already being discussed.',
      ),
    ).toBe(true);
    expect(store.getState().turns[0]).toMatchObject({
      text: 'Would you like water?',
      originalText: 'Would you like watter?',
      correctionSource: 'chatgpt',
    });
    expect(store.getState().turns[0]?.words).toBeUndefined();

    expect(actions.revertContextCorrection('turn_uncertain')).toBe(true);
    expect(store.getState().turns[0]?.text).toBe('Would you like watter?');
    expect(store.getState().turns[0]?.originalText).toBeUndefined();
  });

  it('refuses a stale correction instead of overwriting newer text', () => {
    actions.upsertTurn({
      id: 'turn_changed',
      source: 'user',
      text: 'The current version.',
      final: true,
      dictated: true,
    });
    expect(
      actions.applyContextCorrection(
        'turn_changed',
        'An older version.',
        'A corrected older version.',
        'Stale response.',
      ),
    ).toBe(false);
    expect(store.getState().turns[0]?.text).toBe('The current version.');
  });
});

describe('turn retraction', () => {
  beforeEach(() => {
    store.reset();
  });

  it('removes a turn by id', () => {
    const kept = actions.addTurn('peer', 'Still here.');
    const retracted = actions.upsertTurn({ id: 'rtt_1', source: 'peer', text: 'half typed', final: false });

    actions.removeTurn(retracted.id);

    const turns = store.getState().turns;
    expect(turns).toHaveLength(1);
    expect(turns[0]?.id).toBe(kept.id);
  });

  it('is a no-op for an unknown id', () => {
    actions.addTurn('peer', 'Only turn.');
    actions.removeTurn('nope');
    expect(store.getState().turns).toHaveLength(1);
  });

  it('keeps one line when a message is typed then sent under a stable id', () => {
    // The failure this guards against: a fresh id per keystroke left the
    // partner with a new "still speaking" line for every burst of typing.
    const id = 'rtt_stable';
    actions.upsertTurn({ id, source: 'peer', text: 'What would', final: false, viaRtt: true });
    actions.upsertTurn({ id, source: 'peer', text: 'What would you like', final: false, viaRtt: true });
    actions.upsertTurn({ id, source: 'peer', text: 'What would you like to drink?', final: true, viaRtt: true });

    const turns = store.getState().turns;
    expect(turns).toHaveLength(1);
    expect(turns[0]?.final).toBe(true);
    expect(turns[0]?.text).toBe('What would you like to drink?');
  });
});

describe('dictation into the conversation', () => {
  beforeEach(() => {
    store.reset();
  });

  it('updates one turn in place as the words firm up', () => {
    const id = 'turn_dictated';
    actions.upsertTurn({ id, source: 'user', text: 'i need', final: false, dictated: true });
    actions.upsertTurn({ id, source: 'user', text: 'I need some water.', final: true, dictated: true });

    const turns = store.getState().turns;
    expect(turns).toHaveLength(1);
    expect(turns[0]?.text).toBe('I need some water.');
  });

  it('marks dictated turns as not spoken, so the transcript stays truthful', () => {
    // Dictation is heard, not said aloud and not transmitted. Recording it as
    // speech would claim something that did not happen.
    const turn = actions.upsertTurn({
      id: 'turn_1',
      source: 'user',
      text: 'Hello there.',
      final: true,
      dictated: true,
    });
    expect(turn.dictated).toBe(true);
    expect(turn.spoken).toBe(false);
  });

  it('keeps spoken turns distinct from dictated ones', () => {
    const spoken = actions.addTurn('user', 'I would like some water, please.', { spoken: true });
    expect(spoken.dictated).toBe(false);
  });
});
