import Link from "next/link";

/* Cloche logo mark with steam – fills its container via h-full w-full */
function ClocheIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 36"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* steam lines */}
      <path d="M12 8.5c-.4-1.4.6-2.6 0-4" />
      <path d="M16 7.5c-.4-1.4.6-2.6 0-4" />
      <path d="M20 8.5c-.4-1.4.6-2.6 0-4" />
      {/* knob */}
      <circle cx="16" cy="12" r="1.3" />
      {/* dome */}
      <path d="M6 27a10 10 0 0 1 20 0" />
      {/* tray */}
      <line x1="4" y1="27" x2="28" y2="27" />
      {/* base */}
      <path d="M8 27v1.8a1.2 1.2 0 0 0 1.2 1.2h13.6a1.2 1.2 0 0 0 1.2-1.2V27" />
    </svg>
  );
}

export default function AppHeader({
  showStartOver = true,
  onReset,
}: {
  showStartOver?: boolean;
  onReset?: () => void;
} = {}) {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="flex items-center justify-between">
          {/* Logo lockup: icon height matches the two-line text block */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="h-10 w-10 sm:h-[50px] sm:w-[50px] flex-shrink-0">
              <ClocheIcon className="h-full w-full text-zinc-400" />
            </div>
            <div className="flex flex-col justify-center">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 leading-none">
                Amuse Bouchenator
              </h1>
              <p className="mt-[3px] text-[11px] sm:text-sm text-zinc-500 leading-tight">
                Fresh app ideas, served daily&mdash;Cursor-ready build steps included
              </p>
            </div>
          </div>
          {showStartOver && (
            onReset ? (
              <button
                onClick={onReset}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors flex-shrink-0"
              >
                Start over
              </button>
            ) : (
              <Link
                href="/"
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors flex-shrink-0"
              >
                Start over
              </Link>
            )
          )}
        </div>
      </div>
    </header>
  );
}
