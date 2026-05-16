export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="max-w-xl text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border text-xs uppercase tracking-wider text-muted-foreground">
          Phase 1 — orchestrator backend
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
          inari-pages
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          Open-source landing-page generator with smart multi-model routing on
          Together AI. The UI ships in Phase 3 — for now, the pipeline lives at{" "}
          <code className="px-1.5 py-0.5 rounded bg-secondary text-foreground text-sm">
            POST /api/generate
          </code>
          .
        </p>
        <pre className="text-left text-xs md:text-sm bg-secondary text-foreground rounded-lg p-4 overflow-x-auto">
{`curl -N -X POST http://localhost:3000/api/generate \\
  -H "Content-Type: application/json" \\
  -d '{"brief":"Landing page for FlowDeck, a Kanban tool for designers"}'`}
        </pre>
        <p className="text-xs text-muted-foreground">
          MOCK_MODE is on by default — no API key needed for local dev.
        </p>
      </div>
    </main>
  );
}
