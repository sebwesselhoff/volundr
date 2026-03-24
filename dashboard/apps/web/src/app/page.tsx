'use client';

import { useRouter } from 'next/navigation';
import { useState, useCallback, useRef, useEffect } from 'react';

export default function LandingPage() {
  const router = useRouter();
  const [transitioning, setTransitioning] = useState(false);
  const wordmarkRef = useRef<HTMLHeadingElement>(null);
  const [targetStyle, setTargetStyle] = useState<React.CSSProperties>({});

  const handleEnter = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    if (!wordmarkRef.current) {
      router.push('/forge');
      return;
    }

    // Measure current wordmark position and size
    const rect = wordmarkRef.current.getBoundingClientRect();
    const currentCenterX = rect.left + rect.width / 2;
    const currentCenterY = rect.top + rect.height / 2;

    // Target: nav wordmark position — centered horizontally, ~28px from top, font-size ~1.5rem (24px)
    const targetCenterX = window.innerWidth / 2;
    const targetCenterY = 28; // pt-5 (20px) + half of text height (~16px)
    const targetFontSize = 24; // text-2xl
    const currentFontSize = wordmarkRef.current.getBoundingClientRect().height / 0.85; // compensate line-height

    const scale = targetFontSize / currentFontSize;
    const translateX = targetCenterX - currentCenterX;
    const translateY = targetCenterY - currentCenterY;

    setTargetStyle({
      transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
      transition: 'transform 800ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease 600ms',
    });

    setTransitioning(true);

    // Navigate after animation, with a tiny overlap so nav wordmark catches
    setTimeout(() => router.push('/forge'), 850);
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen -mt-20"
         style={{ background: 'radial-gradient(circle at 50% 45%, rgba(232,168,56,0.04) 0%, transparent 50%)' }}>

      {/* Wordmark container — animates to nav position */}
      <div className="relative" style={transitioning ? targetStyle : {}}>
        {/* Corner accents — fade out during transition */}
        <div className={`absolute -top-4 -left-6 w-8 h-8 border-t border-l border-[#e8a83840] transition-opacity duration-300 ${transitioning ? 'opacity-0' : ''}`} />
        <div className={`absolute -top-4 -right-6 w-8 h-8 border-t border-r border-[#e8a83840] transition-opacity duration-300 ${transitioning ? 'opacity-0' : ''}`} />
        <div className={`absolute -bottom-4 -left-6 w-8 h-8 border-b border-l border-[#e8a83840] transition-opacity duration-300 ${transitioning ? 'opacity-0' : ''}`} />
        <div className={`absolute -bottom-4 -right-6 w-8 h-8 border-b border-r border-[#e8a83840] transition-opacity duration-300 ${transitioning ? 'opacity-0' : ''}`} />

        {/* Horizontal rules */}
        <div className={`absolute -top-4 left-4 right-4 h-px bg-gradient-to-r from-transparent via-[#e8a83825] to-transparent transition-opacity duration-300 ${transitioning ? 'opacity-0' : ''}`} />
        <div className={`absolute -bottom-4 left-4 right-4 h-px bg-gradient-to-r from-transparent via-[#e8a83825] to-transparent transition-opacity duration-300 ${transitioning ? 'opacity-0' : ''}`} />

        <h1 ref={wordmarkRef}
            className="font-cormorant font-bold text-[#e8a838] px-12 py-2 kindle"
            style={{
              fontSize: 'clamp(7rem, 14vw, 13rem)',
              textShadow: '0 0 60px rgba(232,168,56,0.25), 0 0 120px rgba(232,168,56,0.1)',
              lineHeight: 0.85,
              letterSpacing: '-0.02em',
              animationDuration: '800ms',
            }}>
          Vǫlundr
        </h1>
      </div>

      {/* Subtitle */}
      <p className={`text-[#c5d0e6] uppercase tracking-[0.2em] font-light mt-8 kindle kindle-2 transition-all duration-400 ${transitioning ? 'opacity-0 translate-y-4' : ''}`}
         style={{ animationDuration: '600ms', fontSize: '0.85rem' }}>
        Autonomous Agent Framework
      </p>

      {/* Version */}
      <p className={`font-mono text-xs text-[#8899b3] mt-3 kindle kindle-3 transition-all duration-400 ${transitioning ? 'opacity-0 translate-y-4' : ''}`}
         style={{ animationDuration: '600ms' }}>
        v4.0
      </p>

      {/* Enter link */}
      <a href="/forge" onClick={handleEnter}
        className={`mt-16 text-[#8899b3] text-xs uppercase tracking-[0.2em] hover:text-[#e8a838] transition-all duration-400 cursor-pointer kindle kindle-4 ${transitioning ? 'opacity-0 translate-y-4' : ''}`}
        style={{ animationDuration: '600ms' }}>
        Enter The Forge →
      </a>
    </div>
  );
}
