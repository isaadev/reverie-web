import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'reverie',
  description: 'slowed · reverb · pitch — download any track',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
