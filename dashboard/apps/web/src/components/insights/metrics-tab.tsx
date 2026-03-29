'use client';

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area,
  BarChart, Bar,
  Cell,
} from 'recharts';
import { SCORE_SCALE, type MetricsResponse, type Persona, type Skill } from '@vldr/shared';
import { useApiQuery } from '@/hooks/use-api';
import { useProject } from '@/contexts/project-context';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatTime(ts: string): string {
  const iso = ts.includes('T') ? (ts.endsWith('Z') ? ts : ts + 'Z') : ts.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const AXIS_STYLE = {
  fontSize: '0.7rem',
  fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
  fill: '#8899b3',
};

const TITLE_STYLE: React.CSSProperties = {
  fontFamily: 'var(--font-outfit), Outfit, sans-serif',
  fontWeight: 500,
  fontSize: '0.8rem',
  color: '#8899b3',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: '1rem',
};

const EMPTY_STYLE: React.CSSProperties = {
  height: 180,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
  fontSize: '0.75rem',
  color: '#4a5568',
};

// Minimal tooltip — just text, no box
function MinimalTooltip({ active, payload, label, labelPrefix = '', formatter }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string | number;
  labelPrefix?: string;
  formatter?: (val: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'transparent',
      border: 'none',
      padding: 0,
      fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
      fontSize: '0.7rem',
      color: '#c5d0e6',
      pointerEvents: 'none',
    }}>
      {label !== undefined && (
        <p style={{ color: '#8899b3', marginBottom: 2 }}>{labelPrefix}{label}</p>
      )}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || '#c5d0e6' }}>
          {formatter ? formatter(p.value, p.name) : `${p.value}`}
        </p>
      ))}
    </div>
  );
}

// ── Quality Trend ─────────────────────────────────────────────────────────────

function QualityTrend({ data }: { data: MetricsResponse['qualityTrend'] }) {
  if (!data || data.length === 0) {
    return <div style={EMPTY_STYLE}>no quality data</div>;
  }

  const chartData = data.map((d, i) => ({
    index: i + 1,
    score: Math.round(d.score * 100) / 100,
    isLatest: i === data.length - 1,
  }));

  // Custom dot: Gold for latest, Steel Blue for rest
  const CustomDot = (props: {
    cx?: number;
    cy?: number;
    index?: number;
    payload?: { isLatest?: boolean };
  }) => {
    const { cx, cy, payload } = props;
    if (cx === undefined || cy === undefined) return null;
    const isLatest = payload?.isLatest;
    return (
      <circle
        cx={cx}
        cy={cy}
        r={isLatest ? 4 : 3}
        fill={isLatest ? '#e8a838' : '#3b82f6'}
        stroke="none"
      />
    );
  };

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="index"
          tick={{ ...AXIS_STYLE }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, SCORE_SCALE]}
          ticks={[0, 2, 4, 6, 8, SCORE_SCALE]}
          tick={{ ...AXIS_STYLE }}
          axisLine={false}
          tickLine={false}
          width={20}
        />
        <Tooltip
          content={<MinimalTooltip
            labelPrefix="Card #"
            formatter={(v) => `Quality ${v.toFixed(2)}`}
          />}
          cursor={{ stroke: 'rgba(59,130,246,0.15)', strokeWidth: 1 }}
        />
        <Line
          type="monotone"
          dataKey="score"
          stroke="#3b82f6"
          strokeWidth={1.5}
          dot={<CustomDot />}
          activeDot={{ r: 5, fill: '#e8a838', stroke: 'none' }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Card Velocity ─────────────────────────────────────────────────────────────

function CardVelocity({ cardsByStatus }: { cardsByStatus: MetricsResponse['cardsByStatus'] }) {
  const statuses = ['done', 'in_progress', 'review', 'testing', 'failed', 'backlog'];
  const labels: Record<string, string> = {
    done: 'Done', in_progress: 'In Prog.', review: 'Review',
    testing: 'Testing', failed: 'Failed', backlog: 'Backlog',
  };
  const colors: Record<string, string> = {
    done: '#22c55e', in_progress: '#3b82f6', review: '#a855f7',
    testing: '#f59e0b', failed: '#ef4444', backlog: '#4a5568',
  };

  const chartData = statuses
    .map((s) => ({ status: labels[s] ?? s, count: cardsByStatus[s] ?? 0, color: colors[s] ?? '#4a5568' }))
    .filter((d) => d.count > 0);

  if (chartData.length === 0) {
    return <div style={EMPTY_STYLE}>no card data</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="velGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="status"
          tick={{ ...AXIS_STYLE }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ ...AXIS_STYLE }}
          axisLine={false}
          tickLine={false}
          width={20}
        />
        <Tooltip
          content={<MinimalTooltip formatter={(v, _) => `${v} cards`} />}
          cursor={{ stroke: 'rgba(59,130,246,0.15)', strokeWidth: 1 }}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke="#3b82f6"
          strokeWidth={1.5}
          fill="url(#velGrad)"
          dot={{ fill: '#3b82f6', r: 3, stroke: 'none' }}
          activeDot={{ r: 4, fill: '#3b82f6', stroke: 'none' }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Token Usage ───────────────────────────────────────────────────────────────

function TokenUsage({ data }: { data: MetricsResponse['tokensOverTime'] }) {
  if (!data || data.length === 0) {
    return <div style={EMPTY_STYLE}>no token data</div>;
  }

  const chartData = data.map((d) => ({
    time: formatTime(d.timestamp),
    input: d.prompt,
    output: d.completion,
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="time"
          tick={{ ...AXIS_STYLE }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={formatTokens}
          tick={{ ...AXIS_STYLE }}
          axisLine={false}
          tickLine={false}
          width={32}
        />
        <Tooltip
          content={(props) => {
            if (!props.active || !props.payload?.length) return null;
            const inp = (props.payload.find(p => p.dataKey === 'input')?.value as number) ?? 0;
            const out = (props.payload.find(p => p.dataKey === 'output')?.value as number) ?? 0;
            return (
              <div style={{
                background: 'transparent',
                border: 'none',
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '0.7rem',
                pointerEvents: 'none',
              }}>
                <p style={{ color: '#8899b3', marginBottom: 2 }}>{props.label}</p>
                <p style={{ color: '#60a5fa' }}>in {formatTokens(inp)}</p>
                <p style={{ color: '#3b82f6' }}>out {formatTokens(out)}</p>
              </div>
            );
          }}
          cursor={{ fill: 'rgba(59,130,246,0.05)' }}
        />
        <Bar dataKey="input" stackId="tok" fill="#60a5fa" fillOpacity={0.9} radius={0} />
        <Bar dataKey="output" stackId="tok" fill="#3b82f6" fillOpacity={0.9} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Cost Summary ──────────────────────────────────────────────────────────────

function CostSummary({ metrics }: { metrics: MetricsResponse }) {
  const total = metrics.totalEstimatedCost ?? 0;
  const byModel = metrics.costByModel ?? {};
  const modelEntries = Object.entries(byModel).sort((a, b) => b[1] - a[1]);

  // Token breakdown
  const totalInput = metrics.totalPromptTokens ?? 0;
  const totalOutput = metrics.totalCompletionTokens ?? 0;
  const totalCache = (metrics.totalCacheCreationTokens ?? 0) + (metrics.totalCacheReadTokens ?? 0);
  const totalAll = totalInput + totalOutput + totalCache;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: '3rem',
      flexWrap: 'wrap',
    }}>
      {/* Total cost */}
      <div>
        <p style={{ ...AXIS_STYLE as React.CSSProperties, fontSize: '0.7rem', marginBottom: 4 }}>
          TOTAL COST
        </p>
        <p style={{
          fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
          fontSize: '1.6rem',
          color: '#e8a838',
          lineHeight: 1,
        }}>
          ${total.toFixed(4)}
        </p>
      </div>

      {/* Token breakdown */}
      <div>
        <p style={{ ...AXIS_STYLE as React.CSSProperties, fontSize: '0.7rem', marginBottom: 4 }}>
          TOKENS
        </p>
        <div style={{
          fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
          fontSize: '0.75rem',
          color: '#8899b3',
          lineHeight: 1.8,
        }}>
          <span style={{ color: '#60a5fa' }}>in</span> {formatTokens(totalInput)}
          {'  '}<span style={{ color: '#3b82f6' }}>out</span> {formatTokens(totalOutput)}
          {'  '}<span style={{ color: '#4a5568' }}>cache</span> {formatTokens(totalCache)}
          {'  '}<span style={{ color: '#c5d0e6' }}>total</span> {formatTokens(totalAll)}
        </div>
      </div>

      {/* Per-model breakdown */}
      {modelEntries.length > 0 && (
        <div>
          <p style={{ ...AXIS_STYLE as React.CSSProperties, fontSize: '0.7rem', marginBottom: 4 }}>
            BY MODEL
          </p>
          <div style={{
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            fontSize: '0.75rem',
            color: '#8899b3',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}>
            {modelEntries.slice(0, 4).map(([model, cost]) => (
              <span key={model}>
                <span style={{ color: '#c5d0e6' }}>{model.length > 20 ? model.slice(-20) : model}</span>
                {'  '}
                <span style={{ color: '#e8a838' }}>${cost.toFixed(4)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Misc stats */}
      <div>
        <p style={{ ...AXIS_STYLE as React.CSSProperties, fontSize: '0.7rem', marginBottom: 4 }}>
          ACTIVITY
        </p>
        <div style={{
          fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
          fontSize: '0.75rem',
          color: '#8899b3',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}>
          <span>
            <span style={{ color: '#c5d0e6' }}>agents</span>
            {'  '}
            <span style={{ color: '#e8a838' }}>{metrics.totalAgentsSpawned ?? 0}</span>
          </span>
          <span>
            <span style={{ color: '#c5d0e6' }}>retries</span>
            {'  '}
            <span style={{ color: metrics.retryCount > 0 ? '#ef4444' : '#8899b3' }}>{metrics.retryCount ?? 0}</span>
          </span>
          <span>
            <span style={{ color: '#c5d0e6' }}>quality avg</span>
            {'  '}
            <span style={{ color: '#22c55e' }}>{(metrics.averageQualityScore ?? 0).toFixed(2)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Persona Comparison ────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  developer: '#3b82f6',
  architect: '#8b5cf6',
  'qa-engineer': '#22c55e',
  'devops-engineer': '#f59e0b',
  designer: '#ec4899',
  reviewer: '#14b8a6',
  guardian: '#ef4444',
  researcher: '#6366f1',
  content: '#f97316',
};

function PersonaComparison({ personas }: { personas: Persona[] | null }) {
  if (!personas || personas.length === 0) {
    return <div style={EMPTY_STYLE}>no personas</div>;
  }
  const top = [...personas]
    .filter(p => p.cardsCompleted > 0)
    .sort((a, b) => b.qualityAverage - a.qualityAverage)
    .slice(0, 8);

  if (top.length === 0) return <div style={EMPTY_STYLE}>no persona data</div>;

  const chartData = top.map(p => ({
    name: p.name.length > 14 ? p.name.slice(0, 12) + '…' : p.name,
    quality: Math.round(p.qualityAverage * 100) / 100,
    cards: p.cardsCompleted,
    color: ROLE_COLORS[p.role] ?? '#8899b3',
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="name"
          tick={{ ...AXIS_STYLE, fontSize: '0.62rem' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 5]}
          ticks={[0, 1, 2, 3, 4, 5]}
          tick={{ ...AXIS_STYLE }}
          axisLine={false}
          tickLine={false}
          width={20}
        />
        <Tooltip
          content={(props) => {
            if (!props.active || !props.payload?.length) return null;
            const d = props.payload[0]?.payload;
            return (
              <div style={{
                background: 'transparent',
                border: 'none',
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '0.7rem',
                pointerEvents: 'none',
              }}>
                <p style={{ color: '#8899b3', marginBottom: 2 }}>{props.label}</p>
                <p style={{ color: d?.color ?? '#c5d0e6' }}>quality {d?.quality?.toFixed(2)}</p>
                <p style={{ color: '#8899b3' }}>{d?.cards} cards</p>
              </div>
            );
          }}
          cursor={{ fill: 'rgba(59,130,246,0.05)' }}
        />
        <Bar dataKey="quality" radius={[2, 2, 0, 0]}>
          {chartData.map((entry, i) => (
            <Cell key={i} fill={entry.color} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Skill Heatmap ─────────────────────────────────────────────────────────────

const DOMAIN_COLORS = [
  '#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b',
  '#ec4899', '#14b8a6', '#ef4444', '#6366f1', '#f97316',
];

function SkillHeatmap({ skills }: { skills: Skill[] | null }) {
  if (!skills || skills.length === 0) {
    return <div style={EMPTY_STYLE}>no skills</div>;
  }

  const CONF_VALUE: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const domains = [...new Set(skills.map(s => s.domain))].sort();

  const domainSkills = domains.map((domain, di) => {
    const ds = skills.filter(s => s.domain === domain);
    const avgConf = ds.reduce((sum, s) => sum + (CONF_VALUE[s.confidence] ?? 0), 0) / ds.length;
    return {
      domain: domain.length > 12 ? domain.slice(0, 10) + '…' : domain,
      count: ds.length,
      avgConf,
      color: DOMAIN_COLORS[di % DOMAIN_COLORS.length] ?? '#8899b3',
    };
  }).slice(0, 9);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', padding: '0.5rem 0' }}>
      {domainSkills.map(({ domain, count, avgConf, color }) => {
        const opacity = 0.3 + (avgConf / 3) * 0.7;
        const size = Math.max(48, Math.min(96, 36 + count * 12));
        return (
          <div
            key={domain}
            style={{
              width: size,
              height: size,
              background: `${color}`,
              opacity,
              borderRadius: 4,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              border: `1px solid ${color}44`,
            }}
          >
            <span style={{
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontSize: '0.75rem',
              color: '#e8ecf4',
              fontWeight: 600,
            }}>{count}</span>
            <span style={{
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontSize: '0.55rem',
              color: 'rgba(232,236,244,0.8)',
              textAlign: 'center',
              padding: '0 4px',
              wordBreak: 'break-word',
            }}>{domain}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Compliance Trend ──────────────────────────────────────────────────────────

function ComplianceTrend({ qualityTrend }: { qualityTrend: MetricsResponse['qualityTrend'] }) {
  if (!qualityTrend || qualityTrend.length === 0) {
    return <div style={EMPTY_STYLE}>no compliance data</div>;
  }

  // Compliance = quality >= 3.0 (pass threshold)
  const WINDOW = 5;
  const chartData = qualityTrend.map((d, i) => {
    const window = qualityTrend.slice(Math.max(0, i - WINDOW + 1), i + 1);
    const compliant = window.filter(w => w.score >= 6.0).length;
    const rate = Math.round((compliant / window.length) * 100);
    return { index: i + 1, rate, score: Math.round(d.score * 100) / 100 };
  });

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="index"
          tick={{ ...AXIS_STYLE }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tick={{ ...AXIS_STYLE }}
          axisLine={false}
          tickLine={false}
          width={28}
          tickFormatter={(v: number) => `${v}%`}
        />
        <Tooltip
          content={<MinimalTooltip
            labelPrefix="Card #"
            formatter={(v) => `compliance ${v}%`}
          />}
          cursor={{ stroke: 'rgba(34,197,94,0.15)', strokeWidth: 1 }}
        />
        <Line
          type="monotone"
          dataKey="rate"
          stroke="#22c55e"
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 4, fill: '#22c55e', stroke: 'none' }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface MetricsTabProps {
  metrics: MetricsResponse | null;
  loading: boolean;
}

export function MetricsTab({ metrics, loading }: MetricsTabProps) {
  const { projectId } = useProject();
  const { data: personas } = useApiQuery<Persona[]>('/api/personas');
  const { data: skills } = useApiQuery<Skill[]>(
    projectId ? `/api/projects/${projectId}/skills` : '/api/skills'
  );

  if (loading) {
    return (
      <div style={{ ...EMPTY_STYLE, height: 300 }}>
        loading metrics...
      </div>
    );
  }

  if (!metrics) {
    return (
      <div style={{ ...EMPTY_STYLE, height: 300 }}>
        no metrics available
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Cost summary — full width at top */}
      <div style={{
        padding: '1.5rem 0',
        marginBottom: '2rem',
        borderBottom: '1px solid rgba(36,48,68,0.5)',
      }}>
        <CostSummary metrics={metrics} />
      </div>

      {/* Charts grid — 2 columns */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '2.5rem',
      }}>
        {/* Quality Trend */}
        <div>
          <p style={TITLE_STYLE}>Quality Trend</p>
          <QualityTrend data={metrics.qualityTrend} />
        </div>

        {/* Card Velocity */}
        <div>
          <p style={TITLE_STYLE}>Card Velocity</p>
          <CardVelocity cardsByStatus={metrics.cardsByStatus} />
        </div>

        {/* Token Usage */}
        <div>
          <p style={TITLE_STYLE}>Token Usage</p>
          <TokenUsage data={metrics.tokensOverTime} />
        </div>

        {/* Agent breakdown */}
        <div>
          <p style={TITLE_STYLE}>Agents by Type</p>
          <AgentBreakdown agentsByType={metrics.agentsByType} />
        </div>

        {/* Persona Comparison */}
        <div>
          <p style={TITLE_STYLE}>Persona Comparison</p>
          <PersonaComparison personas={personas} />
        </div>

        {/* Compliance Trend */}
        <div>
          <p style={TITLE_STYLE}>Compliance Trend</p>
          <ComplianceTrend qualityTrend={metrics.qualityTrend} />
        </div>
      </div>

      {/* Skill Heatmap — full width */}
      <div style={{ marginTop: '2.5rem' }}>
        <p style={TITLE_STYLE}>Skill Heatmap</p>
        <SkillHeatmap skills={skills} />
      </div>
    </div>
  );
}

// ── Agent Breakdown (bonus 4th chart) ─────────────────────────────────────────

function AgentBreakdown({ agentsByType }: { agentsByType: MetricsResponse['agentsByType'] }) {
  const TYPE_COLORS: Record<string, string> = {
    volundr: '#e8a838',
    orchestrator: '#3b82f6',
    developer: '#22c55e',
    tester: '#f59e0b',
    content: '#8899b3',
    review: '#a855f7',
    researcher: '#60a5fa',
    designer: '#f472b6',
    devops: '#34d399',
    qa: '#fb923c',
    architect: '#818cf8',
    guardian: '#ef4444',
  };

  const entries = Object.entries(agentsByType ?? {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return <div style={EMPTY_STYLE}>no agent data</div>;
  }

  const chartData = entries.map(([type, count]) => ({
    type: type.slice(0, 12),
    count,
    color: TYPE_COLORS[type] ?? '#4a5568',
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="type"
          tick={{ ...AXIS_STYLE }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ ...AXIS_STYLE }}
          axisLine={false}
          tickLine={false}
          width={20}
        />
        <Tooltip
          content={<MinimalTooltip formatter={(v) => `${v} agents`} />}
          cursor={{ fill: 'rgba(59,130,246,0.05)' }}
        />
        <Bar dataKey="count" radius={[2, 2, 0, 0]}>
          {chartData.map((entry, i) => (
            <Cell key={i} fill={entry.color} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
