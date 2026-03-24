'use client';

// Color per category (matches getEventColor in event-row)
const CATEGORY_COLOR: Record<string, string> = {
  Agents: '#3b82f6',   // Steel Blue
  Cards: '#e8a838',    // Gold
  Quality: '#e8a838',  // Gold
  Build: '#d4581a',    // Ember
  Session: '#60a5fa',  // Ice
  Other: '#60a5fa',    // Ice
};

// Map category name → member event type strings
export const CATEGORY_TYPES: Record<string, string[]> = {
  Agents: ['agent_spawned', 'agent_completed', 'agent_timeout'],
  Cards: ['card_status_changed'],
  Quality: ['quality_scored'],
  Build: ['build_gate_passed', 'build_gate_failed'],
  Session: ['session_started', 'session_ended', 'shutdown_started'],
  Other: [
    'retry_triggered',
    'branch_merged',
    'optimization_cycle',
    'milestone_reached',
    'intervention',
    'checkpoint_created',
    'error',
    'antipattern_found',
    'state_saved',
    'command_received',
    'command_acknowledged',
    'hierarchy_assessed',
  ],
};

export const CATEGORIES = Object.keys(CATEGORY_TYPES);

interface EventFiltersProps {
  activeTypes: Set<string>;
  onToggle: (type: string) => void;
}

export function EventFilters({ activeTypes, onToggle }: EventFiltersProps) {
  return (
    <div className="flex items-center gap-5 flex-wrap">
      {CATEGORIES.map(category => {
        const isActive = activeTypes.has(category);
        const dot = CATEGORY_COLOR[category];

        return (
          <button
            key={category}
            onClick={() => onToggle(category)}
            className="flex items-center gap-1.5 transition-opacity duration-150"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              opacity: isActive ? 1 : 0.5,
            }}
          >
            {/* Color dot */}
            <span
              className="rounded-full flex-shrink-0"
              style={{ width: 4, height: 4, background: dot }}
            />
            {/* Label */}
            <span
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                fontWeight: 400,
                fontSize: '0.8rem',
                color: isActive ? '#c5d0e6' : '#8899b3',
                transition: 'color 150ms ease',
              }}
            >
              {category}
            </span>
          </button>
        );
      })}
    </div>
  );
}
