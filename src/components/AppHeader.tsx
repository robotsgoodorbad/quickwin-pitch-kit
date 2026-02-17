import Link from "next/link";

export default function AppHeader() {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
              Amuse Bouchenator
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Fresh app ideas, served daily&mdash;Cursor-ready build steps included
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors"
          >
            Start over
          </Link>
        </div>
      </div>
    </header>
  );
}
