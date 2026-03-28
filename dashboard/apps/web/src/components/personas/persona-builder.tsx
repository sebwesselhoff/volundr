'use client';

import { useState, useCallback } from 'react';
import { apiFetch } from '@/lib/api-client';
import type { Persona } from '@vldr/shared';

const COMMON_ROLES = [
  'developer', 'architect', 'qa-engineer', 'devops-engineer',
  'designer', 'reviewer', 'researcher', 'content',
];

const TRAIT_CATALOG = [
  'thorough', 'fast', 'cautious', 'creative', 'methodical',
  'concise', 'verbose', 'security-focused', 'performance-focused',
  'accessible', 'pragmatic', 'systematic',
];

const MONO = 'var(--font-jetbrains), "JetBrains Mono", monospace';
const SANS = 'var(--font-outfit), Outfit, sans-serif';

interface Props {
  onCreated: (persona: Persona) => void;
  onCancel: () => void;
}

export function PersonaBuilder({ onCreated, onCancel }: Props) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>('developer');
  const [expertiseInput, setExpertiseInput] = useState('');
  const [expertise, setExpertise] = useState<string[]>([]);
  const [traits, setTraits] = useState<string[]>([]);
  const [style, setStyle] = useState('');
  const [modelPref, setModelPref] = useState('sonnet-4');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-generate ID from name
  const updateName = useCallback((val: string) => {
    setName(val);
    if (!id || id === nameToId(name)) {
      setId(nameToId(val));
    }
  }, [id, name]);

  function nameToId(n: string): string {
    return n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  }

  function addExpertise() {
    const tag = expertiseInput.trim().toLowerCase();
    if (tag && !expertise.includes(tag)) {
      setExpertise(prev => [...prev, tag]);
    }
    setExpertiseInput('');
  }

  function removeExpertise(tag: string) {
    setExpertise(prev => prev.filter(t => t !== tag));
  }

  function toggleTrait(trait: string) {
    setTraits(prev =>
      prev.includes(trait) ? prev.filter(t => t !== trait) : [...prev, trait]
    );
  }

  async function handleSave() {
    if (!id || !name || !role) {
      setError('Name and role are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const persona = await apiFetch<Persona>('/api/personas', {
        method: 'POST',
        body: JSON.stringify({
          id,
          name,
          role,
          expertise,
          style: style || undefined,
          modelPreference: modelPref || undefined,
          source: 'user',
        }),
      });
      onCreated(persona);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create persona');
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: '0.8rem',
    color: '#c5d0e6',
    background: 'rgba(10,14,23,0.6)',
    border: '1px solid rgba(36,48,68,0.6)',
    borderRadius: 4,
    padding: '0.5rem 0.75rem',
    width: '100%',
    outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: '0.65rem',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '0.4rem',
    display: 'block',
  };

  return (
    <div className="kindle kindle-1">
      <div className="flex items-center justify-between mb-6">
        <h2 style={{ fontFamily: SANS, fontSize: '1.1rem', fontWeight: 600, color: '#e8a838', margin: 0 }}>
          Forge New Persona
        </h2>
        <button
          onClick={onCancel}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: MONO, fontSize: '0.7rem', color: '#6b7280',
          }}
        >
          Cancel
        </button>
      </div>

      {error && (
        <div style={{
          fontFamily: MONO, fontSize: '0.75rem', color: '#ef4444',
          background: 'rgba(239,68,68,0.1)', borderRadius: 4,
          padding: '0.5rem 0.75rem', marginBottom: '1rem',
        }}>
          {error}
        </div>
      )}

      {/* Name */}
      <div className="mb-4">
        <label style={labelStyle}>Name</label>
        <input
          type="text"
          value={name}
          onChange={e => updateName(e.target.value)}
          placeholder="e.g. Freya Ironcode"
          style={inputStyle}
        />
      </div>

      {/* ID (auto-generated, editable) */}
      <div className="mb-4">
        <label style={labelStyle}>ID (auto-generated)</label>
        <input
          type="text"
          value={id}
          onChange={e => setId(e.target.value)}
          placeholder="auto-generated-from-name"
          style={{ ...inputStyle, color: '#8899b3', fontSize: '0.72rem' }}
        />
      </div>

      {/* Role — dropdown with common roles + custom input */}
      <div className="mb-4">
        <label style={labelStyle}>Role</label>
        <div className="flex gap-2">
          <select
            value={COMMON_ROLES.includes(role) ? role : '__custom__'}
            onChange={e => {
              if (e.target.value !== '__custom__') setRole(e.target.value);
              else setRole('');
            }}
            style={{ ...inputStyle, cursor: 'pointer', flex: 1 }}
          >
            {COMMON_ROLES.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
            <option value="__custom__">Custom role...</option>
          </select>
          {!COMMON_ROLES.includes(role) && (
            <input
              type="text"
              value={role}
              onChange={e => setRole(e.target.value)}
              placeholder="e.g. data-scientist"
              style={{ ...inputStyle, flex: 1 }}
            />
          )}
        </div>
      </div>

      {/* Expertise tags */}
      <div className="mb-4">
        <label style={labelStyle}>Expertise Signals (for stack matching)</label>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={expertiseInput}
            onChange={e => setExpertiseInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExpertise(); } }}
            placeholder="Type a keyword and press Enter"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={addExpertise}
            style={{
              fontFamily: MONO, fontSize: '0.7rem', color: '#e8a838',
              background: 'rgba(232,168,56,0.1)', border: '1px solid rgba(232,168,56,0.3)',
              borderRadius: 4, padding: '0.5rem 0.75rem', cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            + Add
          </button>
        </div>
        {expertise.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {expertise.map(tag => (
              <span
                key={tag}
                className="text-[0.7rem] px-2 py-0.5 rounded flex items-center gap-1"
                style={{
                  fontFamily: MONO,
                  background: 'rgba(59,130,246,0.1)',
                  color: '#3b82f6',
                  border: '1px solid rgba(59,130,246,0.3)',
                }}
              >
                {tag}
                <button
                  onClick={() => removeExpertise(tag)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#3b82f6', fontSize: '0.8rem', padding: 0, lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Default traits */}
      <div className="mb-4">
        <label style={labelStyle}>Default Traits</label>
        <div className="flex flex-wrap gap-1.5">
          {TRAIT_CATALOG.map(trait => {
            const active = traits.includes(trait);
            return (
              <button
                key={trait}
                onClick={() => toggleTrait(trait)}
                style={{
                  fontFamily: MONO, fontSize: '0.68rem',
                  padding: '0.3rem 0.6rem', borderRadius: 4, cursor: 'pointer',
                  border: `1px solid ${active ? 'rgba(34,197,94,0.5)' : 'rgba(36,48,68,0.6)'}`,
                  background: active ? 'rgba(34,197,94,0.15)' : 'transparent',
                  color: active ? '#22c55e' : '#8899b3',
                }}
              >
                {trait}
              </button>
            );
          })}
        </div>
      </div>

      {/* Style */}
      <div className="mb-4">
        <label style={labelStyle}>Style (optional — personality / approach)</label>
        <textarea
          value={style}
          onChange={e => setStyle(e.target.value)}
          placeholder="e.g. Methodical, prefers small incremental changes, always writes tests first"
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>

      {/* Model preference */}
      <div className="mb-6">
        <label style={labelStyle}>Model Preference</label>
        <select
          value={modelPref}
          onChange={e => setModelPref(e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          <option value="opus-4">Opus 4 (most capable, highest cost)</option>
          <option value="sonnet-4">Sonnet 4 (balanced, default)</option>
          <option value="haiku-4">Haiku 4 (fast, lowest cost)</option>
        </select>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving || !name || !id}
        style={{
          fontFamily: MONO, fontSize: '0.8rem', fontWeight: 600,
          color: '#0a0e17', width: '100%',
          background: saving ? '#6b7280' : 'linear-gradient(135deg, #e8a838, #d4941a)',
          border: 'none', borderRadius: 6,
          padding: '0.75rem', cursor: saving ? 'wait' : 'pointer',
          letterSpacing: '0.04em',
        }}
      >
        {saving ? 'Forging...' : 'Seal Persona'}
      </button>

      <p style={{
        fontFamily: MONO, fontSize: '0.62rem', color: '#6b7280',
        marginTop: '0.75rem', textAlign: 'center',
      }}>
        User-created personas override built-in seeds with the same ID.
      </p>
    </div>
  );
}
