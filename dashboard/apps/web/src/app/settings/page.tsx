'use client';

import { useState, useCallback } from 'react';
import type { Persona } from '@vldr/shared';
import { useProject } from '@/contexts/project-context';
import { useApiQuery } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api-client';

// ─── Gate level config ──────────────────────────────────────────────────────

const GATE_LEVELS = [
  { value: 1, label: 'Level 1', description: 'Auto-approve all' },
  { value: 2, label: 'Level 2', description: 'Pause at cost spikes' },
  { value: 3, label: 'Level 3', description: 'Pause before each spawn' },
  { value: 4, label: 'Level 4', description: 'Manual approval always' },
];

// ─── Pack manifests (read from bundled constants, no runtime FS access) ─────

interface PackInfo {
  name: string;
  version: string;
  description: string;
  alwaysLoad: boolean;
  agentTypes: string[];
  signals: string[];
}

const KNOWN_PACKS: PackInfo[] = [
  { name: 'core',           version: '1.0.0', description: 'Core agent types — always loaded',    alwaysLoad: true,  agentTypes: ['developer','architect','reviewer'],           signals: [] },
  { name: 'quality',        version: '1.0.0', description: 'Quality assurance agents',             alwaysLoad: true,  agentTypes: ['guardian','fixer'],                          signals: [] },
  { name: 'frontend',       version: '1.0.0', description: 'Frontend and design',                  alwaysLoad: false, agentTypes: ['designer'],                                  signals: ['frontend','ui','ux','css'] },
  { name: 'infrastructure', version: '1.0.0', description: 'Infrastructure and DevOps',            alwaysLoad: false, agentTypes: ['devops-engineer','content'],                  signals: ['infra','deploy','docker','ci'] },
  { name: 'testing',        version: '1.0.0', description: 'Test strategy and execution',          alwaysLoad: false, agentTypes: ['qa-engineer','tester'],                      signals: ['test','coverage','e2e'] },
  { name: 'research',       version: '1.0.0', description: 'External API research',                alwaysLoad: false, agentTypes: ['researcher'],                                signals: ['api','integration','webhook','oauth'] },
  { name: 'security',       version: '1.0.0', description: 'Security-focused traits',              alwaysLoad: false, agentTypes: [],                                            signals: ['security','auth','encryption'] },
  { name: 'roundtable',     version: '2.0.0', description: 'Blueprint review voices and Chaos Engine', alwaysLoad: false, agentTypes: ['roundtable','chaos-engine'],            signals: [] },
];

// ─── Persona role colours ────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  developer:         '#3b82f6',
  architect:         '#8b5cf6',
  'qa-engineer':     '#22c55e',
  'devops-engineer': '#f59e0b',
  designer:          '#ec4899',
  reviewer:          '#14b8a6',
  guardian:          '#ef4444',
  researcher:        '#6366f1',
  content:           '#f97316',
};

const STATUS_COLORS: Record<string, string> = {
  active:   '#22c55e',
  inactive: '#8899b3',
  retired:  '#6b7280',
};

// ─── Shared UI primitives ────────────────────────────────────────────────────

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

// ─── Gate level selector ─────────────────────────────────────────────────────

function GateSelector({ current, onChange }: { current: number; onChange: (level: number) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {GATE_LEVELS.map(({ value, label, description }) => {
        const active = current === value;
        return (
          <button
            key={value}
            onClick={() => onChange(value)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '0.5rem 0', textAlign: 'left',
            }}
          >
            <span
              style={{
                width: 14, height: 14, borderRadius: '50%',
                border: `1.5px solid ${active ? '#3b82f6' : '#243044'}`,
                background: active ? '#3b82f6' : 'transparent',
                flexShrink: 0, transition: 'border-color 0.15s, background 0.15s',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {active && (
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#0a0e17', flexShrink: 0 }} />
              )}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                fontWeight: active ? 500 : 400, fontSize: '0.85rem',
                color: active ? '#c5d0e6' : '#8899b3', transition: 'color 0.15s',
              }}
            >
              {label}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                fontSize: '0.75rem', color: active ? '#8899b3' : '#4a5568', transition: 'color 0.15s',
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

// ─── Economy toggle ──────────────────────────────────────────────────────────

function EconomyToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <button
        onClick={onToggle}
        aria-label={enabled ? 'Disable economy mode' : 'Enable economy mode'}
        style={{
          width: 40, height: 22, borderRadius: 11,
          background: enabled ? '#3b82f6' : '#1a2336',
          border: `1.5px solid ${enabled ? '#3b82f6' : '#243044'}`,
          cursor: 'pointer', position: 'relative',
          transition: 'background 0.2s, border-color 0.2s', flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute', top: 2,
            left: enabled ? 20 : 2,
            width: 14, height: 14, borderRadius: '50%',
            background: enabled ? '#fff' : '#4a5568',
            transition: 'left 0.2s, background 0.2s',
          }}
        />
      </button>
      <div>
        <span
          style={{
            fontFamily: 'var(--font-outfit), Outfit, sans-serif',
            fontSize: '0.85rem', fontWeight: 400,
            color: enabled ? '#c5d0e6' : '#8899b3',
          }}
        >
          Economy mode {enabled ? 'enabled' : 'disabled'}
        </span>
        <p
          style={{
            fontFamily: 'var(--font-outfit), Outfit, sans-serif',
            fontSize: '0.72rem', color: '#4a5568', margin: '0.15rem 0 0',
          }}
        >
          Prefer smaller models and skip optional agents to reduce cost.
        </p>
      </div>
    </div>
  );
}

// ─── Persona management ──────────────────────────────────────────────────────

function PersonaRow({
  persona,
  onRetire,
  onReactivate,
}: {
  persona: Persona;
  onRetire: (id: string) => void;
  onReactivate: (id: string) => void;
}) {
  const roleColor = ROLE_COLORS[persona.role] ?? '#8899b3';
  const statusColor = STATUS_COLORS[persona.status] ?? '#8899b3';
  const isRetired = persona.status === 'retired';

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.55rem 0',
        borderBottom: '1px solid rgba(36,48,68,0.35)',
        opacity: isRetired ? 0.5 : 1,
      }}
    >
      {/* Role dot */}
      <span
        style={{ width: 7, height: 7, borderRadius: '50%', background: roleColor, flexShrink: 0 }}
        title={persona.role}
      />

      {/* ID */}
      <span
        style={{
          fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
          fontSize: '0.72rem', color: '#8caed4', minWidth: 140, flexShrink: 0,
        }}
      >
        {persona.id}
      </span>

      {/* Name */}
      <span
        style={{
          fontFamily: 'var(--font-outfit), Outfit, sans-serif',
          fontSize: '0.80rem', color: '#c5d0e6', flex: 1, minWidth: 0,
        }}
      >
        {persona.name}
      </span>

      {/* Status */}
      <span
        style={{
          fontFamily: 'var(--font-outfit), Outfit, sans-serif',
          fontSize: '0.68rem', color: statusColor, minWidth: 52, textAlign: 'right', flexShrink: 0,
        }}
      >
        {persona.status}
      </span>

      {/* Action */}
      <button
        onClick={() => isRetired ? onReactivate(persona.id) : onRetire(persona.id)}
        style={{
          fontFamily: 'var(--font-outfit), Outfit, sans-serif',
          fontSize: '0.68rem', color: '#8899b3',
          background: 'transparent', border: '1px solid rgba(36,48,68,0.6)',
          borderRadius: 4, padding: '2px 8px', cursor: 'pointer', flexShrink: 0,
          transition: 'border-color 0.15s, color 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = isRetired ? '#3b82f6' : '#ef4444'; (e.currentTarget as HTMLButtonElement).style.color = isRetired ? '#3b82f6' : '#ef4444'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(36,48,68,0.6)'; (e.currentTarget as HTMLButtonElement).style.color = '#8899b3'; }}
      >
        {isRetired ? 'reactivate' : 'retire'}
      </button>
    </div>
  );
}

// ─── Pack browser ────────────────────────────────────────────────────────────

interface InstalledPack { pack: string; version: string; installedAt: string }

function PackBrowser({
  projectId,
  installed,
  onInstall,
}: {
  projectId: string;
  installed: InstalledPack[];
  onInstall: (pack: PackInfo) => void;
}) {
  const installedNames = new Set(installed.map(p => p.pack));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
      {KNOWN_PACKS.map(pack => {
        const isInstalled = installedNames.has(pack.name) || pack.alwaysLoad;
        return (
          <div
            key={pack.name}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.6rem 0',
              borderBottom: '1px solid rgba(36,48,68,0.35)',
            }}
          >
            {/* Always-load indicator */}
            <span
              style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: pack.alwaysLoad ? '#3b82f6' : isInstalled ? '#22c55e' : '#243044',
              }}
              title={pack.alwaysLoad ? 'always loaded' : isInstalled ? 'installed' : 'not installed'}
            />

            {/* Pack name */}
            <span
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '0.72rem', color: '#8caed4', minWidth: 110, flexShrink: 0,
              }}
            >
              {pack.name}
            </span>

            {/* Description */}
            <span
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                fontSize: '0.78rem', color: '#8899b3', flex: 1, minWidth: 0,
              }}
            >
              {pack.description}
            </span>

            {/* Agent types */}
            {pack.agentTypes.length > 0 && (
              <span
                style={{
                  fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                  fontSize: '0.65rem', color: '#4a5568', minWidth: 60, textAlign: 'right', flexShrink: 0,
                }}
              >
                {pack.agentTypes.join(', ')}
              </span>
            )}

            {/* Install button */}
            {!pack.alwaysLoad && (
              <button
                onClick={() => !isInstalled && onInstall(pack)}
                disabled={isInstalled}
                style={{
                  fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                  fontSize: '0.68rem',
                  color: isInstalled ? '#4a5568' : '#8899b3',
                  background: 'transparent',
                  border: `1px solid ${isInstalled ? 'rgba(36,48,68,0.3)' : 'rgba(36,48,68,0.6)'}`,
                  borderRadius: 4, padding: '2px 8px',
                  cursor: isInstalled ? 'default' : 'pointer', flexShrink: 0,
                  transition: 'border-color 0.15s, color 0.15s',
                }}
                onMouseEnter={e => { if (!isInstalled) { (e.currentTarget as HTMLButtonElement).style.borderColor = '#3b82f6'; (e.currentTarget as HTMLButtonElement).style.color = '#3b82f6'; } }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = isInstalled ? 'rgba(36,48,68,0.3)' : 'rgba(36,48,68,0.6)'; (e.currentTarget as HTMLButtonElement).style.color = isInstalled ? '#4a5568' : '#8899b3'; }}
              >
                {isInstalled ? 'installed' : 'install'}
              </button>
            )}
            {pack.alwaysLoad && (
              <span
                style={{
                  fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                  fontSize: '0.68rem', color: '#3b82f6',
                  padding: '2px 8px', flexShrink: 0,
                }}
              >
                built-in
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { project, refetch } = useProject();
  const [economyLoading, setEconomyLoading] = useState(false);
  const [personaFeedback, setPersonaFeedback] = useState<string | null>(null);
  const [packFeedback, setPackFeedback] = useState<string | null>(null);

  const { data: personas, refetch: refetchPersonas } = useApiQuery<Persona[]>('/api/personas');
  const { data: installedPacks, refetch: refetchPacks } = useApiQuery<{ pack: string; version: string; installedAt: string }[]>(
    project ? `/api/packs/installed/${project.id}` : null
  );

  // ── Gate level ──────────────────────────────────────────────────────────────

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

  // ── Economy toggle ──────────────────────────────────────────────────────────

  const handleEconomyToggle = useCallback(async () => {
    if (!project || economyLoading) return;
    setEconomyLoading(true);
    try {
      await apiFetch(`/api/projects/${project.id}/economy`, {
        method: 'POST',
        body: JSON.stringify({ toggle: true }),
      });
      refetch();
    } catch (err) {
      console.error('[Settings] Failed to toggle economy mode:', err);
    } finally {
      setEconomyLoading(false);
    }
  }, [project, economyLoading, refetch]);

  // ── Persona management ──────────────────────────────────────────────────────

  const handleRetire = useCallback(async (personaId: string) => {
    try {
      await apiFetch(`/api/personas/${personaId}/retire`, { method: 'POST' });
      setPersonaFeedback(`Persona ${personaId} retired.`);
      refetchPersonas();
      setTimeout(() => setPersonaFeedback(null), 3000);
    } catch (err) {
      console.error('[Settings] Failed to retire persona:', err);
    }
  }, [refetchPersonas]);

  const handleReactivate = useCallback(async (personaId: string) => {
    try {
      await apiFetch(`/api/personas/${personaId}/reactivate`, { method: 'POST' });
      setPersonaFeedback(`Persona ${personaId} reactivated.`);
      refetchPersonas();
      setTimeout(() => setPersonaFeedback(null), 3000);
    } catch (err) {
      console.error('[Settings] Failed to reactivate persona:', err);
    }
  }, [refetchPersonas]);

  // ── Pack install ────────────────────────────────────────────────────────────

  const handleInstallPack = useCallback(async (pack: PackInfo) => {
    if (!project) return;
    try {
      await apiFetch('/api/packs/install', {
        method: 'POST',
        body: JSON.stringify({ projectId: project.id, manifest: pack }),
      });
      setPackFeedback(`Pack '${pack.name}' installed.`);
      refetchPacks();
      setTimeout(() => setPackFeedback(null), 3000);
    } catch (err) {
      console.error('[Settings] Failed to install pack:', err);
    }
  }, [project, refetchPacks]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      style={{ maxWidth: 640, margin: '0 auto', padding: '2.5rem 1.5rem 4rem' }}
    >
      {/* ── Review Gate ────────────────────────────────────────────────────── */}
      <section className="kindle" style={{ marginBottom: '3rem' }}>
        <SectionLabel>Review Gate</SectionLabel>
        {!project ? (
          <p style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif', fontSize: '0.85rem', color: '#4a5568', margin: 0 }}>
            Select a project to configure.
          </p>
        ) : (
          <GateSelector current={project.reviewGateLevel} onChange={handleGateChange} />
        )}
      </section>

      {/* ── Economy Mode ───────────────────────────────────────────────────── */}
      {project && (
        <section className="kindle kindle-1" style={{ marginBottom: '3rem' }}>
          <SectionLabel>Economy Mode</SectionLabel>
          <EconomyToggle
            enabled={project.economyMode ?? false}
            onToggle={handleEconomyToggle}
          />
        </section>
      )}

      {/* ── Personas ───────────────────────────────────────────────────────── */}
      <section className="kindle kindle-2" style={{ marginBottom: '3rem' }}>
        <SectionLabel>Personas</SectionLabel>
        {personaFeedback && (
          <p
            style={{
              fontFamily: 'var(--font-outfit), Outfit, sans-serif',
              fontSize: '0.72rem', color: '#22c55e', margin: '0 0 0.75rem',
            }}
          >
            {personaFeedback}
          </p>
        )}
        {!personas || personas.length === 0 ? (
          <p style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif', fontSize: '0.82rem', color: '#4a5568', margin: 0 }}>
            No personas registered yet.
          </p>
        ) : (
          <div>
            {personas.map(persona => (
              <PersonaRow
                key={persona.id}
                persona={persona}
                onRetire={handleRetire}
                onReactivate={handleReactivate}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Pack Browser ───────────────────────────────────────────────────── */}
      {project && (
        <section className="kindle kindle-3" style={{ marginBottom: '3rem' }}>
          <SectionLabel>Pack Browser</SectionLabel>
          {packFeedback && (
            <p
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                fontSize: '0.72rem', color: '#22c55e', margin: '0 0 0.75rem',
              }}
            >
              {packFeedback}
            </p>
          )}
          <PackBrowser
            projectId={project.id}
            installed={installedPacks ?? []}
            onInstall={handleInstallPack}
          />
        </section>
      )}

      {/* ── Project Info ───────────────────────────────────────────────────── */}
      {project && (
        <section className="kindle kindle-4">
          <SectionLabel>Project</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <InfoRow label="name"    value={project.name} />
            <InfoRow label="id"      value={project.id} />
            <InfoRow label="path"    value={project.path} />
            <InfoRow label="phase"   value={project.phase} />
            <InfoRow label="status"  value={project.status} />
            <InfoRow label="economy" value={project.economyMode ? 'on' : 'off'} />
          </div>
        </section>
      )}
    </div>
  );
}
