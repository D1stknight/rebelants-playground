import React, { useEffect, useState, useCallback, useRef } from 'react';
import { loadProfile, saveProfile } from '../lib/profile';
import { getEffectivePlayerId } from '../lib/profile';
import dynamic from 'next/dynamic';
const BuyPointsModal = dynamic(() => import('../components/BuyPointsModal'), { ssr: false });
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
  { id:'descent',title:'HIVE DESCENT',        desc:'DESCEND THROUGH 10 FLOORS. FACE THE QUEEN. WIN OR DIE.', icon:'🐜',  path:'/descent',     color:'#ff3399', glow:'rgba(255,51,153,0.45)',badge:'3D · ROGUELIKE', bg:'rgba(255,51,153,0.08)' },
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
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  // Commander Name system
  const [showNameClaim, setShowNameClaim] = useState(false);
  const [nameQuery, setNameQuery] = useState('');
  const [nameAvail, setNameAvail] = useState<null|boolean>(null);
  const [nameAvailMsg, setNameAvailMsg] = useState('');
  const [nameClaiming, setNameClaiming] = useState(false);
  const [nameClaimed, setNameClaimed] = useState('');
  // PIN modal state
  const [nameModalMode, setNameModalMode] = useState<'new'|'signin'|'setpin'>('new');
  const [pinInput, setPinInput] = useState('');
  const [signInName, setSignInName] = useState('');
  const [signInMsg, setSignInMsg] = useState('');
  const [signInLoading, setSignInLoading] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeResult, setMergeResult] = useState('');
  const [dailyClaimAmount, setDailyClaimAmount] = useState(200);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>|null>(null);
  // Countdown
  const [dailyClaimed, setDailyClaimed] = useState(false);
  const [msUntilClaim, setMsUntilClaim] = useState(0);
  const effectiveId = profile?.primaryId || profile?.discordUserId && `discord:${profile.discordUserId}` || 'guest';
  const pts = usePoints(effectiveId === 'guest' ? 'guest' : effectiveId);

  // Fetch live daily claim amount from admin config
  useEffect(() => {
    fetch('/api/config', { cache:'no-store' })
      .then(r => r.json())
      .then(d => { if (d?.pointsConfig?.dailyClaim) setDailyClaimAmount(d.pointsConfig.dailyClaim); })
      .catch(() => {});
  }, []);

  // Load profile + auto-link Discord session on mount
  useEffect(() => {
    const load = () => {
      const p = loadProfile();
      setProfile(p);
      setDiscordLinked(!!(p?.discordUserId || p?.primaryId?.startsWith('discord:')));
      setNameInput(p?.name && p.name !== 'guest' ? p.name : '');
    };
    load();
    window.addEventListener('ra:identity-changed', load);

    // Auto-link Discord if OAuth just completed
    const autoLink = async () => {
      const gate = loadProfile();
      if (gate?.discordSkipLink) return;
      try {
        const sr = await fetch('/api/auth/discord/session', { cache: 'no-store' });
        const sj = await sr.json().catch(() => null);
        if (!sr.ok || !sj?.ok || !sj?.discordUserId) return;
        const prof = loadProfile();
        const fromId = getEffectivePlayerId(prof);
        const toId = `discord:${sj.discordUserId}`;
        if (String(prof.primaryId || '') === toId) return;
        await fetch('/api/identity/link-discord', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromId }) });
        saveProfile({ discordUserId: sj.discordUserId, discordName: sj.discordName, primaryId: toId, name: sj.discordName || prof.name, discordSkipLink: false });
        window.dispatchEvent(new Event('ra:identity-changed'));
      } catch {}
    };
    autoLink();

    return () => window.removeEventListener('ra:identity-changed', load);
  }, []);

  // Refresh claim status whenever effectiveId changes
  useEffect(() => {
    if (!effectiveId || effectiveId === 'guest') return;
    const refresh = async () => {
      try {
        const r = await fetch(`/api/points/claim?playerId=${encodeURIComponent(effectiveId)}`, { cache:'no-store' });
        const j = await r.json().catch(()=>null);
        if (r.ok && j?.ok) {
          setDailyClaimed(!!j.claimed);
          setMsUntilClaim(Number(j.msUntilNextClaim || 0));
        }
      } catch {}
    };
    refresh();
  }, [effectiveId]);

  // Countdown tick
  useEffect(() => {
    if (!dailyClaimed || msUntilClaim <= 0) return;
    const t = setInterval(() => setMsUntilClaim(p => Math.max(0, p - 1000)), 1000);
    return () => clearInterval(t);
  }, [dailyClaimed, msUntilClaim]);

  // Live name availability check (debounced 500ms)
  const checkName = useCallback((val: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const clean = val.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!clean || clean.length < 3) { setNameAvail(null); setNameAvailMsg(clean.length > 0 ? 'Min 3 characters' : ''); return; }
    if (clean.length > 20) { setNameAvail(false); setNameAvailMsg('Max 20 characters'); return; }
    setNameAvailMsg('Checking...');
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/commander/check-name?name=${encodeURIComponent(clean)}`);
        const j = await r.json();
        setNameAvail(j.available);
        setNameAvailMsg(j.available ? '✓ AVAILABLE' : '✗ TAKEN');
      } catch { setNameAvailMsg('Check failed'); }
    }, 500);
  }, []);

  const handleClaimName = useCallback(async () => {
    const clean = nameQuery.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!clean || clean.length < 3 || !nameAvail) return;
    setNameClaiming(true);
    try {
      const r = await fetch('/api/commander/claim-name', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name: clean, displayName: nameQuery.trim(), pin: pinInput.trim() })
      });
      const j = await r.json();
      if (!r.ok || !j.ok) { setNameAvailMsg(j.error || 'Failed — try another name'); setNameClaiming(false); return; }
      // Save to profile
      saveProfile({ primaryId: `name:${clean}`, name: j.displayName || clean, discordSkipLink: false });
      window.dispatchEvent(new Event('ra:identity-changed'));
      setNameClaimed(j.displayName || clean);
      setShowNameClaim(false);
    } catch { setNameAvailMsg('Server error — try again'); }
    setNameClaiming(false);
  }, [nameQuery, nameAvail]);

  // Sign in with existing name + PIN
  const handleSignIn = useCallback(async () => {
    const name = signInName.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
    const pin = pinInput.trim();
    if (!name || !pin) { setSignInMsg('Enter your name and PIN'); return; }
    setSignInLoading(true); setSignInMsg('Verifying...');
    try {
      const r = await fetch('/api/commander/sign-in', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, pin }) });
      const j = await r.json();
      if (!r.ok || !j.ok) { setSignInMsg(j.error || 'Sign in failed'); setSignInLoading(false); return; }
      saveProfile({ primaryId: j.playerId, name: j.displayName || name, discordSkipLink: false });
      window.dispatchEvent(new Event('ra:identity-changed'));
      setShowNameClaim(false); setSignInMsg(''); setPinInput(''); setSignInName('');
    } catch { setSignInMsg('Error — try again'); }
    setSignInLoading(false);
  }, [signInName, pinInput]);

  // Set PIN for existing name (one-time for names claimed without PIN)
  const handleSetPin = useCallback(async () => {
    const prof = loadProfile();
    const name = prof.primaryId?.replace('name:','') || '';
    const pin = pinInput.trim();
    if (!name || !pin || pin.length < 4 || !/^[0-9]+$/.test(pin)) { setSignInMsg('Enter a 4-6 digit PIN'); return; }
    setSignInLoading(true); setSignInMsg('Saving...');
    try {
      const r = await fetch('/api/commander/set-pin', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, pin }) });
      const j = await r.json();
      if (!r.ok || !j.ok) { setSignInMsg(j.error || 'Failed'); setSignInLoading(false); return; }
      setSignInMsg(''); setPinInput(''); setShowNameClaim(false);
      setNameClaimed('PIN_SET'); // triggers success confirmation
    } catch { setSignInMsg('Error — try again'); }
    setSignInLoading(false);
  }, [pinInput]);

  const handleMerge = useCallback(async () => {
    const prof = loadProfile();
    const fromId = getEffectivePlayerId(prof);
    const discordId = prof.discordUserId;
    if (!discordId) return;
    const toId = `discord:${discordId}`;
    try {
      setMergeResult('MERGING...');
      const r = await fetch('/api/identity/link-discord', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ fromId }) });
      const j = await r.json();
      if (r.ok && j.ok) {
        saveProfile({ primaryId: toId, name: prof.discordName || prof.name, discordSkipLink: false });
        window.dispatchEvent(new Event('ra:identity-changed'));
        setMergeResult(`✓ ${j.migrated?.balance || 0} REBEL merged to your Discord account!`);
        setTimeout(() => { setShowMergeModal(false); setMergeResult(''); }, 3000);
      } else {
        setMergeResult('Merge failed — try again');
      }
    } catch { setMergeResult('Error — try again'); }
  }, []);

  const handleClaimDaily = useCallback(async () => {
    if (!effectiveId || effectiveId === 'guest') { setClaimMsg('Connect Discord first!'); setTimeout(()=>setClaimMsg(''),3000); return; }
    setClaimMsg('Claiming...');
    try {
      const r = await fetch('/api/points/claim', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId: effectiveId, amount: dailyClaimAmount }) });
      const j = await r.json().catch(()=>null);
      if (!r.ok || !j?.ok) { setClaimMsg(j?.error === 'already_claimed' ? 'Already claimed today!' : 'Claim failed'); }
      else { setClaimMsg(`+${j.added || 200} REBEL claimed!`); await pts.refresh(); }
    } catch { setClaimMsg('Error — try again'); }
    setTimeout(() => setClaimMsg(''), 3000);
  }, [effectiveId, pts]);

  const handleDisconnectDiscord = useCallback(() => {
    const prof = loadProfile();
    // Preserve name:xxx primaryId — only clear Discord-specific fields
    const keepPrimaryId = prof.primaryId?.startsWith('name:') ? prof.primaryId : undefined;
    const keepName = prof.primaryId?.startsWith('name:') ? prof.name : undefined;
    saveProfile({ discordSkipLink: true, discordUserId: undefined, discordName: undefined, primaryId: keepPrimaryId, name: keepName });
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

        {/* ── COMMANDER NAME MODAL (3 modes: new / signin / setpin) ── */}
        {showNameClaim && (
          <div style={{ position:'fixed', inset:0, zIndex:10001, background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }} onPointerDown={e=>{ if(e.target===e.currentTarget){ setShowNameClaim(false); setSignInMsg(''); setPinInput(''); } }}>
            <div style={{ background:'rgba(9,14,30,0.98)', border:`1px solid ${nameModalMode==='signin'?'rgba(88,101,242,0.4)':nameModalMode==='setpin'?'rgba(251,191,36,0.4)':'rgba(239,68,68,0.3)'}`, borderRadius:20, padding:'36px 32px', maxWidth:440, width:'100%', textAlign:'center', boxShadow:'0 0 60px rgba(239,68,68,0.1)' }}>

              {/* ── MODE: NEW COMMANDER ── */}
              {nameModalMode === 'new' && (<>
                <div style={{ fontSize:40, marginBottom:16 }}>⚔️</div>
                <div style={{ fontFamily:'inherit', fontSize:17, fontWeight:900, letterSpacing:'0.2em', marginBottom:8, textTransform:'uppercase' }}>CLAIM YOUR COMMANDER NAME</div>
                <div style={{ fontFamily:'inherit', fontSize:10, color:'rgba(255,255,255,0.4)', letterSpacing:'0.1em', marginBottom:24, lineHeight:1.8, textTransform:'uppercase' }}>
                  YOUR NAME IS PERMANENT · YOUR REBEL POINTS WILL BE TIED TO IT FOREVER
                </div>
                <input autoFocus value={nameQuery} onChange={e=>{ setNameQuery(e.target.value); checkName(e.target.value); }} onKeyDown={e=>{ if(e.key==='Enter' && nameAvail && pinInput.length>=4) handleClaimName(); }} placeholder="COMMANDER NAME" maxLength={20}
                  style={{ fontFamily:'inherit', width:'100%', padding:'12px 16px', fontSize:14, fontWeight:900, letterSpacing:'0.1em', background:'rgba(255,255,255,0.06)', border:`1px solid ${nameAvail===true?'#34d399':nameAvail===false?'#ef4444':'rgba(255,255,255,0.15)'}`, borderRadius:10, color:'white', outline:'none', marginBottom:6, textTransform:'uppercase', textAlign:'center' }} />
                {nameAvailMsg && <div style={{ fontFamily:'inherit', fontSize:10, letterSpacing:'0.1em', color:nameAvail===true?'#34d399':nameAvail===false?'#f87171':'rgba(255,255,255,0.4)', marginBottom:10, textTransform:'uppercase' }}>{nameAvailMsg}</div>}
                <input value={pinInput} onChange={e=>{ if(/^[0-9]*$/.test(e.target.value) && e.target.value.length<=6) setPinInput(e.target.value); }} onKeyDown={e=>{ if(e.key==='Enter' && nameAvail && pinInput.length>=4) handleClaimName(); }} placeholder="CHOOSE A 4-6 DIGIT PIN" maxLength={6} type="password" inputMode="numeric"
                  style={{ fontFamily:'inherit', width:'100%', padding:'12px 16px', fontSize:14, fontWeight:900, letterSpacing:'0.3em', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:10, color:'white', outline:'none', marginBottom:6, textAlign:'center' }} />
                <div style={{ fontFamily:'inherit', fontSize:9, color:'rgba(255,255,255,0.3)', marginBottom:20, letterSpacing:'0.1em', textTransform:'uppercase' }}>YOUR PIN LETS YOU SIGN IN FROM ANY DEVICE · NEVER SHARE IT</div>
                <div style={{ display:'flex', gap:8, justifyContent:'center', marginBottom:16 }}>
                  <button onPointerDown={e=>{e.preventDefault(); if(!nameClaiming&&nameAvail&&pinInput.length>=4) handleClaimName();}} disabled={!nameAvail||nameClaiming||pinInput.length<4}
                    style={{ fontFamily:'inherit', padding:'11px 24px', fontSize:11, fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase', background:(nameAvail&&pinInput.length>=4)?'linear-gradient(135deg,#ef4444,#f97316)':'rgba(255,255,255,0.08)', border:'none', borderRadius:50, color:(nameAvail&&pinInput.length>=4)?'white':'rgba(255,255,255,0.3)', cursor:(nameAvail&&pinInput.length>=4)?'pointer':'not-allowed' }}>
                    {nameClaiming ? 'CLAIMING...' : 'CLAIM THIS NAME'}
                  </button>
                  <button onPointerDown={e=>{e.preventDefault(); setShowNameClaim(false); setSignInMsg(''); setPinInput('');}} style={{ fontFamily:'inherit', padding:'11px 16px', fontSize:11, fontWeight:900, letterSpacing:'0.12em', textTransform:'uppercase', background:'transparent', border:'1px solid rgba(255,255,255,0.15)', borderRadius:50, color:'rgba(255,255,255,0.45)', cursor:'pointer' }}>CANCEL</button>
                </div>
                <button onPointerDown={e=>{e.preventDefault(); setNameModalMode('signin'); setSignInMsg(''); setPinInput(''); setSignInName('');}}
                  style={{ fontFamily:'inherit', fontSize:13, fontWeight:900, letterSpacing:'0.18em', textTransform:'uppercase', background:'transparent', border:'2px solid #a78bfa', borderRadius:50, padding:'10px 22px', cursor:'pointer', color:'#a78bfa', boxShadow:'0 0 16px rgba(167,139,250,0.5), 0 0 32px rgba(167,139,250,0.2)', animation:'neonPulse 2s ease-in-out infinite', whiteSpace:'nowrap' }}>
                  🔑 RETURNING COMMANDER? SIGN IN
                </button>
              </>)}

              {/* ── MODE: SIGN IN ── */}
              {nameModalMode === 'signin' && (<>
                <div style={{ fontSize:40, marginBottom:16 }}>🔑</div>
                <div style={{ fontFamily:'inherit', fontSize:17, fontWeight:900, letterSpacing:'0.2em', marginBottom:8, textTransform:'uppercase', color:'#a5b4fc' }}>RETURNING COMMANDER</div>
                <div style={{ fontFamily:'inherit', fontSize:10, color:'rgba(255,255,255,0.4)', letterSpacing:'0.1em', marginBottom:24, lineHeight:1.8, textTransform:'uppercase' }}>
                  ENTER YOUR COMMANDER NAME AND PIN TO RESTORE YOUR IDENTITY
                </div>
                <input autoFocus value={signInName} onChange={e=>setSignInName(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') handleSignIn(); }} placeholder="YOUR COMMANDER NAME" maxLength={20}
                  style={{ fontFamily:'inherit', width:'100%', padding:'12px 16px', fontSize:14, fontWeight:900, letterSpacing:'0.1em', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:10, color:'white', outline:'none', marginBottom:8, textTransform:'uppercase', textAlign:'center' }} />
                <input value={pinInput} onChange={e=>{ if(/^[0-9]*$/.test(e.target.value) && e.target.value.length<=6) setPinInput(e.target.value); }} onKeyDown={e=>{ if(e.key==='Enter') handleSignIn(); }} placeholder="YOUR PIN" maxLength={6} type="password" inputMode="numeric"
                  style={{ fontFamily:'inherit', width:'100%', padding:'12px 16px', fontSize:14, fontWeight:900, letterSpacing:'0.3em', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:10, color:'white', outline:'none', marginBottom:8, textAlign:'center' }} />
                {signInMsg && <div style={{ fontFamily:'inherit', fontSize:10, color: signInMsg.startsWith('✓')?'#34d399':'#f87171', letterSpacing:'0.1em', marginBottom:12, textTransform:'uppercase' }}>{signInMsg}</div>}
                <div style={{ display:'flex', gap:8, justifyContent:'center', marginBottom:16 }}>
                  <button onPointerDown={e=>{e.preventDefault(); handleSignIn();}} style={{ fontFamily:'inherit', padding:'11px 24px', fontSize:11, fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase', background:'#5865F2', border:'none', borderRadius:50, color:'white', cursor:'pointer' }}>
                    {signInLoading ? 'VERIFYING...' : 'SIGN IN'}
                  </button>
                  <button onPointerDown={e=>{e.preventDefault(); setShowNameClaim(false); setSignInMsg(''); setPinInput('');}} style={{ fontFamily:'inherit', padding:'11px 16px', fontSize:11, fontWeight:900, letterSpacing:'0.12em', textTransform:'uppercase', background:'transparent', border:'1px solid rgba(255,255,255,0.15)', borderRadius:50, color:'rgba(255,255,255,0.45)', cursor:'pointer' }}>CANCEL</button>
                </div>
                <button onPointerDown={e=>{e.preventDefault(); setNameModalMode('new'); setSignInMsg(''); setPinInput('');}} style={{ fontFamily:'inherit', fontSize:10, color:'rgba(255,255,255,0.35)', background:'transparent', border:'none', cursor:'pointer', letterSpacing:'0.1em', textDecoration:'underline', textTransform:'uppercase' }}>
                  ← NEW COMMANDER? CLAIM A NAME
                </button>
              </>)}

              {/* ── MODE: SET PIN (existing name without PIN) ── */}
              {nameModalMode === 'setpin' && (<>
                <div style={{ fontSize:40, marginBottom:16 }}>🔐</div>
                <div style={{ fontFamily:'inherit', fontSize:17, fontWeight:900, letterSpacing:'0.2em', marginBottom:8, textTransform:'uppercase', color:'#fbbf24' }}>SET YOUR PIN</div>
                <div style={{ fontFamily:'inherit', fontSize:10, color:'rgba(255,255,255,0.4)', letterSpacing:'0.1em', marginBottom:24, lineHeight:1.8, textTransform:'uppercase' }}>
                  SECURE YOUR COMMANDER NAME SO YOU CAN SIGN IN FROM ANY DEVICE.<br/>
                  CHOOSE A 4-6 DIGIT PIN. DO NOT FORGET IT.
                </div>
                <input autoFocus value={pinInput} onChange={e=>{ if(/^[0-9]*$/.test(e.target.value) && e.target.value.length<=6) setPinInput(e.target.value); }} onKeyDown={e=>{ if(e.key==='Enter') handleSetPin(); }} placeholder="CHOOSE YOUR PIN" maxLength={6} type="password" inputMode="numeric"
                  style={{ fontFamily:'inherit', width:'100%', padding:'12px 16px', fontSize:14, fontWeight:900, letterSpacing:'0.3em', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(251,191,36,0.3)', borderRadius:10, color:'white', outline:'none', marginBottom:8, textAlign:'center' }} />
                {signInMsg && <div style={{ fontFamily:'inherit', fontSize:10, color: signInMsg.startsWith('Sav')?'rgba(255,255,255,0.4)':'#f87171', letterSpacing:'0.1em', marginBottom:12, textTransform:'uppercase' }}>{signInMsg}</div>}
                <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
                  <button onPointerDown={e=>{e.preventDefault(); if(pinInput.length>=4) handleSetPin();}} disabled={pinInput.length<4||signInLoading}
                    style={{ fontFamily:'inherit', padding:'11px 24px', fontSize:11, fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase', background:pinInput.length>=4?'linear-gradient(135deg,#f59e0b,#f97316)':'rgba(255,255,255,0.08)', border:'none', borderRadius:50, color:pinInput.length>=4?'white':'rgba(255,255,255,0.3)', cursor:pinInput.length>=4?'pointer':'not-allowed' }}>
                    {signInLoading ? 'SAVING...' : 'SAVE MY PIN'}
                  </button>
                  <button onPointerDown={e=>{e.preventDefault(); setShowNameClaim(false); setSignInMsg(''); setPinInput('');}} style={{ fontFamily:'inherit', padding:'11px 16px', fontSize:11, fontWeight:900, letterSpacing:'0.12em', textTransform:'uppercase', background:'transparent', border:'1px solid rgba(255,255,255,0.15)', borderRadius:50, color:'rgba(255,255,255,0.45)', cursor:'pointer' }}>LATER</button>
                </div>
              </>)}

            </div>
          </div>
        )}

        {/* ── NAME CLAIMED CONFIRMATION ── */}
        {nameClaimed && (
          <div style={{ position:'fixed', inset:0, zIndex:10002, background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }} onPointerDown={()=>setNameClaimed('')}>
            <div style={{ background:'rgba(9,14,30,0.98)', border:'1px solid rgba(52,211,153,0.4)', borderRadius:20, padding:'40px 36px', maxWidth:420, width:'100%', textAlign:'center', boxShadow:'0 0 60px rgba(52,211,153,0.2)' }}>
              <div style={{ fontSize:52, marginBottom:16, filter:'drop-shadow(0 0 20px rgba(52,211,153,0.6))' }}>🐜</div>
              {nameClaimed === 'PIN_SET' ? (<>
                <div style={{ fontFamily:'inherit', fontSize:18, fontWeight:900, letterSpacing:'0.15em', color:'#fbbf24', marginBottom:12, textTransform:'uppercase' }}>🔐 PIN SAVED!</div>
                <div style={{ fontFamily:'inherit', fontSize:12, color:'rgba(255,255,255,0.5)', letterSpacing:'0.12em', lineHeight:1.9, textTransform:'uppercase', marginBottom:28 }}>
                  YOUR COMMANDER NAME IS NOW PROTECTED.<br/>
                  YOU CAN SIGN IN FROM ANY DEVICE USING<br/>YOUR NAME AND PIN.
                </div>
              </>) : (<>
                <div style={{ fontFamily:'inherit', fontSize:22, fontWeight:900, letterSpacing:'0.15em', color:'#34d399', marginBottom:12, textTransform:'uppercase' }}>⚔️ {nameClaimed.toUpperCase()}</div>
                <div style={{ fontFamily:'inherit', fontSize:12, color:'rgba(255,255,255,0.5)', letterSpacing:'0.12em', lineHeight:1.9, textTransform:'uppercase', marginBottom:28 }}>
                  IS NOW YOUR PERMANENT COMMANDER NAME.<br/>
                  YOUR REBEL POINTS ARE TIED TO THIS NAME FOREVER.<br/>
                  YOUR PIN LETS YOU SIGN IN FROM ANY DEVICE.<br/>
                  GUARD BOTH WELL, COMMANDER.
                </div>
              </>)}
              <button onPointerDown={()=>setNameClaimed('')} style={{ fontFamily:'inherit', padding:'12px 32px', fontSize:12, fontWeight:900, letterSpacing:'0.2em', textTransform:'uppercase', background:'linear-gradient(135deg,#ef4444,#f97316)', border:'none', borderRadius:50, color:'white', cursor:'pointer' }}>ENTER THE PLAYGROUND →</button>
            </div>
          </div>
        )}

        {/* ── MERGE MODAL ── */}
        {showMergeModal && (
          <div style={{ position:'fixed', inset:0, zIndex:10003, background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
            <div style={{ background:'rgba(9,14,30,0.98)', border:'1px solid rgba(88,101,242,0.4)', borderRadius:20, padding:'36px 32px', maxWidth:440, width:'100%', textAlign:'center', boxShadow:'0 0 60px rgba(88,101,242,0.2)' }}>
              <div style={{ fontSize:40, marginBottom:16 }}>🔗</div>
              <div style={{ fontFamily:'inherit', fontSize:17, fontWeight:900, letterSpacing:'0.15em', marginBottom:12, textTransform:'uppercase', color:'white' }}>MERGE YOUR ACCOUNTS</div>
              <div style={{ fontFamily:'inherit', fontSize:11, color:'rgba(255,255,255,0.5)', letterSpacing:'0.1em', lineHeight:1.9, textTransform:'uppercase', marginBottom:28 }}>
                YOUR COMMANDER NAME HAS REBEL POINTS.<br/>
                WOULD YOU LIKE TO MERGE THEM INTO YOUR DISCORD ACCOUNT?<br/>
                <span style={{ color:'#fbbf24' }}>THIS CANNOT BE UNDONE.</span>
              </div>
              {mergeResult ? (
                <div style={{ fontFamily:'inherit', fontSize:13, color:'#34d399', letterSpacing:'0.1em', fontWeight:900, textTransform:'uppercase' }}>{mergeResult}</div>
              ) : (
                <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
                  <button
                    onPointerDown={e=>{e.preventDefault(); handleMerge();}}
                    style={{ fontFamily:'inherit', padding:'12px 24px', fontSize:12, fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase', background:'linear-gradient(135deg,#5865F2,#7c3aed)', border:'none', borderRadius:50, color:'white', cursor:'pointer', boxShadow:'0 0 20px rgba(88,101,242,0.4)' }}
                  >⚔️ YES, MERGE POINTS</button>
                  <button
                    onPointerDown={e=>{e.preventDefault(); setShowMergeModal(false);}}
                    style={{ fontFamily:'inherit', padding:'12px 20px', fontSize:12, fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase', background:'transparent', border:'1px solid rgba(255,255,255,0.15)', borderRadius:50, color:'rgba(255,255,255,0.5)', cursor:'pointer' }}
                  >KEEP SEPARATE</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── BUY POINTS MODAL ── */}
        {showBuyModal && (
          <div style={{ position:'fixed', inset:0, zIndex:10000, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }} onPointerDown={e=>{ if(e.target===e.currentTarget) setShowBuyModal(false); }}>
            <div style={{ position:'relative', maxWidth:480, width:'100%' }}>
              <button onPointerDown={()=>setShowBuyModal(false)} style={{ position:'absolute', top:-12, right:-12, zIndex:1, background:'rgba(0,0,0,0.6)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:50, color:'white', width:32, height:32, cursor:'pointer', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
              <BuyPointsModal open={showBuyModal} playerId={effectiveId} onClose={()=>setShowBuyModal(false)} onClaimed={()=>{ setShowBuyModal(false); pts.refresh(); }} />
            </div>
          </div>
        )}

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
              onClick={() => { if ((discordLinked || (profile?.primaryId?.startsWith('name:')))) router.push('/faction-wars'); else { const el = document.getElementById('commander-strip'); el?.scrollIntoView({ behavior:'smooth' }); } }}
              onMouseEnter={() => setCtaHover(true)}
              onMouseLeave={() => setCtaHover(false)}
              style={{
                fontFamily: JP,
                padding:'18px 60px', fontSize:15, fontWeight:900, letterSpacing:'0.2em',
                textTransform:'uppercase', background:'linear-gradient(135deg,#ef4444,#f97316)',
                border:'none', borderRadius:50, color:'white', cursor:'pointer',
                opacity: ctaIn ? ((discordLinked || (profile?.primaryId?.startsWith('name:'))) ? 1 : 0.55) : 0,
                transform: ctaIn ? (ctaHover ? 'translateY(-3px) scale(1.04)' : 'translateY(0) scale(1)') : 'translateY(24px) scale(0.92)',
                transition:'all 0.5s cubic-bezier(0.34,1.56,0.64,1)',
                boxShadow: ctaHover
                  ? '0 0 60px rgba(239,68,68,0.7), 0 0 120px rgba(239,68,68,0.3), 0 8px 32px rgba(0,0,0,0.5)'
                  : '0 0 40px rgba(239,68,68,0.4), 0 0 80px rgba(239,68,68,0.15), 0 4px 16px rgba(0,0,0,0.4)',
              }}
            >{(discordLinked || (profile?.primaryId?.startsWith('name:'))) ? '⚔️  ENTER THE PLAYGROUND' : '⚔️  SET YOUR NAME TO ENTER'}</button>

            <div style={{ position:'absolute', bottom:28, left:'50%', transform:'translateX(-50%)', opacity:0.35, animation:'bounce 2s ease-in-out infinite', fontSize:22 }}>↓</div>
          </div>

          {/* ══ COMMANDER STRIP ══════════════════════════════════════════════════ */}
          <div id="commander-strip" />
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
                {discordLinked ? (
                  <div style={{ fontFamily:'inherit', fontSize:15, fontWeight:900, color:'white', letterSpacing:'0.05em', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:220 }}>
                    {profile?.discordName || profile?.name || 'Commander'}
                  </div>
                ) : profile?.primaryId?.startsWith('name:') ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                    <div style={{ fontFamily:'inherit', fontSize:15, fontWeight:900, color:'#34d399', letterSpacing:'0.05em' }}>{profile.name}</div>
                    <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                      <div style={{ fontFamily:'inherit', fontSize:9, color:'rgba(255,255,255,0.3)', letterSpacing:'0.1em' }}>COMMANDER NAME · PERMANENT</div>
                      <button onPointerDown={e=>{e.preventDefault(); setNameModalMode('setpin'); setPinInput(''); setSignInMsg(''); setShowNameClaim(true);}} style={{ fontFamily:'inherit', fontSize:8, padding:'2px 6px', background:'rgba(251,191,36,0.15)', border:'1px solid rgba(251,191,36,0.3)', borderRadius:4, color:'#fbbf24', cursor:'pointer', letterSpacing:'0.08em' }}>SET PIN</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:8, alignItems:'center' }}>
                    <button
                      onPointerDown={e=>{e.preventDefault(); setNameModalMode('new'); setShowNameClaim(true);}}
                      style={{ fontFamily:'inherit', padding:'9px 18px', fontSize:11, fontWeight:900, letterSpacing:'0.15em', background:'rgba(239,68,68,0.12)', border:'2px solid rgba(239,68,68,0.5)', borderRadius:50, color:'#fca5a5', cursor:'pointer', textTransform:'uppercase', animation:'pulse 2s ease-in-out infinite', whiteSpace:'nowrap', boxShadow:'0 0 14px rgba(239,68,68,0.3)' }}
                    >
                      ⚔️ CLAIM YOUR NAME
                    </button>
                    <button
                      onPointerDown={e=>{e.preventDefault(); setNameModalMode('signin'); setPinInput(''); setSignInMsg(''); setSignInName(''); setShowNameClaim(true);}}
                      style={{ fontFamily:'inherit', padding:'9px 18px', fontSize:11, fontWeight:900, letterSpacing:'0.15em', background:'transparent', border:'2px solid rgba(167,139,250,0.5)', borderRadius:50, color:'#a78bfa', cursor:'pointer', textTransform:'uppercase', animation:'neonPulse 2s ease-in-out infinite', whiteSpace:'nowrap', boxShadow:'0 0 14px rgba(167,139,250,0.25)' }}
                    >
                      🔑 SIGN IN
                    </button>
                  </div>
                )}
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
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center' }}>

                {/* Claim Daily + countdown — countdown is absolute so it doesn't affect button alignment */}
                <div style={{ position:'relative' }}>
                  <button
                    onPointerDown={e=>{e.preventDefault();handleClaimDaily();}}
                    style={{ fontFamily:'inherit', padding:'9px 16px', fontSize:11, fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase', background:'linear-gradient(135deg,#ef4444,#f97316)', border:'none', borderRadius:50, color:'white', cursor:'pointer', whiteSpace:'nowrap' }}
                  >
                    {claimMsg || '⚡ CLAIM DAILY'}
                  </button>
                  {effectiveId && effectiveId !== 'guest' && (
                    <div style={{ position:'absolute', top:'100%', marginTop:3, left:'50%', transform:'translateX(-50%)', fontFamily:'inherit', fontSize:9, letterSpacing:'0.1em', color: dailyClaimed && msUntilClaim > 0 ? 'rgba(255,255,255,0.35)' : '#34d399', textTransform:'uppercase', whiteSpace:'nowrap' }}>
                      {dailyClaimed && msUntilClaim > 0
                        ? `NEXT ${Math.floor(msUntilClaim/3600000)}h ${Math.floor((msUntilClaim%3600000)/60000)}m ${Math.floor((msUntilClaim%60000)/1000)}s`
                        : '⚡ READY'}
                    </div>
                  )}
                </div>

                {/* Buy Points */}
                <button
                  onPointerDown={e=>{e.preventDefault(); setShowBuyModal(true);}}
                  style={{ fontFamily:'inherit', padding:'9px 16px', fontSize:11, fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase', background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:50, color:'white', cursor:'pointer', whiteSpace:'nowrap' }}
                >
                  💎 BUY POINTS
                </button>

                {/* Discord */}
                {discordLinked ? (
                  <button
                    onPointerDown={e=>{e.preventDefault();handleDisconnectDiscord();}}
                    style={{ fontFamily:'inherit', padding:'9px 16px', fontSize:11, fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase', background:'rgba(88,101,242,0.15)', border:'1px solid rgba(88,101,242,0.3)', borderRadius:50, color:'#a5b4fc', cursor:'pointer', whiteSpace:'nowrap' }}
                  >
                    ✓ DISCORD
                  </button>
                ) : (
                  <button
                    onPointerDown={e=>{e.preventDefault();handleConnectDiscord();}}
                    style={{ fontFamily:'inherit', padding:'9px 16px', fontSize:11, fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase', background:'#5865F2', border:'none', borderRadius:50, color:'white', cursor:'pointer', whiteSpace:'nowrap', boxShadow:'0 0 20px rgba(88,101,242,0.4)' }}
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
              FIVE GAMES. ONE UNIVERSE. INFINITE REBEL TO EARN.
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
            <a href="https://discord.gg/DkYTPDz4wM" target="_blank" rel="noopener noreferrer"
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
          @keyframes neonPulse {
            0%,100% { box-shadow: 0 0 12px rgba(167,139,250,0.5), 0 0 24px rgba(167,139,250,0.2); border-color: #a78bfa; color: #a78bfa; }
            50%      { box-shadow: 0 0 24px rgba(167,139,250,0.9), 0 0 48px rgba(167,139,250,0.4); border-color: #c4b5fd; color: #c4b5fd; }
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
