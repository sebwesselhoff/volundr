'use client';

import { useState } from 'react';

// ─── Simple djb2-style hash (same algorithm as seat-layout.ts) ───────────────

function hashCode(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

// ─── Stone-tablet polygon variants ──────────────────────────────────────────
// Three slightly irregular polygons that read as chiselled stone tablets.
// Each point is expressed as "x% y%" suitable for clip-path: polygon().

const TABLET_SHAPES = [
  // Variant 0 — broad, slightly uneven top-left corner
  'polygon(3% 0%, 98% 1%, 100% 4%, 99% 96%, 97% 100%, 2% 99%, 0% 97%, 1% 3%)',
  // Variant 1 — slight rightward lean, chipped bottom-right
  'polygon(1% 2%, 97% 0%, 100% 3%, 99% 95%, 96% 100%, 3% 98%, 0% 96%, 0% 2%)',
  // Variant 2 — flatter top, more pronounced bottom-left nick
  'polygon(2% 0%, 99% 1%, 100% 5%, 98% 97%, 95% 100%, 4% 99%, 1% 96%, 0% 4%)',
] as const;

// ─── Props ───────────────────────────────────────────────────────────────────

export interface SpeechBubbleProps {
  text: string;
  fromAgent: string;
  x: number;       // percentage position (agent's x)
  y: number;       // percentage position (above agent's head)
  color: string;   // agent's role color
  entering?: boolean;
  exiting?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SpeechBubble({
  text,
  fromAgent,
  x,
  y,
  color,
  entering = false,
  exiting = false,
}: SpeechBubbleProps) {
  const [expanded, setExpanded] = useState(false);

  // Pick a stable tablet shape by hashing the agent name
  const shapeIndex = hashCode(fromAgent) % TABLET_SHAPES.length;
  const clipPath = TABLET_SHAPES[shapeIndex];

  // Collapsed preview: first 60 characters
  const isLong = text.length > 60;
  const displayText = expanded || !isLong ? text : text.slice(0, 60) + '...';

  // ── Animation state ──────────────────────────────────────────────────────
  // Entry: text reveal via clip-path inset (left-to-right "etching in")
  // Exit:  fade + blur ("inscription crumbles")

  const wrapperAnimation: React.CSSProperties = exiting
    ? {
        opacity: 0,
        filter: 'blur(3px)',
        transition: 'opacity 500ms ease-out, filter 500ms ease-out',
      }
    : {
        opacity: 1,
        filter: 'none',
        transition: 'opacity 500ms ease-out, filter 500ms ease-out',
      };

  // The text reveal clip-path is applied to the inner text layer only.
  // Background appears immediately; text etches in over 200ms.
  const textRevealStyle: React.CSSProperties = entering
    ? {
        clipPath: 'inset(0 0 0 0)',
        animation: 'speechBubbleEtch 200ms ease-out both',
      }
    : {
        clipPath: 'inset(0 0 0 0)',
      };

  return (
    <>
      {/* Keyframe injection — renders once per mounted bubble */}
      <style>{`
        @keyframes speechBubbleEtch {
          from { clip-path: inset(0 100% 0 0); }
          to   { clip-path: inset(0 0% 0 0); }
        }
      `}</style>

      {/* Outer positioner — centered on x, placed above y */}
      <div
        style={{
          position: 'absolute',
          left: `${x}%`,
          top: `${y}%`,
          transform: 'translate(-50%, -100%)',
          zIndex: 20,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          pointerEvents: 'auto',
          ...wrapperAnimation,
        }}
      >
        {/* Stone tablet bubble */}
        <div
          onMouseEnter={() => isLong && setExpanded(true)}
          onMouseLeave={() => setExpanded(false)}
          style={{
            position: 'relative',
            maxWidth: 280,
            cursor: isLong ? 'pointer' : 'default',
          }}
        >
          {/* Background layer (appears instantly — no clip-path restriction) */}
          <div
            style={{
              clipPath,
              background: 'linear-gradient(135deg, rgba(26,34,51,0.92), rgba(15,20,32,0.95))',
              border: '1px solid rgba(232,168,56,0.12)',
              borderRadius: 2,
              padding: '0.55rem 0.75rem 0.5rem',
            }}
          >
            {/* Agent name — etches in with the text */}
            <div style={textRevealStyle}>
              <div
                style={{
                  fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                  fontSize: '0.65rem',
                  fontWeight: 500,
                  color,
                  letterSpacing: '0.04em',
                  marginBottom: '0.3rem',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {fromAgent}
              </div>

              {/* Message text */}
              <div
                style={{
                  fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                  fontSize: '0.72rem',
                  color: '#c5d0e6',
                  letterSpacing: '0.02em',
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: expanded ? 200 : undefined,
                  overflowY: expanded ? 'auto' : 'visible',
                  transition: 'max-height 150ms ease',
                }}
              >
                {displayText}
              </div>
            </div>
          </div>
        </div>

        {/* Thread pointer — thin vertical line from bubble base to speaker */}
        <div
          style={{
            width: 1,
            height: 15,
            background: 'rgba(232,168,56,0.2)',
            flexShrink: 0,
          }}
        />
      </div>
    </>
  );
}
