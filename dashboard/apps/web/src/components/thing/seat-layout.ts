/**
 * Seat layout for The Thing campfire scene.
 *
 * Campfire is anchored at (50%, 65%) of the viewport.
 * Seat 0 is the conductor position — center, directly above the fire (reserved for Volundr).
 * Other seats fan out left and right in pairs, progressively further from center.
 *
 * Seat index reference:
 *   0     — conductor (center, above fire) — Volundr
 *   1, 2  — inner pair (close to fire, left/right)
 *   3, 4  — mid pair (wider spread)
 *   5, 6  — outer pair (far left/right)
 *   7     — anvil position (far right)
 */

export interface SeatPosition {
  x: number;       // percentage of viewport width
  y: number;       // percentage of viewport height
  side: 'left' | 'right';  // nearest screen edge (walk-in direction)
}

// Campfire anchor
const FIRE_X = 50;
const FIRE_Y = 55;

// Seat layout: team-lead centered above fire, others in a smile-shaped arc below.
//
//   [6]                        [5]  ← outer pair, highest (smile tips)
//      [4]                  [3]     ← mid pair
//         [2]            [1]        ← inner pair, closest to fire (smile bottom)
//                  🔥
//              [team-lead]          ← seat 0, below fire center
//                [7]                ← reserve
//
export const SEATS: SeatPosition[] = [
  // Index 0 — conductor (Vǫlundr) — center, well above fire
  { x: FIRE_X,      y: FIRE_Y - 28, side: 'left'  },

  // Index 1 — inner right (lowest point of smile, below fire)
  { x: FIRE_X + 10, y: FIRE_Y + 14, side: 'right' },

  // Index 2 — inner left
  { x: FIRE_X - 10, y: FIRE_Y + 14, side: 'left'  },

  // Index 3 — mid right (wider, higher — smile curving up)
  { x: FIRE_X + 22, y: FIRE_Y + 10, side: 'right' },

  // Index 4 — mid left
  { x: FIRE_X - 22, y: FIRE_Y + 10, side: 'left'  },

  // Index 5 — outer right (widest, highest — smile tips)
  { x: FIRE_X + 32, y: FIRE_Y + 4,  side: 'right' },

  // Index 6 — outer left
  { x: FIRE_X - 32, y: FIRE_Y + 4,  side: 'left'  },

  // Index 7 — reserve (bottom center)
  { x: FIRE_X,      y: FIRE_Y + 20, side: 'left'  },
];

/**
 * Simple djb2-style hash that produces a non-negative integer.
 */
export function hashCode(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

/**
 * Assign a seat index to an agent.
 *
 * Volundr always gets seat 0 (conductor position).
 * Other agents get hash-based assignment across seats 1-6.
 *
 * @param agentId       Stable identifier for the agent.
 * @param occupiedSeats Set of seat indices already taken.
 * @param agentType     Agent type — 'volundr' gets seat 0.
 * @returns             A seat index in [0, SEATS.length), or -1 if all seats are full.
 */
export function assignSeat(agentId: string, occupiedSeats: Set<number>, agentType?: string): number {
  const total = SEATS.length;

  if (occupiedSeats.size >= total) {
    return -1;
  }

  // Vǫlundr / team-lead always gets the conductor seat
  if ((agentType === 'volundr' || agentType === 'team-lead') && !occupiedSeats.has(0)) {
    return 0;
  }

  // Other agents: hash into seats 1-6 (skip 0=conductor, 7=anvil)
  const assignableSeats = [1, 2, 3, 4, 5, 6];
  const preferred = hashCode(agentId) % assignableSeats.length;

  for (let offset = 0; offset < assignableSeats.length; offset++) {
    const candidate = assignableSeats[(preferred + offset) % assignableSeats.length];
    if (!occupiedSeats.has(candidate)) {
      return candidate;
    }
  }

  // Fallback: try any seat
  for (let i = 0; i < total; i++) {
    if (!occupiedSeats.has(i)) return i;
  }

  return -1;
}
