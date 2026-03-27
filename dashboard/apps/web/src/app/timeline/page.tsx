'use client';

export default function TimelinePage() {
  return (
    <div
      className="flex items-center justify-center"
      style={{
        minHeight: 'calc(100vh - 120px)',
        paddingTop: 120,
        fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
      }}
    >
      <div className="text-center">
        <h1
          className="text-2xl font-bold mb-2"
          style={{ color: '#e8a838' }}
        >
          Session Timeline
        </h1>
        <p style={{ color: '#8899b3', fontSize: '0.85rem' }}>
          Coming soon — chronological view of session activity
        </p>
      </div>
    </div>
  );
}
