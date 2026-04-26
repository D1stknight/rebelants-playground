import React, { useEffect, useState, useCallback, useRef } from 'react';
import { loadProfile, saveProfile } from '../lib/profile';
import { usePoints } from '../lib/usePoints';
import Head from 'next/head';
import { useRouter } from 'next/router';

// Deterministic particles — no hydration mismatch
const PARTICLES = Array.from({ length: 40 }, (_, i) => ({
  left: (i * 97 + 13) % 100,
  size: 2 + (i % 3),
  delay: (i * 0.7) % 9,
  duration: 7 + (i % 6) * 1.8,
  opacity: 0.15 + (i % 5) * 0.08,
  color: i % 3 === 0 ? '#ef4444' : i % 3 === 1 ? '#f97316' : '#fbbf24',
}));

const GAMES = [
  { id:'fw',     title:'FACTION WARS',       desc:'CHOOSE YOUR FACTION. CONQUER TERRITORIES. CRUSH YOUR ENEMIES.', icon:'⚔️',  path:'/faction-wars', color:'#ef4444', glow:'rgba(239,68,68,0.4)',   badge:'STRATEGY', bg:'rgba(239,68,68,0.08)'   },
  { id:'raid',   title:'THE RAID',           desc:'DEPLOY YOUR SQUAD. SURVIVE THE COLONY. BRING HOME THE LOOT.',  icon:'🗡️',  path:'/the-raid',     color:'#f97316', glow:'rgba(249,115,22,0.4)',  badge:'SQUAD',    bg:'rgba(249,115,22,0.08)'  },
  { id:'tunnel', title:'ANT TUNNEL',         desc:'NAVIGATE THE UNDERGROUND. COLLECT CRYSTALS. OUTRUN THE SPIDER.', icon:'🐜', path:'/tunnel',       color:'#3b82f6', glow:'rgba(59,130,246,0.4)', badge:'ARCADE',   bg:'rgba(59,130,246,0.08)'  },
  { id:'shuffle',title:"QUEEN'S EGG SHUFFLE",desc:"FIND THE QUEEN'S EGG. BEAT THE ODDS. WIN BIG.",               icon:'🥚',  path:'/shuffle',       color:'#a855f7', glow:'rgba(168,85,247,0.4)', badge:'LUCK',     bg:'rgba(168,85,247,0.08)'  },
];

const ECONOMY = [
  { icon:'🎮', title:'CONNECT DISCORD', desc:'LINK YOUR DISCORD ACCOUNT TO TRACK YOUR WINS, USE YOUR REBEL POINTS AND STAY CONNECTED WITH THE COLONY.', color:'#5865F2' },
  { icon:'💎', title:'CONNECT WALLET',  desc:'CONNECT YOUR APECHAIN WALLET TO PURCHASE REBEL POINTS WHEN NEEDED AND CLAIM NFT AND MERCH PRIZES.', color:'#f97316' },
  { icon:'⚔️', title:'PLAY TO EARN',   desc:'CHOOSE YOUR GAME. BATTLE HARD. EARN REBEL TOKENS. CLIMB THE LEADERBOARDS AND WIN REAL PRIZES.', color:'#ef4444' },
];

interface Legend { label: string; icon: string; player: string; value: string; }

// Japanese-style font family
const JP = "'Noto Serif JP', 'Hiragino Mincho ProN', 'Yu Mincho', serif";

export default function LandingPage() {
  const router = useRouter();
  const [titleIn,  setTitleIn]  = useState(false);
  const [subIn,    setSubIn]    = useState(false);
  const [ctaIn,    setCtaIn]    = useState(false);
  const [cardsIn,  setCardsIn]  = useState(false);
  const [hovered,  setHovered]  = useState('');
  const [legends,  setLegends]  = useState<Legend[]>([]);
  const [ctaHover, setCtaHover] = useState(false);
  const [musicMuted, setMusicMuted] = useState(false);
  const audioRef = React.useRef<HTMLAudioElement|null>(null);
  const audioUnlocked = React.useRef(false);

  // ── Commander Strip ──
  const [profile, setProfile] = useState<any>(null);
  const [discordLinked, setDiscordLinked] = useState(false);
  const [claimMsg, setClaimMsg] = useState('');
  const effectiveId = profile?.primaryId || profile?.discordUserId && `discord:${profile.discordUserId}` || 'guest';
  const pts = usePoints(effectiveId === 'guest' ? 'guest' : effectiveId);

  // Load profile on mount and listen for identity changes
  useEffect(() => {
    const load = () => {
      const p = loadProfile();
      setProfile(p);
      setDiscordLinked(!!(p?.discordUserId));
    };
    load();
    window.addEventListener('ra:identity-changed', load);
    return () => window.removeEventListener('ra:identity-changed', load);
  }, []);

  const handleClaimDaily = useCallback(async () => {
    if (!effectiveId || effectiveId === 'guest') { setClaimMsg('Connect Discord first!'); setTimeout(()=>setClaimMsg(''),3000); return; }
    setClaimMsg('Claiming...');
    try {
      const r = await fetch('/api/points/claim', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId: effectiveId, amount: 200 }) });
      const j = await r.json().catch(()=>null);
      if (!r.ok || !j?.ok) { setClaimMsg(j?.error === 'already_claimed' ? 'Already claimed today!' : 'Claim failed'); }
      else { setClaimMsg(`+${j.added || 200} REBEL claimed!`); await pts.refresh(); }
    } catch { setClaimMsg('Error — try again'); }
    setTimeout(() => setClaimMsg(''), 3000);
  }, [effectiveId, pts]);

  const handleDisconnectDiscord = useCallback(() => {
    saveProfile({ discordSkipLink: true, discordUserId: undefined, discordName: undefined, primaryId: undefined });
    window.dispatchEvent(new Event('ra:identity-changed'));
    window.location.href = '/api/auth/discord/logout';
  }, []);

  const handleConnectDiscord = useCallback(() => {
    saveProfile({ discordSkipLink: false });
    window.dispatchEvent(new Event('ra:identity-changed'));
    window.location.href = '/api/auth/discord/login';
  }, []);

  // Unlock & start music on first user interaction (iOS requirement)
  const unlockAudio = React.useCallback(() => {
    if (audioUnlocked.current) return;
    audioUnlocked.current = true;
    if (audioRef.current) {
      audioRef.current.volume = 0.35;
      audioRef.current.play().catch(()=>{});
    }
  }, []);

  useEffect(() => {
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
  }, [unlockAudio]);

  const toggleMusic = React.useCallback(() => {
    setMusicMuted(m => {
      const next = !m;
      if (audioRef.current) {
        if (next) { audioRef.current.pause(); }
        else { audioRef.current.volume = 0.35; audioRef.current.play().catch(()=>{}); }
      }
      return next;
    });
  }, []);

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
        if (lb.warlords?.[0])  e.push({ label:'TOP WARLORD',        icon:'🏆', player: lb.warlords[0].playerName,  value: lb.warlords[0].score  + ' TERRITORIES' });
        if (lb.streaks?.[0])   e.push({ label:'LONGEST STREAK',     icon:'🔥', player: lb.streaks[0].playerName,   value: lb.streaks[0].score   + ' WINS'        });
        if (lb.richest?.[0])   e.push({ label:'RICHEST COMMANDER',  icon:'💰', player: lb.richest[0].playerName,   value: lb.richest[0].score   + ' REBEL'       });
        if (lb.perfect?.[0])   e.push({ label:'PERFECT CAMPAIGNS',  icon:'👑', player: lb.perfect[0].playerName,   value: lb.perfect[0].score   + ' PERFECT'     });
        setLegends(e);
      }).catch(() => {});
  }, []);

  return (
    <>
      <Head>
        <title>Rebel Ants Playground 🐜</title>
        <meta name="description" content="Play. Earn. Conquer. The Rebel Ants Arena on ApeChain." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@300;400;700;900&display=swap" rel="stylesheet" />
      </Head>

      <div style={{ position:'relative', minHeight:'100vh', background:'#050810', color:'white', fontFamily: JP, overflowX:'hidden' }}>

        {/* ── AUDIO ── */}
        <audio ref={audioRef} src="/audio/japan_sound.mp3" loop preload="none" />

        {/* ── MUTE BUTTON ── */}
        <button
          onPointerDown={e=>{e.preventDefault();toggleMusic();}}
          style={{ position:'fixed', top:16, right:16, zIndex:9999, background:'rgba(0,0,0,0.5)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:50, padding:'8px 14px', cursor:'pointer', color:'white', fontSize:16, fontFamily:'inherit', minWidth:44, minHeight:44, touchAction:'manipulation', backdropFilter:'blur(8px)' }}
          title={musicMuted ? 'Unmute' : 'Mute'}
        >{musicMuted ? '🔇' : '🎵'}</button>

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

        <div style={{ position:'relative', zIndex:3 }}>

          {/* ══ HERO ══════════════════════════════════════════════════════════ */}
          <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'60px 24px 80px', textAlign:'center' }}>

            <div style={{ marginBottom:20, opacity: titleIn ? 1 : 0, transform: titleIn ? 'scale(1) rotate(0deg)' : 'scale(0.4) rotate(-20deg)', transition:'all 0.7s cubic-bezier(0.34,1.56,0.64,1)', width:140, height:140, margin:'0 auto 20px' }}>
              <img src="/bg/rebel-ants-logo.png" alt="Rebel Ants" style={{ width:'100%', height:'100%', objectFit:'contain', mixBlendMode:'screen', filter:'drop-shadow(0 0 30px rgba(239,68,68,0.6))' }} />
            </div>

            <h1 style={{
              fontFamily: JP,
              fontSize:'clamp(40px,9vw,104px)', fontWeight:900, letterSpacing:'0.08em', lineHeight:0.95,
              marginBottom:12, textTransform:'uppercase',
              opacity: titleIn ? 1 : 0,
              transform: titleIn ? 'translateY(0) scale(1)' : 'translateY(50px) scale(0.9)',
              transition:'all 0.9s cubic-bezier(0.22,1,0.36,1)',
              background:'linear-gradient(140deg, #ffffff 0%, #fca5a5 25%, #ef4444 50%, #f97316 75%, #fbbf24 100%)',
              WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text',
              filter:'drop-shadow(0 0 60px rgba(239,68,68,0.5))',
            }}>REBEL ANTS</h1>

            <div style={{
              fontFamily: JP,
              fontSize:'clamp(12px,2.5vw,20px)', fontWeight:300, letterSpacing:'0.6em',
              color:'rgba(255,255,255,0.6)', marginBottom:32, textTransform:'uppercase',
              opacity: subIn ? 1 : 0, transform: subIn ? 'translateY(0)' : 'translateY(24px)',
              transition:'all 0.7s cubic-bezier(0.22,1,0.36,1)',
            }}>PLAYGROUND</div>

            {/* Updated tagline — all caps, Japanese font */}
            <p style={{
              fontFamily: JP,
              fontSize:'clamp(11px,1.4vw,15px)',
              color:'rgba(255,255,255,0.55)',
              maxWidth:520, lineHeight:1.9, marginBottom:52,
              letterSpacing:'0.12em', textTransform:'uppercase',
              fontWeight:400,
              opacity: subIn ? 1 : 0, transition:'opacity 0.8s ease 0.3s',
              borderTop:'1px solid rgba(255,255,255,0.1)',
              borderBottom:'1px solid rgba(255,255,255,0.1)',
              padding:'20px 0',
            }}>
              PLAY MINI-GAMES. EARN REBEL TOKENS. WIN NFTs, MERCH AND MORE.<br/>
              <span style={{ color:'rgba(255,255,255,0.35)', fontSize:'clamp(10px,1.2vw,13px)', letterSpacing:'0.2em' }}>
                THE ULTIMATE REBEL ANTS ARENA.
              </span>
            </p>

            <button
              onClick={() => router.push('/hatch')}
              onMouseEnter={() => setCtaHover(true)}
              onMouseLeave={() => setCtaHover(false)}
              style={{
                fontFamily: JP,
                padding:'18px 60px', fontSize:15, fontWeight:900, letterSpacing:'0.2em',
                textTransform:'uppercase', background:'linear-gradient(135deg,#ef4444,#f97316)',
                border:'none', borderRadius:50, color:'white', cursor:'pointer',
                opacity: ctaIn ? 1 : 0,
                transform: ctaIn ? (ctaHover ? 'translateY(-3px) scale(1.04)' : 'translateY(0) scale(1)') : 'translateY(24px) scale(0.92)',
                transition:'all 0.5s cubic-bezier(0.34,1.56,0.64,1)',
                boxShadow: ctaHover
                  ? '0 0 60px rgba(239,68,68,0.7), 0 0 120px rgba(239,68,68,0.3), 0 8px 32px rgba(0,0,0,0.5)'
                  : '0 0 40px rgba(239,68,68,0.4), 0 0 80px rgba(239,68,68,0.15), 0 4px 16px rgba(0,0,0,0.4)',
              }}
            >⚔️ &nbsp;ENTER THE PLAYGROUND</button>

            <div style={{ position:'absolute', bottom:28, left:'50%', transform:'translateX(-50%)', opacity:0.35, animation:'bounce 2s ease-in-out infinite', fontSize:22 }}>↓</div>
          </div>

          {/* ══ COMMANDER STRIP ══════════════════════════════════════════════════ */}
          <div style={{ padding:'0 24px 60px', maxWidth:1100, margin:'0 auto' }}>
            <div style={{
              display:'flex', flexWrap:'wrap', alignItems:'center', justifyContent:'space-between',
              gap:16, padding:'24px 32px',
              background:'rgba(255,255,255,0.04)',
              border:'1px solid rgba(255,255,255,0.08)',
              borderRadius:20, backdropFilter:'blur(16px)',
            }}>
              {/* Left — Identity */}
              <div style={{ display:'flex', flexDirection:'column', gap:4, minWidth:180 }}>
                <div style={{ fontFamily:'inherit', fontSize:11, letterSpacing:'0.2em', color:'rgba(255,255,255,0.35)', textTransform:'uppercase' }}>COMMANDER</div>
                <div style={{ fontFamily:'inherit', fontSize:15, fontWeight:900, color:'white', letterSpacing:'0.05em', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:220 }}>
                  {discordLinked ? (profile?.discordName || profile?.name || 'Commander') : 'GUEST'}
                </div>
                {discordLinked && (
                  <div style={{ fontFamily:'inherit', fontSize:10, color:'rgba(255,255,255,0.3)', letterSpacing:'0.08em' }}>
                    {effectiveId.slice(0,28)}{effectiveId.length>28?'...':''}
                  </div>
                )}
              </div>

              {/* Center — Balance */}
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                <div style={{ fontFamily:'inherit', fontSize:11, letterSpacing:'0.2em', color:'rgba(255,255,255,0.35)', textTransform:'uppercase' }}>REBEL BALANCE</div>
                <div style={{ fontFamily:'inherit', fontSize:28, fontWeight:900, color:'#fbbf24', letterSpacing:'0.05em', filter:'drop-shadow(0 0 12px rgba(251,191,36,0.4))' }}>
                  {pts.balance !== undefined ? pts.balance.toLocaleString() : '—'}
                </div>
                <div style={{ fontFamily:'inherit', fontSize:10, color:'rgba(255,255,255,0.25)', letterSpacing:'0.08em' }}>REBEL TOKENS</div>
              </div>

              {/* Right — Actions */}
              <div style={{ display:'flex', flexWrap:'wrap', gap:10, alignItems:'center' }}>
                {/* Daily Claim */}
                <button
                  onPointerDown={e=>{e.preventDefault();handleClaimDaily();}}
                  style={{ fontFamily:'inherit', padding:'10px 18px', fontSize:12, fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase', background:'linear-gradient(135deg,#ef4444,#f97316)', border:'none', borderRadius:50, color:'white', cursor:'pointer', whiteSpace:'nowrap' }}
                >
                  {claimMsg || '⚡ CLAIM DAILY'}
                </button>

                {/* Buy Points */}
                <button
                  onPointerDown={e=>{e.preventDefault(); router.push('/the-raid?buy=1');}}
                  style={{ fontFamily:'inherit', padding:'10px 18px', fontSize:12, fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase', background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:50, color:'white', cursor:'pointer', whiteSpace:'nowrap' }}
                >
                  💎 BUY POINTS
                </button>

                {/* Discord */}
                {discordLinked ? (
                  <button
                    onPointerDown={e=>{e.preventDefault();handleDisconnectDiscord();}}
                    style={{ fontFamily:'inherit', padding:'10px 18px', fontSize:12, fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase', background:'rgba(88,101,242,0.15)', border:'1px solid rgba(88,101,242,0.3)', borderRadius:50, color:'#a5b4fc', cursor:'pointer', whiteSpace:'nowrap' }}
                  >
                    ✓ DISCORD
                  </button>
                ) : (
                  <button
                    onPointerDown={e=>{e.preventDefault();handleConnectDiscord();}}
                    style={{ fontFamily:'inherit', padding:'10px 18px', fontSize:12, fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase', background:'#5865F2', border:'none', borderRadius:50, color:'white', cursor:'pointer', whiteSpace:'nowrap', boxShadow:'0 0 20px rgba(88,101,242,0.4)' }}
                  >
                    CONNECT DISCORD
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ══ ECONOMY / HOW IT WORKS ══════════════════════════════════════════ */}
          <div style={{ padding:'80px 24px', maxWidth:1100, margin:'0 auto' }}>
            <h2 style={{ fontFamily:JP, textAlign:'center', fontSize:'clamp(16px,3vw,28px)', fontWeight:900, letterSpacing:'0.3em', textTransform:'uppercase', color:'rgba(255,255,255,0.88)', marginBottom:10 }}>
              THE REBEL ECONOMY
            </h2>
            <p style={{ fontFamily:JP, textAlign:'center', color:'rgba(255,255,255,0.35)', marginBottom:52, fontSize:12, letterSpacing:'0.2em', textTransform:'uppercase' }}>
              THREE STEPS TO THE BATTLEFIELD
            </p>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:20 }}>
              {ECONOMY.map((e, i) => (
                <div key={i} style={{
                  padding:'32px 26px', borderRadius:18, textAlign:'center',
                  background:'rgba(255,255,255,0.025)', border:`1px solid ${e.color}33`,
                  backdropFilter:'blur(12px)',
                  opacity: cardsIn ? 1 : 0,
                  transform: cardsIn ? 'translateY(0)' : 'translateY(30px)',
                  transition: `all 0.5s ease ${i * 120}ms`,
                }}>
                  <div style={{ fontSize:40, marginBottom:16, filter:`drop-shadow(0 0 12px ${e.color}66)` }}>{e.icon}</div>
                  <div style={{ fontFamily:JP, fontSize:13, fontWeight:900, letterSpacing:'0.25em', textTransform:'uppercase', color: e.color, marginBottom:14 }}>{e.title}</div>
                  <div style={{ fontFamily:JP, fontSize:11, color:'rgba(255,255,255,0.45)', lineHeight:1.9, letterSpacing:'0.1em', textTransform:'uppercase' }}>{e.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ══ GAME PICKER ════════════════════════════════════════════════════ */}
          <div style={{ padding:'60px 24px 80px', maxWidth:1100, margin:'0 auto' }}>
            <h2 style={{ fontFamily:JP, textAlign:'center', fontSize:'clamp(16px,3vw,28px)', fontWeight:900, letterSpacing:'0.3em', textTransform:'uppercase', color:'rgba(255,255,255,0.88)', marginBottom:10 }}>
              CHOOSE YOUR BATTLEFIELD
            </h2>
            <p style={{ fontFamily:JP, textAlign:'center', color:'rgba(255,255,255,0.35)', marginBottom:52, fontSize:12, letterSpacing:'0.2em', textTransform:'uppercase' }}>
              FOUR GAMES. ONE UNIVERSE. INFINITE REBEL TO EARN.
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
                  <span style={{ fontFamily:JP, position:'absolute', top:14, right:14, fontSize:9, fontWeight:900, letterSpacing:'0.15em', padding:'3px 7px', borderRadius:4, background: g.color+'22', color: g.color, border:`1px solid ${g.color}44`, textTransform:'uppercase' }}>{g.badge}</span>
                  <div style={{ fontSize:40, marginBottom:18, filter: hovered===g.id ? `drop-shadow(0 0 16px ${g.color}88)` : 'none', transition:'filter 0.3s' }}>{g.icon}</div>
                  <h3 style={{ fontFamily:JP, fontSize:15, fontWeight:900, marginBottom:10, letterSpacing:'0.2em', color: hovered===g.id ? g.color : 'rgba(255,255,255,0.9)', transition:'color 0.2s', textTransform:'uppercase' }}>{g.title}</h3>
                  <p style={{ fontFamily:JP, fontSize:11, color:'rgba(255,255,255,0.4)', lineHeight:1.8, marginBottom:22, letterSpacing:'0.08em', textTransform:'uppercase' }}>{g.desc}</p>
                  <div style={{ fontFamily:JP, fontSize:11, fontWeight:900, color: g.color, opacity: hovered===g.id ? 1 : 0.5, transition:'opacity 0.2s', letterSpacing:'0.15em', textTransform:'uppercase' }}>PLAY NOW →</div>
                </div>
              ))}
            </div>
          </div>

          {/* ══ LEGENDS STRIP ══════════════════════════════════════════════════ */}
          {legends.length > 0 && (
            <div style={{ padding:'64px 24px', background:'linear-gradient(to bottom, rgba(255,255,255,0.015), rgba(255,255,255,0.03), rgba(255,255,255,0.015))', borderTop:'1px solid rgba(255,255,255,0.05)', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ maxWidth:1100, margin:'0 auto' }}>
                <h2 style={{ fontFamily:JP, textAlign:'center', fontSize:'clamp(14px,2.5vw,24px)', fontWeight:900, letterSpacing:'0.3em', textTransform:'uppercase', marginBottom:8 }}>🏛️ HALL OF LEGENDS</h2>
                <p style={{ fontFamily:JP, textAlign:'center', color:'rgba(255,255,255,0.3)', marginBottom:40, fontSize:11, letterSpacing:'0.2em', textTransform:'uppercase' }}>LIVE RANKINGS — WILL YOUR NAME BE HERE?</p>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(210px,1fr))', gap:14 }}>
                  {legends.map((l, i) => (
                    <div key={i} style={{ padding:'20px 18px', borderRadius:14, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)', backdropFilter:'blur(8px)' }}>
                      <div style={{ fontSize:26, marginBottom:10 }}>{l.icon}</div>
                      <div style={{ fontFamily:JP, fontSize:9, textTransform:'uppercase', letterSpacing:'0.2em', color:'rgba(255,255,255,0.3)', marginBottom:6 }}>{l.label}</div>
                      <div style={{ fontFamily:JP, fontSize:12, fontWeight:700, color:'white', marginBottom:5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{l.player}</div>
                      <div style={{ fontFamily:JP, fontSize:13, color:'#fbbf24', fontWeight:900, letterSpacing:'0.1em' }}>{l.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ══ DISCORD CTA ════════════════════════════════════════════════════ */}
          <div style={{ padding:'80px 24px', textAlign:'center', background:'linear-gradient(to bottom, transparent, rgba(88,101,242,0.06), transparent)' }}>
            <div style={{ width:100, height:100, margin:'0 auto 18px', animation:'pulse 3s ease-in-out infinite' }}>
              <img src="/bg/rebel-ants-logo.png" alt="Rebel Ants" style={{ width:'100%', height:'100%', objectFit:'contain', mixBlendMode:'screen', filter:'drop-shadow(0 0 20px rgba(239,68,68,0.5))' }} />
            </div>
            <h2 style={{ fontFamily:JP, fontSize:'clamp(20px,4vw,40px)', fontWeight:900, marginBottom:18, letterSpacing:'0.15em', textTransform:'uppercase' }}>JOIN THE COLONY</h2>
            <p style={{ fontFamily:JP, color:'rgba(255,255,255,0.4)', maxWidth:400, margin:'0 auto 44px', lineHeight:1.9, fontSize:12, letterSpacing:'0.15em', textTransform:'uppercase' }}>
              CHALLENGE NOTIFICATIONS. TOURNAMENT UPDATES.<br/>FACTION RIVALRIES. THE COMMUNITY LIVES ON DISCORD.
            </p>
            <a href="https://discord.gg/rebelants" target="_blank" rel="noopener noreferrer"
              style={{ display:'inline-flex', alignItems:'center', gap:12, padding:'16px 44px', borderRadius:50, background:'#5865F2', color:'white', textDecoration:'none', fontWeight:900, fontSize:14, fontFamily:JP, boxShadow:'0 0 40px rgba(88,101,242,0.45)', letterSpacing:'0.15em', textTransform:'uppercase' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
              JOIN DISCORD
            </a>
          </div>

          {/* ══ FOOTER ═════════════════════════════════════════════════════════ */}
          <div style={{ padding:'24px 20px', textAlign:'center', borderTop:'1px solid rgba(255,255,255,0.05)', color:'rgba(255,255,255,0.2)', fontSize:11, fontFamily:JP, letterSpacing:'0.1em', textTransform:'uppercase' }}>
            © 2026 REBEL ANTS LLC · DEVELOPED BY MIGUEL CONCEPCION
          </div>

        </div>

        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@300;400;700;900&display=swap');
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html { scroll-behavior: smooth; }
          body { background: #050810; }
          @keyframes floatUp {
            0%   { transform: translateY(0) scale(1); opacity: inherit; }
            80%  { opacity: inherit; }
            100% { transform: translateY(-105vh) scale(0.2); opacity: 0; }
          }
          @keyframes bounce {
            0%,100% { transform: translateX(-50%) translateY(0); }
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
