// components/Queen.tsx
import React from 'react';

export default function Queen({ className = '' }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <svg viewBox="0 0 800 600" role="img" aria-label="Ant Queen">
        <defs>
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
            <stop offset="0%" stopColor="rgba(180,220,255,.25)" />
            <stop offset="100%" stopColor="rgba(120,255,210,.18)" />
          </linearGradient>
        </defs>

        {/* Soft aura behind the queen */}
        <g opacity=".85">
          <ellipse cx="400" cy="320" rx="280" ry="180" fill="url(#qAura)" />
        </g>

        {/* Wings */}
        <g className="q-wing" opacity=".95">
          <path
            d="M420 270 C520 210, 610 200, 680 245 C705 265, 705 300, 670 310 C600 330, 520 320, 445 300 Z"
            fill="url(#qWing)"
            stroke="rgba(190,230,255,.35)"
          />
          <path
            d="M380 270 C280 210, 190 200, 120 245 C95 265, 95 300, 130 310 C200 330, 280 320, 355 300 Z"
            fill="url(#qWing)"
            stroke="rgba(190,230,255,.35)"
          />
        </g>

        {/* Body (head, thorax, abdomen) */}
        <g fill="url(#qBody)" stroke="rgba(255,255,255,.08)">
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
