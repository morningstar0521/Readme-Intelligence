import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider, THEME_INIT_SCRIPT } from '@/lib/theme';
import { SettingsProvider } from '@/lib/settings';
import { Analytics } from '@vercel/analytics/next';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });
const isVercelDeployment = process.env.VERCEL === '1';

export const metadata: Metadata = {
  title: 'README Intelligence Viewer',
  description: 'Render any GitHub README and extract commands, environment variables, setup steps, tech stack and a documentation health score.',
  robots: { index: true, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0B0D10' },
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Per-request nonce from middleware.ts, required by the Content-Security-Policy.
  const nonce = headers().get('x-nonce') ?? undefined;
  return (
    <html lang="en" data-theme="dark" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <ThemeProvider>
          <SettingsProvider>{children}</SettingsProvider>
        </ThemeProvider>
        {isVercelDeployment && <Analytics />}
      </body>
    </html>
  );
}
