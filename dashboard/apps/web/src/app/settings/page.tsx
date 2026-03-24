'use client';

import { useProject } from '@/contexts/project-context';
import { apiFetch } from '@/lib/api-client';
import { useCallback } from 'react';

// ─── Gate level config ──────────────────────────────────────────────────────

const GATE_LEVELS = [
  { value: 1, label: 'Level 1', description: 'Auto-approve all' },
  { value: 2, label: 'Level 2', description: 'Pause at cost spikes' },
  { value: 3, label: 'Level 3', description: 'Pause before each spawn' },
  { value: 4, label: 'Level 4', description: 'Manual approval always' },
];

// ─── Section label ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: 'var(--font-outfit), Outfit, sans-serif',
        fontWeight: 500,
        fontSize: '0.7rem',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: '#8899b3',
        margin: '0 0 1rem',
      }}
    >
      {children}
    </p>
  );
}

// ─── Gate level selector ────────────────────────────────────────────────────

interface GateSelectorProps {
  current: number;
  onChange: (level: number) => void;
}

function GateSelector({ current, onChange }: GateSelectorProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {GATE_LEVELS.map(({ value, label, description }) => {
        const active = current === value;
        return (
          <button
            key={value}
            onClick={() => onChange(value)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '0.5rem 0',
              textAlign: 'left',
            }}
          >
            {/* Radio indicator */}
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                border: `1.5px solid ${active ? '#3b82f6' : '#243044'}`,
                background: active ? '#3b82f6' : 'transparent',
                flexShrink: 0,
                transition: 'border-color 0.15s, background 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {active && (
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: '#0a0e17',
                    flexShrink: 0,
                  }}
                />
              )}
            </span>

            {/* Label */}
            <span
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                fontWeight: active ? 500 : 400,
                fontSize: '0.85rem',
                color: active ? '#c5d0e6' : '#8899b3',
                transition: 'color 0.15s',
              }}
            >
              {label}
            </span>

            {/* Description */}
            <span
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                fontSize: '0.75rem',
                color: active ? '#8899b3' : '#4a5568',
                transition: 'color 0.15s',
              }}
            >
              — {description}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Project info row ───────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '1rem',
        padding: '0.4rem 0',
        borderBottom: '1px solid rgba(36,48,68,0.4)',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
          fontSize: '0.7rem',
          color: '#8899b3',
          minWidth: 90,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
          fontSize: '0.78rem',
          color: '#c5d0e6',
          wordBreak: 'break-all',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { project, refetch } = useProject();

  const handleGateChange = useCallback(
    async (level: number) => {
      if (!project) return;
      try {
        await apiFetch(`/api/projects/${project.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ reviewGateLevel: level }),
        });
        refetch();
      } catch (err) {
        console.error('[Settings] Failed to update gate level:', err);
      }
    },
    [project, refetch]
  );

  return (
    <div
      style={{
        maxWidth: 600,
        margin: '0 auto',
        padding: '2.5rem 1.5rem 4rem',
      }}
    >
      {/* ── Review Gate ──────────────────────────────────────────────────── */}
      <section className="kindle" style={{ marginBottom: '3rem' }}>
        <SectionLabel>Review Gate</SectionLabel>

        {!project ? (
          <p
            style={{
              fontFamily: 'var(--font-outfit), Outfit, sans-serif',
              fontSize: '0.85rem',
              color: '#4a5568',
              margin: 0,
            }}
          >
            Select a project to configure.
          </p>
        ) : (
          <GateSelector
            current={project.reviewGateLevel}
            onChange={handleGateChange}
          />
        )}
      </section>

      {/* ── Project ──────────────────────────────────────────────────────── */}
      {project && (
        <section className="kindle kindle-1">
          <SectionLabel>Project</SectionLabel>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <InfoRow label="name"   value={project.name} />
            <InfoRow label="id"     value={project.id} />
            <InfoRow label="path"   value={project.path} />
            <InfoRow label="phase"  value={project.phase} />
            <InfoRow label="status" value={project.status} />
          </div>
        </section>
      )}
    </div>
  );
}
