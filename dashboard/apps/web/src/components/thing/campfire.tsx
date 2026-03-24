'use client';

export interface CampfireProps {
  phase: 'empty' | 'igniting' | 'active' | 'disbanding' | 'embers';
  agentCount: number;
}

// Scale fire intensity by agent count
function fireScale(agentCount: number): number {
  if (agentCount <= 1) return 0.8;
  if (agentCount <= 2) return 0.9;
  if (agentCount <= 3) return 1.0;
  if (agentCount <= 5) return 1.1;
  return 1.2; // 6+
}

// Deterministic pseudo-random for SSR stability
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

interface EmberConfig {
  left: number;
  delay: number;
  duration: number;
  size: number;
  color: string;
  drift: number; // horizontal drift px
}

const EMBER_COLORS = ['#e85a1a', '#e8a838', '#f5c542', '#e85a1a', '#e8a838', '#f5c542', '#e85a1a', '#e8a838'];

const embers: EmberConfig[] = Array.from({ length: 8 }, (_, i) => ({
  left:     -18 + seededRandom(i * 13 + 1) * 36,   // -18 to +18 px around center
  delay:    -(seededRandom(i * 13 + 2) * 5),        // stagger start
  duration: 2.5 + seededRandom(i * 13 + 3) * 2,    // 2.5–4.5s
  size:     2 + Math.round(seededRandom(i * 13 + 4) * 2), // 2–4px
  color:    EMBER_COLORS[i],
  drift:    -8 + seededRandom(i * 13 + 5) * 16,    // -8 to +8 px horizontal drift
}));

export function Campfire({ phase, agentCount }: CampfireProps) {
  const scale = fireScale(agentCount);

  const isEmpty      = phase === 'empty';
  const isIgniting   = phase === 'igniting';
  const isActive     = phase === 'active';
  const isDisbanding = phase === 'disbanding';
  const isEmbers     = phase === 'embers';

  // Fire sprites — active sprite shown igniting/active/disbanding, embers sprite otherwise
  const activeFireOpacity =
    isIgniting   ? 1 :
    isActive     ? 1 :
    isDisbanding ? 1 :
    /* empty/embers */ 0;

  const embersFireOpacity = activeFireOpacity === 0 ? 1 : 0;

  // Glow halo
  const glowVisible  = isIgniting || isActive || isDisbanding || isEmbers;
  const glowIsEmbers = isEmbers;
  const glowOpacity  =
    isEmpty      ? 0 :
    isIgniting   ? 0.85 :
    isActive     ? 1 :
    isDisbanding ? 0.4 :
    /* embers */   0.5;

  // Glow box-shadow definition
  const glowActiveBoxShadow =
    '0 0 60px 30px rgba(232,160,40,0.22), 0 0 130px 65px rgba(212,88,26,0.10)';
  const glowEmbersBoxShadow =
    '0 0 30px 14px rgba(180,50,20,0.18), 0 0 70px 30px rgba(140,30,10,0.08)';
  const currentGlowShadow = glowIsEmbers ? glowEmbersBoxShadow : glowActiveBoxShadow;

  // Ember particles — only during igniting / active
  const showEmberParticles = isIgniting || isActive;

  // Scale applied to the sprite container
  const spriteContainerScale = isDisbanding ? scale * 0.65 : scale;

  // Smoke wisps — empty and embers phases
  const showSmoke = isEmpty || isEmbers;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'relative',
        width: 160,
        height: 160,
        flexShrink: 0,
      }}
    >
      {/* ── Inline keyframes ─────────────────────────────────────────────── */}
      <style>{`
        @keyframes cf-glow-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.72; }
        }
        @keyframes cf-glow-pulse-embers {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.55; }
        }
        @keyframes cf-ember-rise {
          0%   { transform: translateY(0)   translateX(0)   scale(1);    opacity: 0; }
          10%  { opacity: 1; }
          60%  { opacity: 0.7; }
          100% { transform: translateY(-90px) translateX(var(--drift)) scale(0); opacity: 0; }
        }
        @keyframes cf-smoke-sway {
          0%   { transform: translateX(0)   scaleX(1);    opacity: 0; }
          15%  { opacity: 0.35; }
          50%  { transform: translateX(4px)  scaleX(0.8);  opacity: 0.22; }
          85%  { opacity: 0.12; }
          100% { transform: translateX(-3px) scaleX(1.1);  opacity: 0; }
        }
        @keyframes cf-smoke-sway-r {
          0%   { transform: translateX(0)   scaleX(1);    opacity: 0; }
          15%  { opacity: 0.28; }
          50%  { transform: translateX(-4px) scaleX(0.8);  opacity: 0.18; }
          85%  { opacity: 0.09; }
          100% { transform: translateX(3px)  scaleX(1.1);  opacity: 0; }
        }
        @keyframes cf-ember-pulse {
          0%, 100% { transform: scale(1);    opacity: 0.55; }
          50%       { transform: scale(1.12); opacity: 0.85; }
        }
        @keyframes cf-sprite-disengage {
          0%   { transform: scale(1); }
          100% { transform: scale(0.65); }
        }
      `}</style>

      {/* ── Glow halo (box-shadow, beneath everything) ───────────────────── */}
      <div
        style={{
          position: 'absolute',
          bottom: 55,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          boxShadow: glowVisible ? currentGlowShadow : 'none',
          opacity: glowOpacity,
          animation: glowVisible
            ? glowIsEmbers
              ? 'cf-glow-pulse-embers 4s ease-in-out infinite'
              : 'cf-glow-pulse 3s ease-in-out infinite'
            : undefined,
          transition: 'opacity 2s ease, box-shadow 2s ease',
          pointerEvents: 'none',
        }}
      />

      {/* ── Ember base ellipse (always present, varies opacity/color) ─────── */}
      <div
        style={{
          position: 'absolute',
          bottom: 22,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 88,
          height: 24,
          borderRadius: '50%',
          background:
            isEmpty
              ? 'radial-gradient(ellipse at 50% 60%, rgba(100,80,60,0.18) 0%, rgba(70,60,50,0.08) 60%, transparent 100%)'
              : isEmbers
              ? 'radial-gradient(ellipse at 50% 60%, rgba(200,70,20,0.32) 0%, rgba(140,50,15,0.12) 50%, transparent 100%)'
              : 'radial-gradient(ellipse at 50% 60%, rgba(232,168,56,0.28) 0%, rgba(212,88,26,0.12) 50%, transparent 100%)',
          boxShadow:
            isEmbers
              ? '0 0 18px 6px rgba(200,70,20,0.10)'
              : isActive || isIgniting
              ? '0 0 14px 5px rgba(232,168,56,0.10)'
              : 'none',
          animation: 'cf-ember-pulse 5s ease-in-out infinite',
          opacity:
            isEmpty ? 0.5 :
            isIgniting ? 0.7 :
            isActive ? 0.8 :
            isDisbanding ? 0.5 :
            /* embers */ 0.75,
          transition: 'opacity 1.5s ease, background 1.5s ease, box-shadow 1.5s ease',
          pointerEvents: 'none',
        }}
      />

      {/* ── Fire sprites (layered, crossfaded) ───────────────────────────── */}
      {/*
          Both images always in DOM so CSS transition crossfades smoothly.
          mix-blend-mode: lighten removes the white sprite background
          against the dark scene.
      */}
      <div
        style={{
          position: 'absolute',
          bottom: 28,
          left: '50%',
          transform: `translateX(-50%) scale(${spriteContainerScale})`,
          transformOrigin: 'bottom center',
          transition: 'transform 1.5s ease',
          width: 200,
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        {/* Active fire sprite — mask-image fades out the dark ground shadow at bottom */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/sprites/fire-active.png"
          alt=""
          style={{
            position: 'absolute',
            bottom: 0,
            width: 200,
            height: 'auto',
            imageRendering: 'pixelated',
            mixBlendMode: 'lighten',
            opacity: activeFireOpacity,
            transition: 'opacity 1.5s ease',
            userSelect: 'none',
            maskImage: 'linear-gradient(to bottom, black 75%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 75%, transparent 100%)',
          }}
        />
        {/* Embers/extinguished fire sprite */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/sprites/fire-embers.png"
          alt=""
          style={{
            position: 'absolute',
            bottom: 0,
            width: 200,
            height: 'auto',
            imageRendering: 'pixelated',
            mixBlendMode: 'lighten',
            opacity: embersFireOpacity,
            transition: 'opacity 1.5s ease',
            userSelect: 'none',
            maskImage: 'linear-gradient(to bottom, black 75%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 75%, transparent 100%)',
          }}
        />
      </div>

      {/* ── Ember particles (CSS squares, no border-radius) ──────────────── */}
      {showEmberParticles &&
        embers.map((ember, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              bottom: 52,
              left: `calc(50% + ${ember.left}px)`,
              width: ember.size,
              height: ember.size,
              // No border-radius — squares as specified
              background: ember.color,
              boxShadow: `0 0 4px 1px ${ember.color}90`,
              // CSS custom property for drift used in keyframe
              ['--drift' as string]: `${ember.drift}px`,
              animation: `cf-ember-rise ${ember.duration}s ease-out ${ember.delay}s infinite`,
              pointerEvents: 'none',
            }}
          />
        ))}

      {/* ── Smoke wisps (empty and embers phases) ────────────────────────── */}
      {showSmoke && (
        <>
          {/* Main smoke column */}
          <div
            style={{
              position: 'absolute',
              bottom: 46,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 3,
              height: 75,
              borderRadius: 2,
              background:
                'linear-gradient(to top, rgba(140,140,140,0.45), rgba(120,120,120,0.20) 45%, rgba(100,100,100,0.07) 75%, transparent)',
              animation: 'cf-smoke-sway 6s ease-in-out infinite',
              transformOrigin: 'bottom center',
              filter: 'blur(1px)',
              pointerEvents: 'none',
            }}
          />
          {/* Left wisp */}
          <div
            style={{
              position: 'absolute',
              bottom: 48,
              left: 'calc(50% - 7px)',
              width: 2,
              height: 52,
              borderRadius: 2,
              background:
                'linear-gradient(to top, rgba(130,130,130,0.32), rgba(110,110,110,0.11) 55%, transparent)',
              animation: 'cf-smoke-sway 8s ease-in-out 1.5s infinite',
              transformOrigin: 'bottom center',
              filter: 'blur(1.5px)',
              pointerEvents: 'none',
            }}
          />
          {/* Right wisp */}
          <div
            style={{
              position: 'absolute',
              bottom: 47,
              left: 'calc(50% + 6px)',
              width: 2,
              height: 42,
              borderRadius: 2,
              background:
                'linear-gradient(to top, rgba(130,130,130,0.28), rgba(110,110,110,0.09) 55%, transparent)',
              animation: 'cf-smoke-sway-r 7s ease-in-out 3s infinite',
              transformOrigin: 'bottom center',
              filter: 'blur(1.5px)',
              pointerEvents: 'none',
            }}
          />
        </>
      )}
    </div>
  );
}
