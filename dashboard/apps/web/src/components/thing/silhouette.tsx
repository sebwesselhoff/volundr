'use client';

/**
 * Silhouette — single agent pixel-art sprite for The Þing campfire scene.
 *
 * Role colors (for reference, passed in from parent):
 *   volundr:        '#e8a838'  gold
 *   developer:      '#3b82f6'  steel blue
 *   architect:      '#60a5fa'  ice
 *   qa-engineer:    '#10b981'  green
 *   devops-engineer:'#8b8d8f'  iron grey
 *   designer:       '#a78bfa'  purple
 *   reviewer:       '#c5d0e6'  neutral
 *   researcher:     '#06b6d4'  cyan
 */

export interface SilhouetteProps {
  type: string;
  name: string;
  status: 'seated' | 'entering' | 'leaving' | 'working' | 'speaking';
  color: string;
  x: number;
  y: number;
  side?: 'left' | 'right';
}

// ---------------------------------------------------------------------------
// Sprite mapping
// ---------------------------------------------------------------------------

const SPRITE_MAP: Record<string, string> = {
  'volundr':          '/sprites/volundr-front.webp',
  'developer':        '/sprites/developer-front.webp',
  'architect':        '/sprites/architect-front.webp',
  'qa-engineer':      '/sprites/qa-front.webp',
  'devops-engineer':  '/sprites/devops-front.webp',
  'designer':         '/sprites/designer-front.webp',
  'reviewer':         '/sprites/reviewer-front.webp',
  'researcher':       '/sprites/researcher-front.webp',
};

const FALLBACK_SPRITE = '/sprites/fallback-front.webp';

function getSpriteUrl(type: string): string {
  return SPRITE_MAP[type] ?? FALLBACK_SPRITE;
}

// ---------------------------------------------------------------------------
// Animation keyframes injected once into document <head>.
// ---------------------------------------------------------------------------

const ANIMATION_ID = 'silhouette-bob';
let animationInjected = false;

function ensureAnimation() {
  if (typeof document === 'undefined') return;
  if (animationInjected) return;
  animationInjected = true;

  const style = document.createElement('style');
  style.innerHTML = `
    @keyframes ${ANIMATION_ID} {
      0%   { transform: translateY(0px); }
      25%  { transform: translateY(-1px); }
      50%  { transform: translateY(-2px); }
      75%  { transform: translateY(-1px); }
      100% { transform: translateY(0px); }
    }
    @keyframes silhouette-speaking {
      0%   { transform: translateY(0px); }
      25%  { transform: translateY(-1px); }
      50%  { transform: translateY(-3px); }
      75%  { transform: translateY(-1px); }
      100% { transform: translateY(0px); }
    }
    @keyframes silhouette-name-in {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0px); }
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Silhouette({ type, name, status, color, x, y, side }: SilhouetteProps) {
  // Inject animation CSS on first render (client-only)
  if (typeof document !== 'undefined') {
    ensureAnimation();
  }

  const spriteUrl = getSpriteUrl(type);

  // Animation style based on status
  const isSpeaking = status === 'speaking';
  const animationStyle: React.CSSProperties =
    status === 'entering' || status === 'leaving'
      ? {}
      : {
          animation: isSpeaking
            ? 'silhouette-speaking 1.8s ease-in-out infinite'
            : `${ANIMATION_ID} 4s ease-in-out infinite`,
        };

  // Entrance / exit opacity
  const containerOpacity =
    status === 'entering' ? 0.4 :
    status === 'leaving'  ? 0.2 :
    1;

  return (
    <div
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        transform: 'translate(-50%, -100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        opacity: containerOpacity,
        transition: 'opacity 600ms ease',
        pointerEvents: 'none',
      }}
      aria-label={`${name} (${type})`}
    >
      {/* Animated sprite wrapper */}
      <div style={animationStyle}>
        <img
          src={spriteUrl}
          alt=""
          aria-hidden="true"
          style={{
            height: '90px',
            width: 'auto',
            imageRendering: 'pixelated',
            mixBlendMode: 'lighten',
            display: 'block',
            transform: side === 'right' ? 'scaleX(-1)' : undefined,
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>

      {/* Name label */}
      <span
        style={{
          fontFamily: 'var(--font-outfit), Outfit, sans-serif',
          fontSize: '0.7rem',
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color,
          marginTop: '0.4rem',
          whiteSpace: 'nowrap',
          animation: 'silhouette-name-in 400ms ease-out 300ms both',
        }}
      >
        {name}
      </span>
    </div>
  );
}
