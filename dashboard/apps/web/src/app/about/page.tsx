export default function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto px-8 py-16 space-y-12">

      <header>
        <h1 className="font-cormorant font-semibold text-[2rem] text-[#c5d0e6]">
          About Volundr
        </h1>
        <p className="text-[0.85rem] text-[#8899b3] mt-2"
           style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif' }}>
          Autonomous agent framework for software engineering
        </p>
      </header>

      <section className="space-y-4 text-[0.9rem] text-[#c5d0e6] leading-relaxed"
               style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif' }}>
        <h2 className="font-cormorant font-semibold text-[1.3rem] text-[#e8a838]">
          What is it?
        </h2>
        <p>
          Volundr is an autonomous PM, architect, and orchestrator that runs inside Claude Code.
          It manages entire software projects end-to-end: discovery interviews, blueprints,
          card breakdowns, parallel agent teams, quality scoring, and self-optimization.
        </p>
        <p>
          You describe what you want to build. Volundr interviews you, creates a plan,
          decomposes it into cards, spawns specialized agent teammates to implement them
          in parallel, scores the output, learns from mistakes, and delivers working software.
        </p>
      </section>

      <section className="space-y-4 text-[0.9rem] text-[#c5d0e6] leading-relaxed"
               style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif' }}>
        <h2 className="font-cormorant font-semibold text-[1.3rem] text-[#e8a838]">
          Why the name?
        </h2>
        <p>
          <span className="text-[#e8a838] font-medium">Volundr</span> (Old Norse: <span className="italic">Volundr</span>,
          also known as Wayland the Smith) is the master craftsman of Norse mythology. A legendary
          artificer who could forge anything — swords, rings, mechanical wonders — working alone in
          his smithy with supernatural skill.
        </p>
        <p>
          The parallel is intentional. Volundr the framework is a lone intelligence that
          orchestrates a forge of agents, each a specialist, working together to build
          software with craftsmanship. The dashboard is called <span className="text-[#e8a838] font-medium">The Forge</span> because
          that is where the work happens. The team meeting place is called <span className="text-[#e8a838] font-medium">The Thing</span> (Old
          Norse: <span className="italic">thing</span>) after the Norse assembly where decisions were debated
          and made collectively.
        </p>
      </section>

      <section className="space-y-4 text-[0.9rem] text-[#c5d0e6] leading-relaxed"
               style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif' }}>
        <h2 className="font-cormorant font-semibold text-[1.3rem] text-[#e8a838]">
          How does it work?
        </h2>
        <div className="space-y-3">
          <div>
            <span className="text-[#8899b3] font-mono text-[0.8rem]">1. Discovery</span>
            <p className="mt-1">Volundr interviews you about your project vision, stack, constraints, and preferences.</p>
          </div>
          <div>
            <span className="text-[#8899b3] font-mono text-[0.8rem]">2. Blueprint</span>
            <p className="mt-1">It produces a blueprint and breaks the work into cards organized by domain and dependency.</p>
          </div>
          <div>
            <span className="text-[#8899b3] font-mono text-[0.8rem]">3. Implementation</span>
            <p className="mt-1">Specialized agent teammates (Developers, Architect, QA, Designer, Reviewer) work
              in parallel using isolated git worktrees. Each card has acceptance criteria and is scored on completion.</p>
          </div>
          <div>
            <span className="text-[#8899b3] font-mono text-[0.8rem]">4. Quality loop</span>
            <p className="mt-1">Every card is quality-scored. Low scores trigger retries and steering rules.
              Every five cards, Volundr reviews trends, updates prompts, and logs lessons learned.</p>
          </div>
          <div>
            <span className="text-[#8899b3] font-mono text-[0.8rem]">5. Delivery</span>
            <p className="mt-1">Architecture guardian review, documentation generation, retrospective, and lesson promotion
              to cross-project memory.</p>
          </div>
        </div>
      </section>

      <section className="space-y-4 text-[0.9rem] text-[#c5d0e6] leading-relaxed"
               style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif' }}>
        <h2 className="font-cormorant font-semibold text-[1.3rem] text-[#e8a838]">
          The Forge
        </h2>
        <p>
          This dashboard is Volundr's real-time interface. It shows live agent status,
          event feeds, card progress, quality metrics, and the campfire scene where you
          can watch agent teams communicate. All state is stored in a SQLite database
          and synchronized via WebSocket.
        </p>
      </section>

      <footer className="pt-8 text-[0.75rem] text-[#8899b3] font-mono">
        Volundr v4.0
      </footer>
    </div>
  );
}
