// components/Queen.tsx
import * as React from 'react';

type QueenProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Accessible name used if the element isn't aria-hidden upstream */
  title?: string;
};

export default function Queen({ className = '', title = 'Ant Queen', ...rest }: QueenProps) {
  return (
    <div className={className} {...rest}>
      <svg
        viewBox="0 0 800 600"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={title}
        focusable="false"
      >
        <defs>
          {/* soft outer glow for the SVG aura */}
          <filter id="qSoftGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="18" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <radialGradient id="qAura" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="rgba(255,230,120,.45)" />
            <stop offset="70%" stopColor="rgba(255,230,120,.12)" />
            <stop offset="100%" stopColor="rgba(255,230,120,0)" />
          </radialGradient>

          <linearGradient id="qGold" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffe88a" />
            <stop offset="60%" stopColor="#ffc54a" />
            <stop offset="100%" stopColor="#ff9e2a" />
          </linearGradient>

          <linearGradient id="qBody" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#2b324a" />
            <stop offset="100%" stopColor="#0e152b" />
          </linearGradient>

          <linearGradient id="qWing" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(180,220,255,.28)" />
            <stop offset="100%" stopColor="rgba(120,255,210,.20)" />
          </linearGradient>
        </defs>

        {/* Soft aura behind the queen (inside the SVG) */}
        <g opacity=".9" filter="url(#qSoftGlow)">
          <ellipse cx="400" cy="320" rx="290" ry="190" fill="url(#qAura)" />
        </g>

        {/* Wings */}
        <g className="q-wing" opacity=".95">
          <path
            d="M420 270 C520 210, 610 200, 680 245 C705 265, 705 300, 670 310 C600 330, 520 320, 445 300 Z"
            fill="url(#qWing)"
            stroke="rgba(190,230,255,.35)"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d="M380 270 C280 210, 190 200, 120 245 C95 265, 95 300, 130 310 C200 330, 280 320, 355 300 Z"
            fill="url(#qWing)"
            stroke="rgba(190,230,255,.35)"
            vectorEffect="non-scaling-stroke"
          />
        </g>

        {/* Body (head, thorax, abdomen) */}
        <g fill="url(#qBody)" stroke="rgba(255,255,255,.08)" vectorEffect="non-scaling-stroke">
          <circle cx="400" cy="260" r="35" />
          <ellipse cx="400" cy="315" rx="60" ry="45" />
          <ellipse cx="400" cy="385" rx="90" ry="70" />
        </g>

        {/* Crown */}
        <g className="q-crown">
          <path
            d="M365 223 L400 200 L435 223 L428 245 L372 245 Z"
            fill="url(#qGold)"
            stroke="#7f4b00"
            strokeOpacity=".6"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx="400" cy="200" r="6" fill="#fff6cc" />
        </g>

        {/* Highlights */}
        <g opacity=".35">
          <ellipse cx="430" cy="285" rx="20" ry="10" fill="#ffffff" />
          <ellipse cx="445" cy="350" rx="30" ry="16" fill="#ffffff" />
        </g>
      </svg>
    </div>
  );
}
