import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import '@/styles.css';

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get('x-forwarded-host');
  const host = forwardedHost ?? requestHeaders.get('host') ?? 'localhost:3000';
  const safeHost = /^[a-z0-9.-]+(?::\d+)?$/i.test(host) ? host : 'localhost:3000';
  const protocol =
    requestHeaders.get('x-forwarded-proto') === 'http' || safeHost.startsWith('localhost')
      ? 'http'
      : 'https';
  const metadataBase = new URL(`${protocol}://${safeHost}`);

  return {
    metadataBase,
    title: 'SpeakAhead',
    description: 'Context-aware communication with on-device speech recognition and synthesis.',
    applicationName: 'SpeakAhead',
    manifest: '/manifest.webmanifest',
    icons: {
      icon: '/icons/icon-192.png',
      apple: '/icons/apple-touch-icon.png',
    },
    openGraph: {
      title: 'SpeakAhead',
      description: 'Context-aware communication with on-device speech recognition and synthesis.',
      type: 'website',
      images: [{ url: '/og.png', width: 1731, height: 909, alt: 'SpeakAhead communication interface' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'SpeakAhead',
      description: 'Context-aware communication with on-device speech recognition and synthesis.',
      images: ['/og.png'],
    },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light dark',
  themeColor: '#0b1120',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
