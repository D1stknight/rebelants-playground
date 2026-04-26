import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

// Pre-generated deterministic particles (avoids hydration mismatch)
const PARTICLES = Array.from({ length: 40 }, (_, i) => ({
  left: (i * 97 + 13) % 100,
  size: 2 + (i % 3),
  delay: (i * 0.7) % 9,
  duration: 7 + (i % 6) * 1.8,
  opacity: 0.15 + (i % 5) * 0.08,
  color: i % 3 === 0 ? '#ef4444' : i % 3 === 1 ? '#f97316' : '#fbbf24',
}));

const GAMES = [
  { id:'fw',     title:'Faction Wars',       desc:'Choose your faction. Conquer territories. Crush your enemies.', emoji:'⚔️', path:'/faction-wars', color:'#ef4444', glow:'rgba(239,68,68,0.4)',    badge:'STRATEGY', bg:'rgba(239,68,68,0.08)'    },
  { id:'raid',   title:'The Raid',           desc:'Deploy your squad. Survive the colony. Bring home the loot.',  emoji:'🎯', path:'/the-raid',     color:'#f97316', glow:'rgba(249,115,22,0.4)',   badge:'SQUAD',    bg:'rgba(249,115,22,0.08)'   },
  { id:'tunnel', title:'Ant Tunnel',         desc:'Navigate the underground. Collect crystals. Outrun the spider.', emoji:'🐜', path:'/tunnel',    color:'#3b82f6', glow:'rgba(59,130,246,0.4)',  badge:'ARCADE',   bg:'rgba(59,130,246,0.08)'   },
  { id:'shuffle',title:"Queen's Egg Shuffle",desc:"Find the Queen's egg. Beat the odds. Win big.",               emoji:'🃏', path:'/shuffle',      color:'#a855f7', glow:'rgba(168,85,247,0.4)',  badge:'LUCK',     bg:'rgba(168,85,247,0.08)'   },
];

const STEPS = [
  { n:'01', icon:'🎮', title:'Connect Discord', desc:'Link your Discord to join the community and track your victories' },
  { n:'02', icon:'💎', title:'Connect Wallet',  desc:'Connect your ApeChain wallet to earn REBEL tokens and win prizes' },
  { n:'03', icon:'⚔️', title:'Play & Earn',     desc:'Choose your game, battle hard, earn REBEL, climb the leaderboards' },
];

interface Legend { label: string; icon: string; player: string; value: string; }

export default function LandingPage() {
  const router = useRouter();
  const [titleIn,   setTitleIn]   = useState(false);
  const [subIn,     setSubIn]     = useState(false);
  const [ctaIn,     setCtaIn]     = useState(false);
  const [cardsIn,   setCardsIn]   = useState(false);
  const [hovered,   setHovered]   = useState('');
  const [legends,   setLegends]   = useState<Legend[]>([]);
  const [ctaHover,  setCtaHover]  = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setTitleIn(true),  200);
    const t2 = setTimeout(() => setSubIn(true),    700);
    const t3 = setTimeout(() => setCtaIn(true),   1100);
    const t4 = setTimeout(() => setCardsIn(true), 1400);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, []);

  useEffect(() => {
    fetch('/api/faction-wars/leaderboard', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (!d?.ok || !d?.lb) return;
        const lb = d.lb;
        const e: Legend[] = [];
        if (lb.warlords?.[0])  e.push({ label:'Top Warlord',        icon:'🏆', player: lb.warlords[0].playerName,  value: lb.warlords[0].score  + ' territories' });
        if (lb.streaks?.[0])   e.push({ label:'Longest Streak',     icon:'🔥', player: lb.streaks[0].playerName,   value: lb.streaks[0].score   + ' wins'        });
        if (lb.richest?.[0])   e.push({ label:'Richest Commander',  icon:'💰', player: lb.richest[0].playerName,   value: lb.richest[0].score   + ' REBEL'       });
        if (lb.perfect?.[0])   e.push({ label:'Perfect Campaigns',  icon:'👑', player: lb.perfect[0].playerName,   value: lb.perfect[0].score   + ' perfect'     });
        setLegends(e);
      }).catch(() => {});
  }, []);

  return (
    <>
      <Head>
        <title>Rebel Ants Playground 🐜</title>
        <meta name="description" content="Play. Earn. Conquer. The Rebel Ants gaming universe on ApeChain." />
      </Head>

      <div style={{ position:'relative', minHeight:'100vh', background:'#050810', color:'white', fontFamily:"'Inter',system-ui,sans-serif", overflowX:'hidden' }}>

        {/* ── VIDEO BACKGROUND ── */}
        <div style={{ position:'fixed', inset:0, zIndex:0 }}>
          <video autoPlay muted loop playsInline style={{ width:'100%', height:'100%', objectFit:'cover', opacity:0.5 }} src="/videos/hero-bg.mp4" />
          <div style={{ position:'absolute', inset:0, background:'linear-gradient(to bottom, rgba(5,8,16,0.2) 0%, rgba(5,8,16,0.05) 35%, rgba(5,8,16,0.65) 75%, rgba(5,8,16,1) 100%)' }} />
          <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse at 50% 40%, transparent 20%, rgba(5,8,16,0.55) 100%)' }} />
        </div>

        {/* ── PARTICLES ── */}
        <div style={{ position:'fixed', inset:0, zIndex:1, pointerEvents:'none', overflow:'hidden' }}>
          {PARTICLES.map((p, i) => (
            <div key={i} style={{
              position:'absolute', bottom:'-6px', left: p.left + '%',
              width: p.size, height: p.size, borderRadius:'50%',
              background: p.color, opacity: p.opacity,
              animation: `floatUp ${p.duration}s ${p.delay}s infinite linear`,
            }} />
          ))}
        </div>

        {/* ── MAIN CONTENT ── */}
        <div style={{ position:'relative', zIndex:3 }}>

          {/* ══ HERO ══════════════════════════════════════════════════════════ */}
          <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'60px 24px 80px', textAlign:'center' }}>

            <div style={{ fontSize:52, marginBottom:20, opacity: titleIn ? 1 : 0, transform: titleIn ? 'scale(1) rotate(0deg)' : 'scale(0.4) rotate(-20deg)', transition:'all 0.7s cubic-bezier(0.34,1.56,0.64,1)' }}>🐜</div>

            <h1 style={{
              fontSize:'clamp(40px,9vw,104px)', fontWeight:900, letterSpacing:'-0.02em', lineHeight:0.95,
              marginBottom:12,
              opacity: titleIn ? 1 : 0,
              transform: titleIn ? 'translateY(0) scale(1)' : 'translateY(50px) scale(0.9)',
              transition:'all 0.9s cubic-bezier(0.22,1,0.36,1)',
              background:'linear-gradient(140deg, #ffffff 0%, #fca5a5 25%, #ef4444 50%, #f97316 75%, #fbbf24 100%)',
              WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text',
              filter:'drop-shadow(0 0 60px rgba(239,68,68,0.5))',
            }}>REBEL ANTS</h1>

            <div style={{
              fontSize:'clamp(12px,2.5vw,20px)', fontWeight:300, letterSpacing:'0.5em',
              color:'rgba(255,255,255,0.6)', marginBottom:32, textTransform:'uppercase',
              opacity: subIn ? 1 : 0, transform: subIn ? 'translateY(0)' : 'translateY(24px)',
              transition:'all 0.7s cubic-bezier(0.22,1,0.36,1)',
            }}>PLAYGROUND</div>

            <p style={{
              fontSize:'clamp(14px,1.8vw,17px)', color:'rgba(255,255,255,0.45)',
              maxWidth:440, lineHeight:1.7, marginBottom:52,
              opacity: subIn ? 1 : 0, transition:'opacity 0.8s ease 0.3s',
            }}>
              Play mini-games. Earn REBEL tokens. Win NFTs and merch.<br/>The ultimate ant battle arena on ApeChain.
            </p>

            <button
              onClick={() => router.push('/hatch')}
              onMouseEnter={() => setCtaHover(true)}
              onMouseLeave={() => setCtaHover(false)}
              style={{
                padding:'18px 60px', fontSize:17, fontWeight:900, letterSpacing:'0.12em',
                textTransform:'uppercase', background:'linear-gradient(135deg,#ef4444,#f97316,#ef4444)',
                backgroundSize:'200% 100%', border:'none', borderRadius:50, color:'white',
                cursor:'pointer',
                opacity: ctaIn ? 1 : 0,
                transform: ctaIn ? (ctaHover ? 'translateY(-3px) scale(1.04)' : 'translateY(0) scale(1)') : 'translateY(24px) scale(0.92)',
                transition:'all 0.5s cubic-bezier(0.34,1.56,0.64,1)',
                boxShadow: ctaHover
                  ? '0 0 60px rgba(239,68,68,0.7), 0 0 120px rgba(239,68,68,0.3), 0 8px 32px rgba(0,0,0,0.5)'
                  : '0 0 40px rgba(239,68,68,0.4), 0 0 80px rgba(239,68,68,0.15), 0 4px 16px rgba(0,0,0,0.4)',
                animation: ctaIn ? 'pulseCta 3s ease-in-out infinite' : 'none',
              }}
            >⚔️&nbsp;&nbsp;Enter the Playground</button>

            <div style={{ position:'absolute', bottom:28, left:'50%', transform:'translateX(-50%)', opacity:0.35, animation:'bounce 2s ease-in-out infinite', fontSize:22, color:'rgba(255,255,255,0.6)' }}>↓</div>
          </div>

          {/* ══ GAME PICKER ════════════════════════════════════════════════════ */}
          <div style={{ padding:'80px 24px', maxWidth:1120, margin:'0 auto' }}>
            <h2 style={{ textAlign:'center', fontSize:'clamp(18px,3.5vw,32px)', fontWeight:900, letterSpacing:'0.25em', textTransform:'uppercase', color:'rgba(255,255,255,0.88)', marginBottom:10 }}>
              CHOOSE YOUR BATTLEFIELD
            </h2>
            <p style={{ textAlign:'center', color:'rgba(255,255,255,0.35)', marginBottom:52, fontSize:14, letterSpacing:'0.05em' }}>
              Four games. One universe. Infinite REBEL to earn.
            </p>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(230px,1fr))', gap:18 }}>
              {GAMES.map((g, i) => (
                <div key={g.id}
                  onClick={() => router.push(g.path)}
                  onMouseEnter={() => setHovered(g.id)}
                  onMouseLeave={() => setHovered('')}
                  style={{
                    position:'relative', padding:'28px 22px 24px', borderRadius:18, cursor:'pointer',
                    border: `1px solid ${hovered===g.id ? g.color+'aa' : 'rgba(255,255,255,0.07)'}`,
                    background: hovered===g.id ? g.bg : 'rgba(255,255,255,0.025)',
                    opacity: cardsIn ? 1 : 0,
                    transform: cardsIn ? (hovered===g.id ? 'translateY(-6px) scale(1.02)' : 'translateY(0) scale(1)') : 'translateY(40px)',
                    transition: `all 0.45s cubic-bezier(0.22,1,0.36,1) ${i*90}ms`,
                    boxShadow: hovered===g.id ? `0 0 40px ${g.glow}, 0 12px 40px rgba(0,0,0,0.5)` : '0 4px 20px rgba(0,0,0,0.35)',
                    backdropFilter:'blur(12px)',
                  }}>
                  <span style={{ position:'absolute', top:14, right:14, fontSize:9, fontWeight:900, letterSpacing:'0.12em', padding:'3px 7px', borderRadius:4, background: g.color+'22', color: g.color, border:`1px solid ${g.color}44` }}>{g.badge}</span>
                  <div style={{ fontSize:42, marginBottom:18 }}>{g.emoji}</div>
                  <h3 style={{ fontSize:17, fontWeight:900, marginBottom:10, color: hovered===g.id ? g.color : 'rgba(255,255,255,0.9)', transition:'color 0.2s' }}>{g.title}</h3>
                  <p style={{ fontSize:13, color:'rgba(255,255,255,0.45)', lineHeight:1.65, marginBottom:22 }}>{g.desc}</p>
                  <div style={{ fontSize:13, fontWeight:700, color: g.color, opacity: hovered===g.id ? 1 : 0.5, transition:'opacity 0.2s', letterSpacing:'0.05em' }}>Play Now →</div>
                </div>
              ))}
            </div>
          </div>

          {/* ══ LEGENDS STRIP ══════════════════════════════════════════════════ */}
          {legends.length > 0 && (
            <div style={{ padding:'64px 24px', background:'linear-gradient(to bottom, rgba(255,255,255,0.015), rgba(255,255,255,0.03), rgba(255,255,255,0.015))', borderTop:'1px solid rgba(255,255,255,0.05)', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ maxWidth:1120, margin:'0 auto' }}>
                <h2 style={{ textAlign:'center', fontSize:'clamp(16px,3vw,26px)', fontWeight:900, letterSpacing:'0.25em', textTransform:'uppercase', marginBottom:8 }}>🏛️ HALL OF LEGENDS</h2>
                <p style={{ textAlign:'center', color:'rgba(255,255,255,0.3)', marginBottom:40, fontSize:13, letterSpacing:'0.04em' }}>Live rankings — will your name be here next?</p>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(210px,1fr))', gap:14 }}>
                  {legends.map((l, i) => (
                    <div key={i} style={{ padding:'20px 18px', borderRadius:14, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)', backdropFilter:'blur(8px)' }}>
                      <div style={{ fontSize:26, marginBottom:10 }}>{l.icon}</div>
                      <div style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'0.12em', color:'rgba(255,255,255,0.35)', marginBottom:5 }}>{l.label}</div>
                      <div style={{ fontSize:13, fontWeight:700, color:'white', marginBottom:5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{l.player}</div>
                      <div style={{ fontSize:14, color:'#fbbf24', fontWeight:800 }}>{l.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ══ HOW IT WORKS ═══════════════════════════════════════════════════ */}
          <div style={{ padding:'80px 24px', maxWidth:960, margin:'0 auto', textAlign:'center' }}>
            <h2 style={{ fontSize:'clamp(16px,3vw,26px)', fontWeight:900, letterSpacing:'0.25em', textTransform:'uppercase', marginBottom:8 }}>HOW IT WORKS</h2>
            <p style={{ color:'rgba(255,255,255,0.35)', marginBottom:52, fontSize:13, letterSpacing:'0.04em' }}>Three steps to the battlefield</p>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:24 }}>
              {STEPS.map((s) => (
                <div key={s.n} style={{ padding:'28px 20px', borderRadius:16, background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.07)' }}>
                  <div style={{ fontSize:10, fontWeight:900, letterSpacing:'0.25em', color:'rgba(255,255,255,0.2)', marginBottom:14 }}>STEP {s.n}</div>
                  <div style={{ fontSize:38, marginBottom:16 }}>{s.icon}</div>
                  <h4 style={{ fontSize:15, fontWeight:900, marginBottom:10, color:'rgba(255,255,255,0.88)' }}>{s.title}</h4>
                  <p style={{ fontSize:13, color:'rgba(255,255,255,0.4)', lineHeight:1.65 }}>{s.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ══ DISCORD CTA ════════════════════════════════════════════════════ */}
          <div style={{ padding:'80px 24px', textAlign:'center', background:'linear-gradient(to bottom, transparent, rgba(88,101,242,0.06), transparent)' }}>
            <div style={{ fontSize:52, marginBottom:18, animation:'pulse 3s ease-in-out infinite' }}>🐜</div>
            <h2 style={{ fontSize:'clamp(22px,4.5vw,44px)', fontWeight:900, marginBottom:18, letterSpacing:'-0.01em' }}>Join the Colony</h2>
            <p style={{ color:'rgba(255,255,255,0.45)', maxWidth:420, margin:'0 auto 44px', lineHeight:1.75, fontSize:15 }}>
              Challenge notifications. Tournament updates. Faction rivalries.<br/>The community lives on Discord.
            </p>
            <a href="https://discord.gg/rebelants" target="_blank" rel="noopener noreferrer"
              style={{ display:'inline-flex', alignItems:'center', gap:12, padding:'16px 44px', borderRadius:50, background:'#5865F2', color:'white', textDecoration:'none', fontWeight:900, fontSize:16, boxShadow:'0 0 40px rgba(88,101,242,0.45), 0 4px 20px rgba(0,0,0,0.4)', transition:'all 0.2s', letterSpacing:'0.05em' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
              Join Discord
            </a>
          </div>

          {/* ══ FOOTER ═════════════════════════════════════════════════════════ */}
          <div style={{ padding:'24px 20px', textAlign:'center', borderTop:'1px solid rgba(255,255,255,0.05)', color:'rgba(255,255,255,0.22)', fontSize:11, letterSpacing:'0.06em' }}>
            © 2026 Rebel Ants LLC · Developed by Miguel Concepcion
          </div>

        </div>

        {/* ══ GLOBAL STYLES ══════════════════════════════════════════════════════ */}
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html { scroll-behavior: smooth; }
          body { background: #050810; }
          @keyframes floatUp {
            0%   { transform: translateY(0) scale(1);    opacity: inherit; }
            80%  { opacity: inherit; }
            100% { transform: translateY(-105vh) scale(0.2); opacity: 0; }
          }
          @keyframes pulseCta {
            0%,100% { background-position: 0% 0%; }
            50%      { background-position: 100% 0%; }
          }
          @keyframes bounce {
            0%,100% { transform: translateX(-50%) translateY(0);  }
            50%      { transform: translateX(-50%) translateY(10px); }
          }
          @keyframes pulse {
            0%,100% { transform: scale(1);    filter: drop-shadow(0 0 8px rgba(239,68,68,0.4)); }
            50%      { transform: scale(1.08); filter: drop-shadow(0 0 20px rgba(239,68,68,0.7)); }
          }
        `}</style>

      </div>
    </>
  );
}
