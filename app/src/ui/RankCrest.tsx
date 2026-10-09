// Podium insignia: a struck-metal shield with the Yard's torch-eye, rank chevrons, and a crown
// with laurels for the one who walked out most. Gold / silver / bronze by place.
const METALS = [
  { hi: "#fff4c2", mid: "#ffd166", lo: "#8a5a12", edge: "#5a3a08", glow: "#ffd166" },
  { hi: "#ffffff", mid: "#c9d1de", lo: "#5d6676", edge: "#333a46", glow: "#cfd8ff" },
  { hi: "#ffe0c8", mid: "#e0915c", lo: "#6e3518", edge: "#45200c", glow: "#ff9f5a" },
];

export function RankCrest({ place, dim = false }: { place: 0 | 1 | 2; dim?: boolean }) {
  const m = METALS[place];
  const id = `crest${place}${dim ? "d" : ""}`;
  const chevrons = 3 - place; // 1st: three, 2nd: two, 3rd: one
  return (
    <svg className={`rank-crest p${place + 1} ${dim ? "dim" : ""}`} viewBox="-6 -2 132 142" aria-hidden>
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={m.hi} />
          <stop offset=".45" stopColor={m.mid} />
          <stop offset="1" stopColor={m.lo} />
        </linearGradient>
        <linearGradient id={`${id}-field`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a1d27" />
          <stop offset="1" stopColor="#07080c" />
        </linearGradient>
        <radialGradient id={`${id}-eye`}>
          <stop offset="0" stopColor="#fffbe8" />
          <stop offset=".35" stopColor={m.glow} />
          <stop offset="1" stopColor={m.glow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <path d="M60 18 L104 32 V72 C104 100 84 118 60 128 C36 118 16 100 16 72 V32 Z" />
        </clipPath>
      </defs>

      {/* laurels for first place */}
      {place === 0 &&
        [-1, 1].map((s) => (
          <g key={s} transform={`translate(60 0) scale(${s} 1) translate(-60 0)`} fill={`url(#${id}-metal)`} opacity=".9">
            {[0, 1, 2, 3, 4].map((i) => (
              <ellipse key={i} cx={6 + i * 1.5} cy={50 + i * 16} rx="4.5" ry="9.5" transform={`rotate(${-30 + i * 14} ${6 + i * 1.5} ${50 + i * 16})`} />
            ))}
          </g>
        ))}

      {/* the shield: metal rim, dark field */}
      <path d="M60 14 L108 29 V72 C108 103 86 122 60 133 C34 122 12 103 12 72 V29 Z" fill={`url(#${id}-metal)`} stroke={m.edge} strokeWidth="1.5" />
      <path d="M60 22 L100 34 V72 C100 97 82 113 60 122 C38 113 20 97 20 72 V34 Z" fill={`url(#${id}-field)`} />

      {/* the torch-eye: a lit pupil in the dark, rays out */}
      <g clipPath={`url(#${id}-clip)`}>
        <circle cx="60" cy="62" r="26" fill={`url(#${id}-eye)`} opacity=".55" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <rect key={a} x="59" y="30" width="2" height="8" rx="1" fill={m.mid} opacity=".7" transform={`rotate(${a} 60 62)`} />
        ))}
        <circle cx="60" cy="62" r="13" fill="none" stroke={`url(#${id}-metal)`} strokeWidth="2.5" />
        <circle cx="60" cy="62" r="5.5" fill="#fffbe8" />
        {/* light sweeping across the metal */}
        <rect className="crest-shine" x="-60" y="0" width="40" height="140" fill={`url(#${id}-shine)`} transform="skewX(-18)" />
      </g>

      {/* rank chevrons */}
      {Array.from({ length: chevrons }, (_, i) => (
        <path key={i} d={`M40 ${88 + i * 9} L60 ${98 + i * 9} L80 ${88 + i * 9}`} fill="none" stroke={`url(#${id}-metal)`} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      ))}

      {/* crown for first place */}
      {place === 0 && (
        <path d="M42 14 L46 2 L53 10 L60 0 L67 10 L74 2 L78 14 Z" fill={`url(#${id}-metal)`} stroke={m.edge} strokeWidth="1" />
      )}
    </svg>
  );
}
