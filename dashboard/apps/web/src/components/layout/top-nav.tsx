'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { useProject } from '@/contexts/project-context';
import type { Project } from '@vldr/shared';
import { apiFetch } from '@/lib/api-client';

const NAV_ITEMS = [
  { href: '/forge', label: 'The Forge' },
  { href: '/board', label: 'Board' },
  { href: '/events', label: 'Events' },
  { href: '/insights', label: 'Insights' },
  { href: '/personas', label: 'Personas' },
  { href: '/skills', label: 'Skills' },
  { href: '/compliance', label: 'Compliance' },
  { href: '/thing', label: 'The Þing' },
];

function ProjectSwitcher({ visible }: { visible: boolean }) {
  const { project, projectId, setProjectId } = useProject();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      apiFetch<Project[]>('/api/projects').then(setProjects).catch(() => {});
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const initials = project?.name
    ?.split(/\s+/)
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '..';

  return (
    <div ref={ref} className={`relative transition-opacity duration-500 delay-300 ${visible ? 'opacity-100' : 'opacity-0'}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[0.65rem] uppercase tracking-[0.1em] text-[#8899b3] hover:text-[#c5d0e6] transition-colors duration-200"
        title={project?.name || 'Select project'}
      >
        {initials}
      </button>

      {open && (
        <div className="absolute top-8 right-0 min-w-[200px] py-2 bg-[#0a0e17]/95 backdrop-blur-xl border border-[rgba(36,48,68,0.5)]"
             style={{ animation: 'kindle 300ms ease-out both' }}>
          {projects.map(p => (
            <button
              key={p.id}
              onClick={() => { setProjectId(p.id); setOpen(false); }}
              className={`block w-full text-left px-4 py-2 text-[0.8rem] transition-colors duration-150
                ${p.id === projectId
                  ? 'text-[#e8a838]'
                  : 'text-[#8899b3] hover:text-[#c5d0e6] hover:bg-[rgba(36,48,68,0.3)]'}`}
              style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif' }}
            >
              {p.name}
              <span className="block text-[0.65rem] text-[#8899b3] mt-0.5"
                    style={{ fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace' }}>
                {p.phase}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const isLanding = pathname === '/';
  const [visible, setVisible] = useState(false);

  // Delay visibility for entry animation
  useEffect(() => {
    if (!isLanding) {
      const t = setTimeout(() => setVisible(true), 100);
      return () => clearTimeout(t);
    }
    setVisible(false);
  }, [isLanding]);

  if (isLanding) return null;

  return (
    <nav className="fixed top-0 inset-x-0 z-50 flex flex-col items-center pt-5 pb-3
                     bg-[#0a0e17]/80 backdrop-blur-xl">
      {/* Centered wordmark */}
      <Link href="/" className={`font-cormorant font-bold text-2xl text-[#e8a838] tracking-wide hover:text-[#e8a838]
                                  transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'}`}
            style={{ textShadow: '0 0 20px rgba(232,168,56,0.15)' }}>
        Vǫlundr
      </Link>

      {/* Nav items centered below — staggered fade in */}
      <div className={`flex items-center gap-6 mt-2 transition-all duration-500 delay-200
                        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
        {NAV_ITEMS.map((item, i) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + '/');
          return (
            <span key={item.href} className="flex items-center gap-6">
              {i > 0 && <span className="text-[#243044] text-xs select-none">|</span>}
              <Link
                href={item.href}
                className={`text-xs uppercase tracking-[0.12em] transition-colors duration-200
                  ${active ? 'text-[#c5d0e6]' : 'text-[#8899b3] hover:text-[#c5d0e6]'}`}
              >
                {item.label}
              </Link>
            </span>
          );
        })}
      </div>

      {/* Right cluster — about, project switcher, settings */}
      <div className={`absolute top-5 right-8 flex items-center gap-5 transition-all duration-500 delay-300
                        ${visible ? 'opacity-100' : 'opacity-0'}`}>
        <Link href="/about" className="text-[#8899b3] hover:text-[#c5d0e6] transition-colors duration-200"
              title="About Volundr">
          <span className="text-[0.75rem] font-medium" style={{ fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace' }}>?</span>
        </Link>
        <ProjectSwitcher visible={visible} />
        <Link href="/settings" className="text-[#8899b3] hover:text-[#c5d0e6] transition-colors duration-200">
          <svg className="w-[16px] h-[16px]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </Link>
      </div>
    </nav>
  );
}
