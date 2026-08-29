import type { JSX } from 'react';
import type { ChatGPTIdentity } from '@/auth/chatgpt';

/** Sites authentication overlaid inside the otherwise untouched ribbon. */
export function ChatGPTAuthButton({
  identity,
}: {
  identity: ChatGPTIdentity | null;
}): JSX.Element | null {
  if (!identity) return null;

  if ('signInPath' in identity) {
    return (
      <a
        className="chatgpt-auth-overlay"
        href={identity.signInPath}
        target="_top"
        aria-label="Sign in with ChatGPT"
      >
        <span className="chatgpt-auth-overlay__mark" aria-hidden="true">✦</span>
        <span>ChatGPT sign in</span>
      </a>
    );
  }

  return (
    <a
      className="chatgpt-auth-overlay chatgpt-auth-overlay--signed-in"
      href={identity.signOutPath}
      target="_top"
      title={`${identity.email} · Sign out`}
      aria-label={`Signed in with ChatGPT as ${identity.displayName}. Sign out`}
    >
      <span className="chatgpt-auth-overlay__mark" aria-hidden="true">✓</span>
      <span className="chatgpt-auth-overlay__name">{identity.displayName}</span>
    </a>
  );
}
