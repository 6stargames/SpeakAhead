'use client';

import { App } from '@/App';
import type { ChatGPTIdentity } from '@/auth/chatgpt';
import { PwaRegistration } from '@/components/PwaRegistration';

export function AacApp({ identity }: { identity: ChatGPTIdentity | null }) {
  return (
    <>
      <App chatGPTIdentity={identity} />
      <PwaRegistration />
    </>
  );
}
