import { describe, expect, it } from 'vitest';
import { isPlausibleExpansion, looksLikeEcho } from '@/prediction/onDeviceModel';

/**
 * Regression tests for a failure found by running the application.
 *
 * A browser shipped a stub Prompt API that reported itself available and then
 * returned its own prompt with a preamble. The expansion tier accepted it, and
 * "On-device model is not available in Chromium, this API is just echoing back
 * the input:" landed in the composition buffer - one tap away from being spoken
 * aloud as the user's own words.
 */

const CANARY = 'Respond with a single word and nothing else: READY';

describe('looksLikeEcho', () => {
  it('catches the stub that prefixes and returns the prompt', () => {
    const stubbed =
      'On-device model is not available in Chromium, this API is just echoing back the input: ' + CANARY;
    expect(looksLikeEcho(CANARY, stubbed)).toBe(true);
  });

  it('catches a bare echo with no preamble', () => {
    expect(looksLikeEcho(CANARY, CANARY)).toBe(true);
  });

  it('catches other ways of saying "there is no model here"', () => {
    expect(looksLikeEcho(CANARY, 'This is a placeholder implementation.')).toBe(true);
    expect(looksLikeEcho(CANARY, 'No model is loaded.')).toBe(true);
  });

  it('accepts a genuine answer', () => {
    expect(looksLikeEcho(CANARY, 'READY')).toBe(false);
    expect(looksLikeEcho(CANARY, 'Ready.')).toBe(false);
  });
});

describe('isPlausibleExpansion', () => {
  it('accepts a normal expansion', () => {
    expect(isPlausibleExpansion('water cold please', 'I would like some cold water, please.')).toBe(true);
  });

  it('rejects the echo that started all this', () => {
    expect(
      isPlausibleExpansion(
        'apple juice',
        'On-device model is not available in Chromium, this API is just echoing back the input: apple juice',
      ),
    ).toBe(false);
  });

  it('rejects an empty response rather than blanking the user’s text', () => {
    expect(isPlausibleExpansion('water', '')).toBe(false);
    expect(isPlausibleExpansion('water', '   ')).toBe(false);
  });

  it('rejects a model that starts explaining itself', () => {
    const essay = 'Here is my response: '.padEnd(500, 'x');
    expect(isPlausibleExpansion('water', essay)).toBe(false);
  });

  it('allows a short input to become a properly formed sentence', () => {
    // Ten times a three-character input is still shorter than a real sentence,
    // so the floor matters as much as the ceiling.
    expect(isPlausibleExpansion('tea', 'I would like a cup of tea, please.')).toBe(true);
  });
});
