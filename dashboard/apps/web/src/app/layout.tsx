import type { Metadata } from 'next';
import { Outfit, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { WebSocketProvider } from '@/contexts/websocket-context';
import { ProjectProvider } from '@/contexts/project-context';
import { TopNav } from '@/components/layout/top-nav';
import { ForgeEmbers } from '@/components/layout/forge-embers';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
});

export const metadata: Metadata = {
  title: 'Vǫlundr — The Forge',
  description: 'Autonomous Agent Framework',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${outfit.variable} ${jetbrains.variable}`}>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#0a0e17] text-[#c5d0e6] font-outfit antialiased min-h-screen">
        <div className="grid-bg" />
        <ForgeEmbers />
        <ProjectProvider>
          <WebSocketProvider>
            <TopNav />
            <main className="relative z-10 pt-20">
              {children}
            </main>
          </WebSocketProvider>
        </ProjectProvider>
      </body>
    </html>
  );
}
