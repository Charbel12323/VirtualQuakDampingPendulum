import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-dvh relative overflow-hidden bg-[#020817] text-slate-50">
      {/* Background accents */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -left-24 w-80 h-80 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute -bottom-32 -right-20 w-96 h-96 rounded-full bg-amber-500/10 blur-3xl" />
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-24 flex flex-col items-center text-center gap-8">
        <div className="text-7xl md:text-8xl select-none" aria-hidden>
          🏗️
        </div>
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
          Start Quaking
        </h1>
        <p className="text-slate-400 text-base md:text-lg max-w-2xl leading-relaxed">
          A playful, game-like way to explore how buildings respond to earthquakes.
          Configure your structure, pick a real event, and watch the response.
        </p>

        <div className="flex items-center gap-4 pt-4">
          <Link
            href="/pages/MainPage"
            className="px-6 py-3 rounded-2xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold shadow-sm hover:shadow-md transition"
          >
            Start Simulationwwaz
          </Link>
          <Link
            href="#about"
            className="px-5 py-3 rounded-2xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700 text-slate-100 text-sm transition"
          >
            Learn more
          </Link>
        </div>

        {/* Tiny about blurb */}
        <div id="about" className="pt-8 text-sm text-slate-500 max-w-2xl">
          Built with Next.js and a simplified physics engine. Not a design tool—
          a learning sandbox. Always verify with codes and standards for real projects.
        </div>
      </div>
    </main>
  );
}
