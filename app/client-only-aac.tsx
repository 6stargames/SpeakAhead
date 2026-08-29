'use client';

import dynamic from 'next/dynamic';
import type { ChatGPTIdentity } from '@/auth/chatgpt';

const ClientAacApp = dynamic(() => import('./aac-app').then((module) => module.AacApp), {
  ssr: false,
  loading: () => (
    <main className="app-loading" aria-live="polite">
      <span className="app-loading__mark" aria-hidden="true">✦</span>
      <span>Loading SpeakAhead…</span>
    </main>
  ),
});

export function ClientOnlyAac({ identity }: { identity: ChatGPTIdentity | null }) {
  return <ClientAacApp identity={identity} />;
}
