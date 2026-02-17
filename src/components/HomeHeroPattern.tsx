"use client";

/**
 * Full-viewport branded wallpaper grid for the Home page.
 *
 * Covers the entire screen (fixed, inset-0). A repeating tile of Amuse Bouchenator
 * icons drifts diagonally as one layer. CSS mask creates transparent cutouts for
 * header and search card — no overlay divs.
 *
 * CSS-only animation. Respects prefers-reduced-motion (static).
 * pointer-events: none — never intercepts clicks.
 */

const TILE_WIDTH = 540;
const TILE_HEIGHT = 420;

export default function HomeHeroPattern() {
  return (
    <>
      <style>{`
        @keyframes ab-wallpaper-drift {
          from { transform: translate3d(0, 0, 0); }
          to   { transform: translate3d(-${TILE_WIDTH}px, -${TILE_HEIGHT}px, 0); }
        }
        .ab-wallpaper-drift {
          animation: ab-wallpaper-drift 70s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .ab-wallpaper-drift {
            animation: none;
          }
        }
      `}</style>

      <div
        className="fixed inset-0 w-screen h-screen overflow-hidden pointer-events-none"
        style={{
          width: "100vw",
          height: "100vh",
          zIndex: 0,
          maskImage: [
            "linear-gradient(to bottom, transparent 0px, transparent 110px, black 120px)",
            "radial-gradient(ellipse 52% 42% at 50% 50%, transparent 0%, transparent 68%, black 68%)",
          ].join(", "),
          WebkitMaskImage: [
            "linear-gradient(to bottom, transparent 0px, transparent 110px, black 120px)",
            "radial-gradient(ellipse 52% 42% at 50% 50%, transparent 0%, transparent 68%, black 68%)",
          ].join(", "),
        }}
        aria-hidden
      >
        <div
          className="ab-wallpaper-drift absolute"
          style={{
            left: -TILE_WIDTH,
            top: -TILE_HEIGHT,
            width: "max(150vw, 2000px)",
            height: "max(150vh, 1200px)",
            minWidth: TILE_WIDTH * 5,
            minHeight: TILE_HEIGHT * 5,
          }}
        >
          <svg
            className="text-zinc-500 block"
            xmlns="http://www.w3.org/2000/svg"
            style={{
              width: "100%",
              height: "100%",
              minWidth: TILE_WIDTH * 5,
              minHeight: TILE_HEIGHT * 5,
              opacity: 0.12,
            }}
          >
            <defs>
              <symbol id="ab-cloche" viewBox="0 0 28 28">
                <path d="M11 6c-.3-1 .4-2 0-3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                <path d="M14 5c-.3-1 .4-2 0-3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                <path d="M17 6c-.3-1 .4-2 0-3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                <circle cx="14" cy="9" r="1" stroke="currentColor" strokeWidth="1.4" fill="none" />
                <path d="M5 21a9 9 0 0 1 18 0" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                <line x1="3.5" y1="21" x2="24.5" y2="21" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <path d="M7 21v1.2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V21" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
              </symbol>
              <symbol id="ab-spark" viewBox="0 0 24 24">
                <path d="M12 3v18M3 12h18M6.3 6.3l11.4 11.4M17.7 6.3L6.3 17.7" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
              </symbol>
              <symbol id="ab-wand" viewBox="0 0 24 24">
                <line x1="4" y1="20" x2="16" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <path d="M17 5l1-2.5L20.5 4l-2 1.5L20 8l-1.8-1.5L16 7.5l1.5-1.5z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
              </symbol>
              <symbol id="ab-checklist" viewBox="0 0 24 24">
                <path d="M4 6l2 2 4-4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="13" y1="6" x2="20" y2="6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <path d="M4 13l2 2 4-4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="13" y1="13" x2="20" y2="13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <line x1="4" y1="20" x2="6" y2="20" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <line x1="13" y1="20" x2="18" y2="20" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </symbol>
              <symbol id="ab-cards" viewBox="0 0 24 24">
                <rect x="2" y="6" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" fill="none" />
                <rect x="6" y="3" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" fill="none" />
              </symbol>
              <symbol id="ab-cursor" viewBox="0 0 24 24">
                <path d="M5 3l2 18 4-6 7-2z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
              </symbol>
              <symbol id="ab-terminal" viewBox="0 0 24 24">
                <rect x="2" y="4" width="20" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
                <path d="M6 14l3-3-3-3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="12" y1="15" x2="17" y2="15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </symbol>
              <symbol id="ab-code" viewBox="0 0 24 24">
                <path d="M8 7l-5 5 5 5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M16 7l5 5-5 5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="13" y1="5" x2="11" y2="19" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </symbol>
              <symbol id="ab-copy" viewBox="0 0 24 24">
                <rect x="8" y="8" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
                <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
              </symbol>
              <symbol id="ab-nodes" viewBox="0 0 24 24">
                <circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.3" fill="none" />
                <circle cx="18" cy="6" r="2" stroke="currentColor" strokeWidth="1.3" fill="none" />
                <circle cx="12" cy="18" r="2" stroke="currentColor" strokeWidth="1.3" fill="none" />
                <circle cx="18" cy="16" r="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                <line x1="7.5" y1="7.5" x2="10.5" y2="16.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="16.5" y1="7.5" x2="13.5" y2="16.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="18" y1="8" x2="18" y2="14.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </symbol>
              <symbol id="ab-sparkles" viewBox="0 0 24 24">
                <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
                <path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
              </symbol>
              <symbol id="ab-timer" viewBox="0 0 24 24">
                <circle cx="12" cy="13" r="8" stroke="currentColor" strokeWidth="1.3" fill="none" />
                <line x1="12" y1="13" x2="12" y2="9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <line x1="12" y1="13" x2="15" y2="14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <line x1="10" y1="2" x2="14" y2="2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <line x1="12" y1="2" x2="12" y2="5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </symbol>

              <pattern id="abPattern" x="0" y="0" width={TILE_WIDTH} height={TILE_HEIGHT} patternUnits="userSpaceOnUse">
                <use href="#ab-cloche"     x="20"   y="20"   width="36" height="36" transform="rotate(-6, 38, 38)" />
                <use href="#ab-spark"      x="120"  y="30"   width="32" height="32" transform="rotate(8, 136, 46)" />
                <use href="#ab-terminal"   x="230"  y="15"   width="34" height="34" transform="rotate(-3, 247, 32)" />
                <use href="#ab-nodes"      x="340"  y="28"   width="34" height="34" transform="rotate(5, 357, 45)" />
                <use href="#ab-checklist"  x="440"  y="18"   width="32" height="32" transform="rotate(-4, 456, 34)" />
                <use href="#ab-sparkles"   x="40"   y="120"  width="34" height="34" transform="rotate(10, 57, 137)" />
                <use href="#ab-code"       x="150"  y="110"  width="34" height="34" transform="rotate(7, 167, 127)" />
                <use href="#ab-wand"       x="270"  y="125"  width="32" height="32" transform="rotate(-10, 286, 141)" />
                <use href="#ab-copy"       x="370"  y="115"  width="32" height="32" transform="rotate(3, 386, 131)" />
                <use href="#ab-cards"      x="460"  y="128"  width="34" height="34" transform="rotate(-5, 477, 145)" />
                <use href="#ab-cursor"     x="25"   y="220"  width="32" height="32" transform="rotate(9, 41, 236)" />
                <use href="#ab-timer"      x="140"  y="230"  width="32" height="32" transform="rotate(-7, 156, 246)" />
                <use href="#ab-cloche"     x="250"  y="215"  width="36" height="36" transform="rotate(4, 268, 233)" />
                <use href="#ab-terminal"   x="360"  y="228"  width="34" height="34" transform="rotate(-8, 377, 245)" />
                <use href="#ab-spark"      x="450"  y="218"  width="32" height="32" transform="rotate(6, 466, 234)" />
                <use href="#ab-nodes"      x="60"   y="320"  width="34" height="34" transform="rotate(-5, 77, 337)" />
                <use href="#ab-sparkles"   x="180"  y="335"  width="32" height="32" transform="rotate(11, 196, 351)" />
                <use href="#ab-checklist"  x="290"  y="318"  width="32" height="32" transform="rotate(-3, 306, 334)" />
                <use href="#ab-wand"       x="400"  y="330"  width="32" height="32" transform="rotate(7, 416, 346)" />
                <use href="#ab-code"       x="480"  y="322"  width="34" height="34" transform="rotate(-4, 497, 339)" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#abPattern)" />
          </svg>
        </div>
      </div>
    </>
  );
}
