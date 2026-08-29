'use client';

import dynamic from 'next/dynamic';
import type { ChatGPTIdentity } from '@/auth/chatgpt';

const ClientAacApp = dynamic(() => import('./aac-app').then((module) => module.AacApp), {
  ssr: false,
  loading: () => null,
});

export function ClientOnlyAac({ identity }: { identity: ChatGPTIdentity | null }) {
  return <ClientAacApp identity={identity} />;
}
