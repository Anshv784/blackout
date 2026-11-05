// The BLACKOUT mark: a gold lens with light inside and a beam cutting into the dark.
// LensMark is the icon (top bar); Wordmark is the name with the lens as its O.
export function LensMark({ size = 22, beam = true }: { size?: number; beam?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <defs>
        <linearGradient id="lm-beam" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffe7a8" stopOpacity=".95" />
          <stop offset=".55" stopColor="#ffd166" stopOpacity=".35" />
          <stop offset="1" stopColor="#ffd166" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="lm-core" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset=".6" stopColor="#ffe9b0" />
          <stop offset="1" stopColor="#ffd166" />
        </radialGradient>
      </defs>
      {beam && <path d="M33 30 L64 14 L64 50 Z" fill="url(#lm-beam)" transform="rotate(18 32 32)" />}
      <circle cx="26" cy="32" r="15" fill="#07080c" stroke="#ffd166" strokeWidth="6.5" />
      <circle cx="26" cy="32" r="6.2" fill="url(#lm-core)" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`} aria-label="BLACKOUT">
      <span aria-hidden>BLACK</span>
      <span className="wm-o" aria-hidden>
        <i className="wm-beam" />
        <svg viewBox="0 0 64 64">
          <defs>
            <radialGradient id="wm-core" cx="50%" cy="50%" r="50%">
              <stop offset="0" stopColor="#fffaf0" />
              <stop offset=".6" stopColor="#ffe9b0" />
              <stop offset="1" stopColor="#ffd166" />
            </radialGradient>
          </defs>
          <circle cx="32" cy="32" r="23.5" fill="#07080c" stroke="#ffd166" strokeWidth="9.5" />
          <circle cx="32" cy="32" r="9.5" fill="url(#wm-core)" />
        </svg>
      </span>
      <span className="wm-ut" aria-hidden>UT</span>
    </span>
  );
}
