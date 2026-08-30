import { describe, expect, it } from 'vitest';
import { themeImageCacheOwner, themeImageCacheScope } from '@/assist/themeImageSharing';

describe('shared themed image privacy', () => {
  it('shares permanent board choices and compact generic AI choices', () => {
    expect(themeImageCacheScope('I need help right now.')).toBe('shared');
    expect(themeImageCacheScope('pizza')).toBe('shared');
    expect(themeImageCacheScope('Could we try again?')).toBe('shared');
  });

  it('keeps identifying and personal-looking choices private', () => {
    expect(themeImageCacheScope('Please call Danny.')).toBe('private');
    expect(themeImageCacheScope('My address is 123 Main Street.')).toBe('private');
    expect(themeImageCacheScope('My doctor is Dr. Smith.')).toBe('private');
    expect(themeImageCacheScope('danny@example.com')).toBe('private');
  });

  it('uses one global owner for generic text and separate owners for private text', () => {
    expect(themeImageCacheOwner('user-a', 'pizza')).toBe('shared');
    expect(themeImageCacheOwner('user-b', 'pizza')).toBe('shared');
    expect(themeImageCacheOwner('user-a', 'Please call Danny.')).toBe('user:user-a');
    expect(themeImageCacheOwner('user-b', 'Please call Danny.')).toBe('user:user-b');
  });
});
