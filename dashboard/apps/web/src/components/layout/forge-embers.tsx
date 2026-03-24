'use client';

/**
 * ForgeEmbers — atmospheric ember particles drifting upward from the bottom.
 * Pure CSS animations driven by per-element custom properties.
 * All motion uses transform + opacity for GPU compositing.
 */

const EMBER_COUNT = 18;

// Deterministic pseudo-random from seed (no Math.random so SSR matches client)
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

interface EmberConfig {
  // Starting X position (% of viewport width)
  startX: number;
  // Horizontal drift amplitude (px)
  driftX: number;
  // Animation duration (seconds)
  duration: number;
  // Animation delay (seconds)
  delay: number;
  // Size (px)
  size: number;
  // Color
  color: string;
  // Glow color (with alpha)
  glow: string;
  // Which swirl keyframe variant (0-2)
  variant: number;
}

const COLORS = [
  { color: '#e8a838', glow: 'rgba(232,168,56,0.5)' },   // gold
  { color: '#e8a838', glow: 'rgba(232,168,56,0.4)' },   // gold (common)
  { color: '#d4581a', glow: 'rgba(212,88,26,0.5)' },    // ember orange
  { color: '#d4581a', glow: 'rgba(212,88,26,0.4)' },    // ember orange
  { color: '#f5c542', glow: 'rgba(245,197,66,0.6)' },   // bright spark (rare)
];

function generateEmber(index: number): EmberConfig {
  const r = (offset: number) => seededRandom(index * 17 + offset);

  const colorIdx = r(0) < 0.15 ? 4 : r(0) < 0.4 ? (r(1) < 0.5 ? 2 : 3) : (r(1) < 0.5 ? 0 : 1);
  const { color, glow } = COLORS[colorIdx];

  return {
    startX: 5 + r(2) * 90,
    driftX: 30 + r(3) * 80,
    duration: 8 + r(4) * 10,
    delay: r(5) * -18,
    size: 2 + r(6) * 2,
    color,
    glow,
    variant: Math.floor(r(7) * 3),
  };
}

const embers: EmberConfig[] = Array.from({ length: EMBER_COUNT }, (_, i) => generateEmber(i));

export function ForgeEmbers() {
  return (
    <div
      className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
      aria-hidden="true"
    >
      {embers.map((ember, i) => (
        <div
          key={i}
          className={`ember ember-path-${ember.variant}`}
          style={{
            '--start-x': `${ember.startX}vw`,
            '--drift': `${ember.driftX}px`,
            '--duration': `${ember.duration}s`,
            '--delay': `${ember.delay}s`,
            '--size': `${ember.size}px`,
            '--color': ember.color,
            '--glow': ember.glow,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
