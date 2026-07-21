// ════════════════════════════════════════════════════════════════
//  app.js — AI Battle Trader · Game Logic
//  Constants & config → config.js
//  Styles → style.css
// ════════════════════════════════════════════════════════════════

// ── GAME STATE (single source of truth) ──────────────────────
let state = {
  // Portfolio
  userCash        : 1000,
  userPositions   : {},
  userTradeLog    : [],
  userWins        : 0,
  userLosses      : 0,
  // AI
  aiCash          : 1000,
  aiHoldings      : {},
  aiShorts        : {},
  aiTradeLog      : [],
  aiWins          : 0,
  aiLosses        : 0,
  // Settings
  selectedCoin    : 'BTC',
  tf              : '1m',
  userTradeSize   : 100,
  _sizeKey        : 100,
  _bestValue      : 1000,
  currentLeverage : LEVERAGE_CONFIG.defaultLeverage, // 10
  // Meta
  dailyDate       : new Date().toISOString().split('T')[0],
  battleActive    : true,
  // Tier unlock system (Sepolia gas-based)
  unlockedTiers   : JSON.parse(localStorage.getItem('aiBattle_unlockedTiers')||'[]'),
};

let livePrices={}, candleData={}, liveChanges={};

// ══════════════════════════════════════════════════════
// POINTS SYSTEM — SUPABASE ONLY
// Points Supabase mein store hote hain (wallet address = PK)
// No contract, no gas, no transactions.
// ══════════════════════════════════════════════════════

// ── IST Day Key: resets at 5 AM IST (not UTC midnight) ──
// IST = UTC+5:30; 5 AM IST = 23:30 UTC previous day
// Game "day" starts at 5 AM IST, shifts every 24h
function getISTDayKey(){
  const now = new Date();
  // Shift: add IST offset (+5h30m) then subtract 5h → boundary moves to 5 AM IST
  const shifted = new Date(now.getTime() + (0.5 * 60 * 60 * 1000));
  return shifted.toISOString().split('T')[0];
}

// ms remaining until next 5 AM IST reset (for timer)
function msUntil5AMIST(){
  const now = new Date();
  const istNow = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  const next5am = new Date(istNow);
  next5am.setHours(5, 0, 0, 0);
  if(istNow >= next5am) next5am.setDate(next5am.getDate() + 1);
  return next5am - istNow;
}

// ── LIFETIME POINTS — localStorage + chain sync ──
let lifetimePts = {ai: 0, user: 0};

// ── DAILY POINTS — resets at 5 AM IST each day ──
// Separate from lifetime — leaderboard shows daily pts, profile shows lifetime
let dailyPts = {ai: 0, user: 0, date: getISTDayKey()};

// Load from localStorage on startup (before chain loads)
(function initLifetimePts(){
  // ── ONE-TIME POINTS WIPE (v3) ──
  // AI ke inflated points bug ki wajah se dono ko zero karna tha.
  // Version key check: agar 'aiBattle_pts_v3' nahi hai, toh wipe karo.
  // Yeh sirf ONCE chalega — pehli load pe. Baad mein kabhi nahi.
  const PTS_VER = 'aiBattle_pts_v3';
  if(!localStorage.getItem(PTS_VER)){
    localStorage.removeItem('aiBattle_lifetimePts');
    localStorage.removeItem('aiBattle_dailyPts');
    // Wallet-specific keys bhi wipe
    try{
      Object.keys(localStorage).forEach(k=>{
        if(k.startsWith('aiBattle_pts_')) localStorage.removeItem(k);
      });
    }catch(e){}
    localStorage.setItem(PTS_VER,'1');
    lifetimePts = {ai:0, user:0};
    dailyPts = {ai:0, user:0, date:getISTDayKey()};
    return; // fresh start — no need to load old data
  }

  try{
    const raw = localStorage.getItem('aiBattle_lifetimePts');
    if(raw){ const p=JSON.parse(raw); lifetimePts.ai=p.ai||0; lifetimePts.user=p.user||0; }
  }catch(e){}
  // Load daily pts — reset if IST 5AM day changed
  try{
    const today = getISTDayKey();
    const raw2 = localStorage.getItem('aiBattle_dailyPts');
    if(raw2){
      const d=JSON.parse(raw2);
      if(d.date === today){ dailyPts.ai=d.ai||0; dailyPts.user=d.user||0; dailyPts.date=today; }
      else { dailyPts={ai:0,user:0,date:today}; localStorage.setItem('aiBattle_dailyPts',JSON.stringify(dailyPts)); }
    } else {
      dailyPts={ai:0,user:0,date:today};
    }
  }catch(e){}
})();

function saveLifetimePts(ai, user){
  lifetimePts.ai = ai;
  lifetimePts.user = user;
  // Save to localStorage (keyed globally + by wallet address)
  try{
    localStorage.setItem('aiBattle_lifetimePts', JSON.stringify({ai, user, ts: Date.now()}));
    if(walletAddress){
      const key = 'aiBattle_pts_' + walletAddress.toLowerCase();
      localStorage.setItem(key, JSON.stringify({ai, user, ts: Date.now()}));
    }
  }catch(e){}
}

function saveDailyPts(){
  try{ localStorage.setItem('aiBattle_dailyPts', JSON.stringify(dailyPts)); }catch(e){}
}

// Check daily reset — resets at 5 AM IST
function checkDailyReset(){
  const today = getISTDayKey();
  if(dailyPts.date !== today){
    dailyPts = {ai:0, user:0, date:today};
    saveDailyPts();
  }
  // ── Fund/portfolio daily reset (separate from the points counter above).
  // Previously only dailyPts (the "TODAY" leaderboard counter) reset daily —
  // state.userCash/aiCash never did, so the "daily reset" people expected
  // at 5 AM IST silently never happened for actual balances. ──
  if(state.dailyDate !== today){
    state.userCash = 1000; state.userPositions = {}; state.userTradeLog = [];
    state.userWins = 0; state.userLosses = 0;
    state.currentLeverage = LEVERAGE_CONFIG.defaultLeverage;
    state.dailyDate = today;
    _prevUserPort = 1000; _prevUserWins = 0;
    saveState();
    if(walletAddress && SERVER_AI_MODE) supabaseSaveUserOnly().catch(()=>{});
    // The AI's side resets itself server-side in the Edge Function on its
    // own tick (works even with no tab open) — pollServerAiState() will
    // pick that up automatically on its next poll, no client action needed.
    updateUI();
    notify('🌅 New day! Portfolio reset (5 AM IST). Points carried over.','reward');
  }
}

// ── POINTS FORMULA: % based, hard capped 500 pts per trade ──
// pts = (pnl / tradeSize) * 500 → 1% gain = 5pts, 100% gain = 500pts max
function calcPts(pnl, tradeSize){
  if(!pnl||pnl<=0) return 0;
  const pct = pnl / Math.max(tradeSize, 1);
  // Base pts from % return + bonus for real dollar gain
  const basePts  = Math.max(1, Math.round(pct * 500));
  const dollarPts = Math.floor(Math.sqrt(Math.max(0, pnl))); // $1=$1pt, $4=$2pt, $9=$3pt etc
  return Math.min(500, basePts + dollarPts);
}
// AI gets a 35% points bonus on winning trades — makes AI's score climb faster than user's
function calcAiPts(pnl, tradeSize){
  const base = calcPts(pnl, tradeSize);
  return base>0 ? Math.round(base*1.35) : 0;
}

function addAiPoints(pts){
  if(pts <= 0) return;
  lifetimePts.ai += pts;
  dailyPts.ai += pts;
  saveDailyPts();
  saveLifetimePts(lifetimePts.ai, lifetimePts.user);
}

function addUserPoints(pts){
  if(pts <= 0) return;
  lifetimePts.user += pts;
  dailyPts.user += pts;
  saveDailyPts();
  // Immediately save to localStorage (both global + wallet-specific key)
  saveLifetimePts(lifetimePts.ai, lifetimePts.user);
  updateWalletBadge();
  setTimeout(()=>showClaimPopup(pts), 800);
}

// ══════════════════════════════════════════════
// POINTS WIN NOTIFICATION — Supabase auto-save
// No signature, no transaction, no gas.
// ══════════════════════════════════════════════
let _claimQueue = 0;
let _claimPopupOpen = false;

function showClaimPopup(newPts){
  if(_claimPopupOpen) { _claimQueue += newPts; return; }
  _claimPopupOpen = true;
  const totalPts = lifetimePts.user;
  const wins = state.userWins;

  const d = document.createElement('div');
  d.id = 'claim-popup';
  d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:10005;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease';
  d.innerHTML = `
    <div style="background:var(--bg3);border:2px solid var(--green);border-radius:10px;padding:24px;max-width:340px;width:90%;box-shadow:0 0 30px var(--green)44;text-align:center">
      <div style="font-size:40px;margin-bottom:8px">🏆</div>
      <div style="font-family:'Orbitron',monospace;font-size:15px;font-weight:700;color:var(--green);letter-spacing:2px;margin-bottom:4px">WIN! POINTS EARNED</div>
      <div style="font-family:'Share Tech Mono',monospace;font-size:12px;color:var(--text2);margin-bottom:16px">Auto-saved to cloud ☁️</div>

      <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:6px;padding:12px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-family:'Share Tech Mono',monospace;font-size:11px;color:var(--text2)">NEW POINTS</span>
          <span style="font-family:'Orbitron',monospace;font-size:13px;color:var(--green);font-weight:700">+${newPts} PTS</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-family:'Share Tech Mono',monospace;font-size:11px;color:var(--text2)">TOTAL POINTS</span>
          <span style="font-family:'Orbitron',monospace;font-size:13px;color:var(--amber);font-weight:700">${totalPts} PTS</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-family:'Share Tech Mono',monospace;font-size:11px;color:var(--text2)">TOTAL WINS</span>
          <span style="font-family:'Orbitron',monospace;font-size:13px;color:var(--cyan);font-weight:700">${wins} 🏆</span>
        </div>
        ${walletAddress ? `<div style="display:flex;justify-content:space-between">
          <span style="font-family:'Share Tech Mono',monospace;font-size:11px;color:var(--text2)">WALLET</span>
          <span style="font-family:'Share Tech Mono',monospace;font-size:11px;color:var(--green)">${shortAddr(walletAddress)}</span>
        </div>` : ''}
      </div>

      <button onclick="closeClaim()" style="width:100%;padding:12px;font-family:'Orbitron',monospace;font-size:11px;font-weight:700;letter-spacing:1.5px;border:2px solid var(--green);background:var(--green-dim);color:var(--green);border-radius:6px;cursor:pointer;margin-bottom:8px;transition:all 0.15s" onmouseover="this.style.background='var(--green)';this.style.color='#000'" onmouseout="this.style.background='var(--green-dim)';this.style.color='var(--green)'">
        ✅ AWESOME!
      </button>

      <div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--green);text-align:center;letter-spacing:0.5px">☁️ Saved to Supabase — syncs across all devices</div>
    </div>`;
  document.body.appendChild(d);

  // Auto-save to Supabase immediately (no popup, no gas)
  if(walletAddress) supabaseSave().catch(()=>{});

  // Auto-dismiss after 4 seconds
  setTimeout(()=>{ if(_claimPopupOpen) closeClaim(); }, 4000);
}

function closeClaim(){
  _claimPopupOpen = false;
  const el = document.getElementById('claim-popup');
  if(el) el.remove();
  if(_claimQueue > 0){const q=_claimQueue;_claimQueue=0;setTimeout(()=>showClaimPopup(q),400);}
}

function showClaimConnectPrompt(pts){
  const d = document.createElement('div');
  d.id = 'claim-popup';
  d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:10005;display:flex;align-items:center;justify-content:center';
  d.innerHTML = `
    <div style="background:var(--bg3);border:2px solid var(--amber);border-radius:10px;padding:24px;max-width:320px;width:90%;text-align:center;box-shadow:0 0 30px var(--amber)44">
      <div style="font-size:36px;margin-bottom:8px">🔗</div>
      <div style="font-family:'Orbitron',monospace;font-size:13px;font-weight:700;color:var(--amber);letter-spacing:2px;margin-bottom:8px">CONNECT WALLET TO CLAIM</div>
      <div style="font-family:'Share Tech Mono',monospace;font-size:11px;color:var(--text2);margin-bottom:6px">You earned <span style="color:var(--green);font-weight:700">+${pts} points!</span></div>
      <div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text2);margin-bottom:16px">Connect MetaMask to save points permanently to your wallet address</div>
      <button onclick="closeClaim();showConnectOptions();" style="width:100%;padding:11px;font-family:'Orbitron',monospace;font-size:11px;font-weight:700;border:2px solid var(--amber);background:var(--amber-dim);color:var(--amber);border-radius:6px;cursor:pointer;margin-bottom:8px;letter-spacing:1px">
        🦊 CONNECT & CLAIM
      </button>

    </div>`;
  document.body.appendChild(d);
}

// ══════════════════════════════════════════════
// STATE PERSISTENCE — localStorage + IndexedDB
// Refresh, tab close, sab handle hoga
// ══════════════════════════════════════════════
const DB_NAME='AIBattleDB', DB_STORE='gameState', DB_KEY='main';
let _db=null;
function openDB(){
  return new Promise((res,rej)=>{
    if(_db){res(_db);return;}
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=e=>e.target.result.createObjectStore(DB_STORE);
    req.onsuccess=e=>{_db=e.target.result;res(_db);};
    req.onerror=()=>rej(req.error);
  });
}

function saveState(){
  // Save full game state — positions, cash, trades, wins
  const toSave={
    userCash:state.userCash,
    userPositions:state.userPositions,
    userTradeLog:(state.userTradeLog||[]).slice(0,100),
    userWins:state.userWins,
    userLosses:state.userLosses,
    aiCash:state.aiCash,
    aiHoldings:state.aiHoldings,
    aiShorts:state.aiShorts,
    aiTradeLog:(state.aiTradeLog||[]).slice(0,100),
    aiWins:state.aiWins,
    aiLosses:state.aiLosses,
    dailyDate:state.dailyDate,
    battleActive:state.battleActive,
    selectedCoin:state.selectedCoin,
    userTradeSize:state.userTradeSize,
    _sizeKey:state._sizeKey,
    _bestValue:state._bestValue,
    currentLeverage:state.currentLeverage||LEVERAGE_CONFIG.defaultLeverage,
    ts:Date.now()
  };
  state.ts = toSave.ts; // keep in-memory ts updated
  const data=JSON.stringify(toSave);
  // 1. localStorage (fast, sync)
  try{localStorage.setItem('aiBattleState_v3',data);}catch(e){}
  // 2. IndexedDB (survives tab close)
  openDB().then(db=>{
    db.transaction(DB_STORE,'readwrite').objectStore(DB_STORE).put(data,DB_KEY);
  }).catch(()=>{});
}

function loadSavedState(){
  const today=new Date().toISOString().split('T')[0];
  // Try localStorage first (sync, fast)
  try{
    const raw=localStorage.getItem('aiBattleState_v3');
    if(raw){
      const s=JSON.parse(raw);
      if(s && s.dailyDate===today){
        Object.assign(state,s);
        console.log('[AIBattle] State restored from localStorage');
        return true;
      }
    }
  }catch(e){}
  // Try IndexedDB (async fallback)
  openDB().then(db=>{
    return new Promise((res,rej)=>{
      const req=db.transaction(DB_STORE,'readonly').objectStore(DB_STORE).get(DB_KEY);
      req.onsuccess=()=>res(req.result);
      req.onerror=()=>rej();
    });
  }).then(raw=>{
    if(!raw)return;
    const s=JSON.parse(raw);
    if(s && s.dailyDate===today){
      Object.assign(state,s);
      console.log('[AIBattle] State restored from IndexedDB');
      // Re-render after async load
      setTimeout(updateUI,200);
    }
  }).catch(()=>{});
  return false;
}

// Load on startup
loadSavedState();

// Init size display after state load
setTimeout(()=>{
  const sz=state.userTradeSize||100;
  const disp=document.getElementById('size-display');
  if(disp)disp.textContent=`$${sz}`;
  document.querySelectorAll('.size-btn').forEach(b=>b.classList.remove('active'));
  const key=state._sizeKey||100;
  const idMap={50:'size-50',100:'size-100',250:'size-250',0:'size-max'};
  const el=document.getElementById(idMap[key]);
  if(el)el.classList.add('active');
},100);

function resetBattle(){
  if(!confirm('Reset battle? Portfolio & trades reset honge. Points kabhi reset nahi hote.'))return;
  // Save final state to Supabase before reset
  if(walletAddress) supabaseSave().catch(()=>{});
  // Reset in-memory state
  state.aiCash=1000;state.aiHoldings={};state.aiShorts={};state.aiTradeLog=[];
  state.aiWins=0;state.aiLosses=0;state.battleActive=true;
  state.userCash=1000;state.userPositions={};state.userTradeLog=[];
  state.userWins=0;state.userLosses=0;
  state.currentLeverage=LEVERAGE_CONFIG.defaultLeverage;
  state.dailyDate=new Date().toISOString().split('T')[0];
  COINS.forEach(c=>{delete aiCooldown[c.id];});
  _prevAiPort=1000;_prevUserPort=1000;
  _prevAiWins=0;_prevUserWins=0;
  // ── POINTS ARE NEVER RESET by battle reset ──
  // Daily pts aur lifetime pts dono protected hain.
  // 5 AM IST pe auto-reset hoga daily pts — manually nahi hoga.
  //
  // ── AI's server-side state also needs an explicit reset ──
  // In SERVER_AI_MODE the AI's real balance/positions live in Supabase,
  // not the browser — resetting only `state.aiCash` here is cosmetic and
  // gets silently overwritten by the next pollServerAiState() (runs every
  // ~6s). Call the reset_ai_state RPC so the server row actually resets.
  if(walletAddress && SERVER_AI_MODE){
    fetch(`${SUPA_URL}/rest/v1/rpc/reset_ai_state`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', apikey:SUPA_KEY, Authorization:'Bearer '+SUPA_KEY, Prefer:'return=minimal' },
      body: JSON.stringify({ p_wallet: walletAddress.toLowerCase() })
    }).catch(e=>console.error('[Supabase] reset_ai_state failed:', e));
  }
  // Force DOM reset
  ['ai-wins','user-wins'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent='0';});
  {const e=document.getElementById('ai-points');if(e)e.textContent='$1,000.00';}
  {const e=document.getElementById('user-points');if(e)e.textContent='$1,000.00';}
  const atl=document.getElementById('ai-trade-log');
  if(atl)atl.innerHTML='<div style="color:var(--text2);font-size:11px;text-align:center;padding:8px">Waiting for trades...</div>';
  const uh=document.getElementById('user-holdings');
  if(uh)uh.innerHTML='<div style="color:var(--text2);font-size:11px;text-align:center;padding:8px">No open positions.</div>';
  const aihp=document.getElementById('ai-hp-bar');if(aihp){aihp.style.width='100%';aihp.className='char-hp-bar';}
  const uhp=document.getElementById('user-hp-bar');if(uhp){uhp.style.width='100%';uhp.className='char-hp-bar';}
  updateUI();notify('Battle reset! Portfolio fresh. Points safe. 🔄','reward');
}

const BINANCE='https://api.binance.com/api/v3';
const BINANCE_FAPI='https://fapi.binance.com/fapi/v1';
const FUTURES_ONLY=new Set(['ANTHROPIC']);
function isFutures(symbol){return FUTURES_ONLY.has(symbol.replace('USDT',''));}
async function fetchKlines(symbol,interval,limit=80){
  try{
    const base=isFutures(symbol)?BINANCE_FAPI:BINANCE;
    const res=await fetch(`${base}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    if(!res.ok)throw new Error();
    return (await res.json()).map(k=>({t:k[0],o:parseFloat(k[1]),h:parseFloat(k[2]),l:parseFloat(k[3]),c:parseFloat(k[4])}));
  }catch(e){return generateFallback({BTC:65000,ETH:3200,SOL:140,BNB:580,ANTHROPIC:1670}[symbol.replace('USDT','')]||1000,80);}
}
async function fetchTicker(symbol){
  try{
    const base=isFutures(symbol)?BINANCE_FAPI:BINANCE;
    const res=await fetch(`${base}/ticker/24hr?symbol=${symbol}`);
    if(!res.ok)throw new Error();
    return await res.json();
  }catch(e){return null;}
}
function generateFallback(base,n){
  let p=base;const arr=[];const now=Date.now();
  for(let i=0;i<n;i++){const o=p;const chg=(Math.random()-0.498)*0.008*p;const c=Math.max(p*0.5,p+chg);arr.push({t:now-(n-i)*60000,o,h:Math.max(o,c)*(1+Math.random()*0.003),l:Math.min(o,c)*(1-Math.random()*0.003),c});p=c;}
  return arr;
}

let ws, wsFutures;
let wsReconnectDelay = 2000; // grows on repeated failures, resets on success
function initWs(){
  // Spot WebSocket for non-futures coins
  const spotCoins=COINS.filter(c=>!isFutures(c.symbol));
  const futCoins=COINS.filter(c=>isFutures(c.symbol));
  const streams=spotCoins.map(c=>c.symbol.toLowerCase()+'@ticker').join('/');
  ws=new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
  ws.onopen=()=>{ wsReconnectDelay=2000; }; // connected fine — reset backoff
  ws.onmessage=ev=>{
    const data=JSON.parse(ev.data);
    if(!data?.data?.s)return;
    const coin=COINS.find(c=>c.symbol===data.data.s);
    if(!coin)return;
    const newPrice=parseFloat(data.data.c);
    const newChg=parseFloat(data.data.P);
    livePrices[coin.id]=newPrice;
    liveChanges[coin.id]=newChg;
    // Live update last candle so chart moves in real-time
    const key=coin.id+'_'+state.tf;
    if(candleData[key]&&candleData[key].length>0){
      const last=candleData[key][candleData[key].length-1];
      last.c=newPrice;
      last.h=Math.max(last.h,newPrice);
      last.l=Math.min(last.l,newPrice);
    }
    // Redraw chart + price overlay instantly for selected coin
    if(coin.id===state.selectedCoin){
      drawChart();
      updateTicker();
    }
  };
  ws.onclose=()=>{
    setTimeout(initWs, wsReconnectDelay);
    wsReconnectDelay=Math.min(wsReconnectDelay*2, 30000); // cap at 30s
  };

  // Futures WebSocket for ANTHROPIC and other perp-only coins
  if(futCoins.length>0){
    const futStreams=futCoins.map(c=>c.symbol.toLowerCase()+'@ticker').join('/');
    wsFutures=new WebSocket(`wss://fstream.binance.com/stream?streams=${futStreams}`);
    wsFutures.onmessage=ev=>{
      const data=JSON.parse(ev.data);
      if(!data?.data?.s)return;
      const coin=COINS.find(c=>c.symbol===data.data.s);
      if(!coin)return;
      const newPrice=parseFloat(data.data.c);
      const newChg=parseFloat(data.data.P);
      livePrices[coin.id]=newPrice;
      liveChanges[coin.id]=newChg;
      if(coin.id===state.selectedCoin){
        drawChart();
        updateTicker();
      }
    };
    wsFutures.onopen=()=>{ wsReconnectDelay=2000; };
    wsFutures.onclose=()=>{
      setTimeout(initWs, wsReconnectDelay);
      wsReconnectDelay=Math.min(wsReconnectDelay*2, 30000);
    };
  }
}
initWs();

// ── ANTHROPIC SIMULATED PRICE (not on Binance — perp fiction coin) ──────────
// Correlated with BTC ~60%, random walk every 2s
(function startAnthropicSim(){
  let _base = null; // set once from klines fallback
  let _chgBase = null;
  setInterval(()=>{
    // First run: set base from klines
    if(_base===null){
      _base = livePrices['ANTHROPIC']||1670;
      _chgBase = _base;
    }
    const prev = livePrices['ANTHROPIC']||_base;
    // BTC correlation: if BTC is up 1%, ANTHROPIC nudges +0.6%
    const btcCorr = (liveChanges['BTC']||0)*0.006;
    // Random noise ±0.08%
    const noise = (Math.random()-0.498)*0.0016;
    const delta = prev*(btcCorr*0.001 + noise);
    const newP = Math.max(prev*0.85, Math.min(prev*1.15, prev+delta));
    livePrices['ANTHROPIC'] = newP;
    liveChanges['ANTHROPIC'] = ((newP-_chgBase)/_chgBase)*100;
    // Update last kline candle for chart
    const key='ANTHROPIC_'+state.tf;
    if(candleData[key]&&candleData[key].length>0){
      const last=candleData[key][candleData[key].length-1];
      last.c=newP;last.h=Math.max(last.h,newP);last.l=Math.min(last.l,newP);
    }
    if(state.selectedCoin==='ANTHROPIC'){drawChart();updateTicker();}
    else{updateTicker();}
  },2000);
})();

async function loadAllCandles(){
  for(const coin of COINS){
    const data=await fetchKlines(coin.symbol,state.tf,80);
    if(data){
      candleData[`${coin.id}_${state.tf}`]=data;
      if(!livePrices[coin.id])livePrices[coin.id]=data[data.length-1].c;
    }
  }
}
async function refreshAll(){
  for(const coin of COINS){
    const t=await fetchTicker(coin.symbol);
    if(t){livePrices[coin.id]=parseFloat(t.lastPrice);liveChanges[coin.id]=parseFloat(t.priceChangePercent);}
  }
}

// ---- CHART ----
const canvas=document.getElementById('chart');
const ctx=canvas.getContext('2d');
function drawChart(){
  const W=canvas.offsetWidth||560,H=280;
  canvas.width=W;canvas.height=H;
  const key=`${state.selectedCoin}_${state.tf}`;
  const data=candleData[key]||[];
  const coin=COINS.find(c=>c.id===state.selectedCoin);
  ctx.fillStyle='#0a1018';ctx.fillRect(0,0,W,H);
  if(!data.length){ctx.fillStyle='#607080';ctx.font='13px Share Tech Mono';ctx.textAlign='center';ctx.fillText('Loading...',W/2,H/2);return;}
  const visible=data.slice(-60);
  ctx.strokeStyle='rgba(26,37,53,0.5)';ctx.lineWidth=0.5;
  for(let i=0;i<=4;i++){const y=(i/4)*(H-30)+10;ctx.beginPath();ctx.moveTo(50,y);ctx.lineTo(W-5,y);ctx.stroke();}
  const hi=Math.max(...visible.map(c=>c.h)),lo=Math.min(...visible.map(c=>c.l));
  const rng=hi-lo||lo*0.01||1,pad=12,chartH=H-pad*2-15,chartW=W-55;
  const toY=p=>pad+chartH-((p-lo)/rng)*chartH;
  const toX=i=>52+(i/(Math.max(visible.length-1,1)))*chartW;
  ctx.beginPath();ctx.moveTo(toX(0),toY(visible[0].c));
  visible.forEach((c,i)=>ctx.lineTo(toX(i),toY(c.c)));
  ctx.lineTo(toX(visible.length-1),H-15);ctx.lineTo(toX(0),H-15);ctx.closePath();
  const grad=ctx.createLinearGradient(0,0,0,H);grad.addColorStop(0,coin.color+'38');grad.addColorStop(1,'transparent');
  ctx.fillStyle=grad;ctx.fill();
  const cw=Math.max(2,Math.floor(chartW/visible.length*0.7));
  visible.forEach((c,i)=>{
    const x=toX(i),isGreen=c.c>=c.o,col=isGreen?'#00ff88':'#ff3355';
    ctx.strokeStyle=col;ctx.lineWidth=0.8;ctx.beginPath();ctx.moveTo(x,toY(c.h));ctx.lineTo(x,toY(c.l));ctx.stroke();
    ctx.fillStyle=col;const top=toY(Math.max(c.o,c.c)),bot=toY(Math.min(c.o,c.c));ctx.fillRect(x-cw/2,top,cw,Math.max(1,bot-top));
  });
  ctx.fillStyle='#3a5070';ctx.font='10px monospace';ctx.textAlign='right';
  for(let i=0;i<=4;i++){const p=lo+(i/4)*rng;ctx.fillText('$'+fmtPrice(p,coin),48,toY(p)+3);}
  const cur=visible[visible.length-1].c,first=visible[0].o;
  ctx.strokeStyle=coin.color+'55';ctx.lineWidth=0.5;ctx.setLineDash([4,3]);
  ctx.beginPath();ctx.moveTo(50,toY(cur));ctx.lineTo(W,toY(cur));ctx.stroke();ctx.setLineDash([]);
  const chg=((cur-first)/first)*100;
  document.getElementById('chart-price').textContent='$'+fmtPrice(cur,coin);
  document.getElementById('chart-price').style.color=chg>=0?'#00ff88':'#ff3355';
  document.getElementById('chart-change').textContent=(chg>=0?'+':'')+chg.toFixed(2)+'%';
  document.getElementById('chart-change').style.color=chg>=0?'#00ff88':'#ff3355';
  document.getElementById('chart-name').textContent=state.selectedCoin+'/USDT';

  // ── LIVE P&L OVERLAY on chart ───────────────────────────────
  const curPrice = livePrices[state.selectedCoin];
  if(curPrice){
    const aiH = state.aiHoldings[state.selectedCoin];
    const aiS = (state.aiShorts||{})[state.selectedCoin];
    const uPos = state.userPositions&&state.userPositions[state.selectedCoin];
    let overlayLines = [];

    if(aiH&&aiH.qty>1e-6){
      const pnl=(curPrice-aiH.avgCost)*aiH.qty;
      const pct=(curPrice-aiH.avgCost)/aiH.avgCost*100;
      const lev=aiH.leverage||5;
      const col=pnl>=0?'#00ff88':'#ff4455';
      overlayLines.push({text:`🤖 LONG ${state.selectedCoin} ${lev}x  ${pnl>=0?'+':''}$${pnl.toFixed(2)} (${pct>=0?'+':''}${pct.toFixed(2)}%)`, color:col});
    }
    if(aiS&&aiS.qty>1e-6){
      const pnl=(aiS.entryPrice-curPrice)*aiS.qty;
      const pct=(aiS.entryPrice-curPrice)/aiS.entryPrice*100;
      const lev=aiS.leverage||5;
      const col=pnl>=0?'#00ff88':'#ff4455';
      overlayLines.push({text:`🤖 SHORT ${state.selectedCoin} ${lev}x  ${pnl>=0?'+':''}$${pnl.toFixed(2)} (${pct>=0?'+':''}${pct.toFixed(2)}%)`, color:col});
    }
    if(uPos&&uPos.qty>1e-6){
      const isLong=uPos.side==='long';
      const pnl=isLong?(curPrice-uPos.avgCost)*uPos.qty:(uPos.entryPrice-curPrice)*uPos.qty;
      const base=isLong?uPos.avgCost:uPos.entryPrice;
      const pct=isLong?(curPrice-base)/base*100:(base-curPrice)/base*100;
      const lev=uPos.leverage||1;
      const col=pnl>=0?'#00ccff':'#ffaa00';
      overlayLines.push({text:`👤 ${isLong?'LONG':'SHORT'} ${state.selectedCoin} ${lev}x  ${pnl>=0?'+':''}$${pnl.toFixed(2)} (${pct>=0?'+':''}${pct.toFixed(2)}%)`, color:col});
    }

    if(overlayLines.length){
      ctx.save();
      ctx.font='bold 11px "Share Tech Mono",monospace';
      overlayLines.forEach((line,i)=>{
        const x=8, y=H-10-(overlayLines.length-1-i)*18;
        ctx.fillStyle='rgba(0,0,0,0.55)';
        const tw=ctx.measureText(line.text).width;
        ctx.fillRect(x-3,y-11,tw+8,15);
        ctx.fillStyle=line.color;
        ctx.fillText(line.text,x,y);
      });
      ctx.restore();
    }
  }
}

// ---- INDICATORS (advanced multi-signal) ----
function calcIndicators(closes){
  if(closes.length<20)return null;
  const n=closes.length;
  const ma7=closes.slice(-7).reduce((a,b)=>a+b,0)/7;
  const ma20=closes.slice(-20).reduce((a,b)=>a+b,0)/20;
  // Wilder's RSI (proper)
  const period=14;
  const slice=closes.slice(Math.max(0,n-period-1));
  let avgGain=0,avgLoss=0;
  for(let i=1;i<slice.length;i++){const d=slice[i]-slice[i-1];if(d>0)avgGain+=d;else avgLoss+=Math.abs(d);}
  avgGain/=period;avgLoss=(avgLoss/period)||0.001;
  const rsi=100-(100/(1+avgGain/avgLoss));
  const price=closes[n-1];
  const momentum=n>=6?((price-closes[n-6])/closes[n-6])*100:0;
  const trend=price>ma7&&ma7>ma20?'BULL':'BEAR';
  // Signal scoring
  let bull=0,bear=0;
  if(rsi<30)bull+=3;else if(rsi<42)bull+=1;
  if(rsi>70)bear+=3;else if(rsi>58)bear+=1;
  if(trend==='BULL')bull+=2;else bear+=2;
  if(momentum>0.25)bull+=1;if(momentum<-0.25)bear+=1;
  if(price>ma20)bull+=1;else bear+=1;
  let signal='NEUTRAL';
  if(bull>=5)signal='STRONG_BUY';else if(bull>=3)signal='BUY';
  else if(bear>=5)signal='STRONG_SELL';else if(bear>=3)signal='SELL';
  return{ma7,ma20,rsi,price,trend,momentum,signal,bull,bear};
}
function updateAISignal(){
  const box=document.getElementById('ai-signal-box'),txt=document.getElementById('ai-signal-text');
  if(!box||!txt)return;

  // ★ Use same getMarketRegime() that AI actually uses — no more display/logic mismatch
  const mkt=getMarketRegime();

  // Selected coin RSI for extra info — filter contradicting signals
  const selData=candleData[`${state.selectedCoin}_${state.tf}`];
  let selStr='';
  if(selData&&selData.length>=30){
    const ind=calcAdvancedIndicators(selData,higherTFData[state.selectedCoin]);
    if(ind){
      const regimeBull=mkt.regime==='STRONG_BULL'||mkt.regime==='BULL';
      const regimeBear=mkt.regime==='STRONG_BEAR'||mkt.regime==='BEAR';
      const sigBear=ind.trend_signal==='STRONG_SELL'||ind.trend_signal==='SELL';
      const sigBull=ind.trend_signal==='STRONG_BUY'||ind.trend_signal==='BUY';
      // Show ⚠️MIXED if individual coin signal contradicts overall market regime
      const contradicts=(regimeBull&&sigBear)||(regimeBear&&sigBull);
      const dispSig=contradicts?`⚠️MIXED(${ind.trend_signal})`:ind.trend_signal;
      selStr=` | ${dispSig} RSI:${ind.rsi.toFixed(0)} ADX:${ind.adx.toFixed(0)}`;
    }
  }

  // Live change summary
  const chgStr=COINS.map(c=>{
    const chg=liveChanges[c.id]||0;
    return `${c.id}:${chg>=0?'+':''}${chg.toFixed(1)}%`;
  }).join(' ');

  // ★ Show what AI is BLOCKED from doing
  const hardBlockShort=mkt.regime==='STRONG_BULL'||mkt.regime==='BULL';
  const hardBlockLong =mkt.regime==='STRONG_BEAR'||mkt.regime==='BEAR';
  const blockStr=hardBlockShort?' 🚫SHORT':hardBlockLong?' 🚫LONG':'';

  const regimeIcons={'STRONG_BULL':'🟢','BULL':'🟢','STRONG_BEAR':'🔴','BEAR':'🔴','CHOP':'⚪'};
  const isBullMkt=mkt.regime==='STRONG_BULL'||mkt.regime==='BULL'?true:
                  mkt.regime==='STRONG_BEAR'||mkt.regime==='BEAR'?false:null;

  box.className='ai-signal-box'+(isBullMkt===false?' bearish':isBullMkt===null?' neutral':'');
  txt.className='signal-text'+(isBullMkt===false?' bearish':isBullMkt===null?' neutral':'');
  txt.textContent=`${regimeIcons[mkt.regime]||'⚪'} ${mkt.regime} (${mkt.bullC}↑/${mkt.bearC}↓)${blockStr}${selStr}`;
  txt.title=chgStr;
}

// ════════════════════════════════════════════════════════════════
// AI TRADING ENGINE v3 — Multi-signal, ADX regime, HTF filter,
// Confidence scoring, User behaviour adaptation
// Target: 55-60% win rate, more trades, smarter exits
// ════════════════════════════════════════════════════════════════
const aiCooldown={};
let _lastAITradeTime = Date.now(); // Track when AI last made a trade
const aiTrailingStop={};

// ── Higher-timeframe candle cache (1h) ──
let higherTFData={};
async function loadHigherTFCandles(){
  for(const coin of COINS){
    try{
      const data=await fetchKlines(coin.symbol,'1h',60);
      if(data&&data.length>10) higherTFData[coin.id]=data;
    }catch(e){}
  }
}
setTimeout(loadHigherTFCandles,6000);
setInterval(loadHigherTFCandles,4*60*1000);

// ── Order book imbalance cache (extra confirmation for AI entries) ──
// ratio = bid depth / (bid+ask depth) over top 20 levels. >0.5 = buy-side heavier (bullish),
// <0.5 = sell-side heavier (bearish). Entry gates below fail OPEN (never block a trade) when
// this data is missing, stale, or the request errors — this is a confirmation layer only,
// never a requirement, so a Binance hiccup can't silently stop the AI from trading.
let orderBookImbalance={};
async function loadOrderBookImbalance(){
  for(const coin of COINS){
    try{
      const base=isFutures(coin.symbol)?BINANCE_FAPI:BINANCE;
      const res=await fetch(`${base}/depth?symbol=${coin.symbol}&limit=20`);
      if(!res.ok)throw new Error();
      const d=await res.json();
      const bidVol=(d.bids||[]).reduce((s,b)=>s+parseFloat(b[1]),0);
      const askVol=(d.asks||[]).reduce((s,a)=>s+parseFloat(a[1]),0);
      if(bidVol+askVol>0) orderBookImbalance[coin.id]={ratio:bidVol/(bidVol+askVol), ts:Date.now()};
    }catch(e){} // leave previous cached value in place; gates fail open on stale/missing data anyway
  }
}
setTimeout(loadOrderBookImbalance,8000);
setInterval(loadOrderBookImbalance,15000);

// ── User behaviour tracker: adapt AI aggression to user patterns ──
const userBehaviourModel={
  recentWins:0, recentLosses:0, avgHoldSec:0, preferShorts:false,
  update(){
    const log=(state.userTradeLog||[]).slice(0,20);
    if(!log.length)return;
    const closed=log.filter(t=>t.type==='sell'||t.type==='short_closed');
    this.recentWins=closed.filter(t=>t.pnl>0).length;
    this.recentLosses=closed.filter(t=>t.pnl<=0).length;
    this.preferShorts=log.filter(t=>t.type==='short').length > log.filter(t=>t.type==='buy').length;
    // If user is winning a lot — AI gets more aggressive / competitive
  },
  // Returns aggression multiplier 0.8-1.4
  aggressionMult(){
    this.update();
    const wr=this.recentWins/(this.recentWins+this.recentLosses+0.1);
    if(wr>0.65) return 1.35; // user crushing it — AI goes harder
    if(wr>0.5)  return 1.15;
    if(wr<0.35) return 0.85; // user struggling — AI plays safe
    return 1.0;
  }
};

// ── Core indicator engine ──
function calcAdvancedIndicators(candles, htfCandles=null){
  if(!candles||candles.length<30)return null;
  const closes=candles.map(c=>c.c);
  const highs =candles.map(c=>c.h);
  const lows  =candles.map(c=>c.l);
  const n=closes.length;
  const price=closes[n-1];

  // ── EMA helper ──
  function ema(arr,p){
    const k=2/(p+1);
    let e=arr.slice(0,p).reduce((a,b)=>a+b,0)/p;
    for(let i=p;i<arr.length;i++)e=arr[i]*k+e*(1-k);
    return e;
  }

  const ema9 =ema(closes,9);
  const ema21=ema(closes,21);
  const ema50=closes.length>=50 ? ema(closes,50) : ema(closes,closes.length); // fix: pass full array
  const ema8 =ema(closes,8);   // fast entry trigger
  const ema13=ema(closes,13);  // mid confirmation

  // ── RSI(14) Wilder ──
  const rsiSlice=closes.slice(-15);
  let rg=0,rl=0;
  for(let i=1;i<rsiSlice.length;i++){const d=rsiSlice[i]-rsiSlice[i-1];if(d>0)rg+=d;else rl+=Math.abs(d);}
  rg/=14; rl=(rl/14)||0.001;
  const rsi=100-(100/(1+rg/rl));

  // ── RSI divergence: price makes higher high but RSI doesn't ──
  const rsiSlice5=closes.slice(-5);
  let rg5=0,rl5=0;
  for(let i=1;i<rsiSlice5.length;i++){const d=rsiSlice5[i]-rsiSlice5[i-1];if(d>0)rg5+=d;else rl5+=Math.abs(d);}
  rg5/=4; rl5=(rl5/4)||0.001;
  const rsi5=100-(100/(1+rg5/rl5));
  const bearDiverg=price>closes[n-5]&&rsi5<rsi-3;  // hidden bearish divergence
  const bullDiverg=price<closes[n-5]&&rsi5>rsi+3;  // hidden bullish divergence

  // ── MACD (12,26,9) + histogram ──
  const macdLine=ema(closes,12)-ema(closes,26);
  const sigLine =ema(closes.slice(-9).map((_,i)=>ema(closes.slice(0,n-8+i),12)-ema(closes.slice(0,n-8+i),26)),9);
  const macdHist=macdLine-sigLine;
  const macdCross=macdLine>sigLine;
  // MACD histogram expanding = momentum building
  const macdExpBull=n>1&&macdHist>0&&macdHist>((closes[n-2]-closes[n-3])||0)*0.001;
  const macdExpBear=n>1&&macdHist<0&&Math.abs(macdHist)>0.0001;

  // ── ADX (14) — Wilder Smoothed, proper implementation ──
  const adxPeriod=14;
  const dmArr=[];
  for(let i=1;i<n;i++){
    const upMove  =highs[i]-highs[i-1];
    const downMove=lows[i-1]-lows[i];
    const plusDM_i =upMove>downMove&&upMove>0?upMove:0;
    const minusDM_i=downMove>upMove&&downMove>0?downMove:0;
    const tr_i=Math.max(highs[i]-lows[i],Math.abs(highs[i]-closes[i-1]),Math.abs(lows[i]-closes[i-1]));
    dmArr.push({p:plusDM_i,m:minusDM_i,tr:tr_i});
  }
  // Seed with first 14 bars sum
  const seed=dmArr.slice(0,adxPeriod);
  let smP=seed.reduce((s,d)=>s+d.p,0);
  let smM=seed.reduce((s,d)=>s+d.m,0);
  let smTR=seed.reduce((s,d)=>s+d.tr,0);
  const dxArr=[];
  for(let i=adxPeriod;i<dmArr.length;i++){
    smP = smP - smP/adxPeriod + dmArr[i].p;
    smM = smM - smM/adxPeriod + dmArr[i].m;
    smTR= smTR- smTR/adxPeriod+ dmArr[i].tr;
    const pDI=(smTR>0?smP/smTR:0)*100;
    const mDI=(smTR>0?smM/smTR:0)*100;
    const dx=(pDI+mDI>0?Math.abs(pDI-mDI)/(pDI+mDI):0)*100;
    dxArr.push({dx,pDI,mDI});
  }
  // ADX = Wilder smooth of DX
  let adx=dxArr.length>0?dxArr.slice(0,Math.min(adxPeriod,dxArr.length)).reduce((s,d)=>s+d.dx,0)/Math.min(adxPeriod,dxArr.length):20;
  for(let i=adxPeriod;i<dxArr.length;i++) adx = (adx*(adxPeriod-1)+dxArr[i].dx)/adxPeriod;
  const lastDM=dxArr[dxArr.length-1]||{pDI:25,mDI:25};
  const plusDI =lastDM.pDI;
  const minusDI=lastDM.mDI;
  const trendingMarket=adx>22;
  const strongTrend   =adx>30;
  const adxBull=plusDI>minusDI;

  // ── ATR(14) ──
  let atr=0;
  for(let i=Math.max(1,n-14);i<n;i++)
    atr+=Math.max(highs[i]-lows[i],Math.abs(highs[i]-closes[i-1]),Math.abs(lows[i]-closes[i-1]));
  atr/=14;
  const atrPct=(atr/price)*100;

  // ── Stochastic RSI (fast momentum filter) ──
  const rsiArr=[];
  for(let i=n-14;i<n;i++){
    const sl2=closes.slice(Math.max(0,i-13),i+1);
    let g2=0,l2=0;
    for(let j=1;j<sl2.length;j++){const d2=sl2[j]-sl2[j-1];if(d2>0)g2+=d2;else l2+=Math.abs(d2);}
    g2/=14;l2=(l2/14)||0.001;
    rsiArr.push(100-(100/(1+g2/l2)));
  }
  const rsiMax=Math.max(...rsiArr),rsiMin=Math.min(...rsiArr);
  const stochRSI=(rsi-rsiMin)/(rsiMax-rsiMin+0.001)*100;
  const stochOversold =stochRSI<20;
  const stochOverbought=stochRSI>80;

  // ── HTF trend (1h candles, if available) ──
  let htfTrend=0; // 1=up, -1=down, 0=neutral
  let htfADX=0;
  if(htfCandles&&htfCandles.length>20){
    const htfC=htfCandles.map(c=>c.c);
    const htfH=htfCandles.map(c=>c.h);
    const htfL=htfCandles.map(c=>c.l);
    const htfN=htfC.length;
    const htfEma20=ema(htfC,20);
    const htfEma50=ema(htfC,Math.min(50,htfN-1));
    const lastHtf=htfC[htfN-1];
    if(lastHtf>htfEma20&&htfEma20>htfEma50) htfTrend=1;
    else if(lastHtf<htfEma20&&htfEma20<htfEma50) htfTrend=-1;
    // HTF ADX
    let hUp=0,hDn=0,hTr=0;
    for(let i=Math.max(1,htfN-14);i<htfN;i++){
      const um=htfH[i]-htfH[i-1],dm=htfL[i-1]-htfL[i];
      hUp+=um>dm&&um>0?um:0; hDn+=dm>um&&dm>0?dm:0;
      hTr+=Math.max(htfH[i]-htfL[i],Math.abs(htfH[i]-htfC[i-1]),Math.abs(htfL[i]-htfC[i-1]));
    }
    const htr14=hTr/14||0.001;
    const hPDI=(hUp/14)/htr14*100, hMDI=(hDn/14)/htr14*100;
    htfADX=Math.abs(hPDI-hMDI)/(hPDI+hMDI+0.001)*100;
  }

  // ── Candle patterns ──
  const prev=candles[n-2],last=candles[n-1];
  const lastBody=Math.abs(last.c-last.o);
  const prevBody=Math.abs(prev.c-prev.o);
  const bullEngulf=last.c>last.o&&last.c>prev.o&&last.o<prev.c&&lastBody>prevBody*1.1;
  const bearEngulf=last.c<last.o&&last.c<prev.o&&last.o>prev.c&&lastBody>prevBody*1.1;
  // Hammer / shooting star
  const lowerWick=Math.min(last.o,last.c)-last.l;
  const upperWick=last.h-Math.max(last.o,last.c);
  const hammer  =lowerWick>lastBody*2&&upperWick<lastBody*0.5&&last.c>last.o;
  const shootStar=upperWick>lastBody*2&&lowerWick<lastBody*0.5&&last.c<last.o;
  // 3-candle trend confirmation
  const bullMomentum3=candles[n-3].c<candles[n-2].c&&candles[n-2].c<last.c;
  const bearMomentum3=candles[n-3].c>candles[n-2].c&&candles[n-2].c>last.c;

  // ── Volume proxy ──
  const bodies10=candles.slice(-10).map(c=>Math.abs(c.c-c.o));
  const avgBody=bodies10.reduce((a,b)=>a+b,0)/10;
  const highVolume=lastBody>avgBody*1.3;
  const veryHighVol=lastBody>avgBody*1.8;

  // ── VWAP proxy (20 bars) ──
  const slice20=candles.slice(-20);
  const vwap=slice20.reduce((s,c)=>s+(c.h+c.l+c.c)/3,0)/20;
  const aboveVwap=price>vwap;
  const belowVwap=price<vwap;

  // ── EMA squeeze / breakout ──
  const atrArr=candles.slice(-20).map((_,i,a)=>i>0?
    Math.max(a[i].h-a[i].l,Math.abs(a[i].h-a[i-1].c),Math.abs(a[i].l-a[i-1].c)):a[i].h-a[i].l);
  const atrAvg20=atrArr.reduce((a,b)=>a+b,0)/20;
  const breakout=atr>atrAvg20*1.4;

  // ── Trend classification ──
  const bullTrend=price>ema9&&ema9>ema21&&ema21>ema50;
  const bearTrend=price<ema9&&ema9<ema21&&ema21<ema50;
  const weakBull =price>ema21&&ema9>ema21;
  const weakBear =price<ema21&&ema9<ema21;
  const roc10    =n>=11?((price-closes[n-11])/closes[n-11])*100:0;
  const momStrong=Math.abs(roc10)>0.5;

  // ── CONFIDENCE SCORE (0-20) ──
  // Bull confidence
  let bull=0;
  if(bullTrend)bull+=4; else if(weakBull)bull+=2;
  if(trendingMarket&&adxBull) bull+=3; else if(trendingMarket) bull+=1;
  if(htfTrend===1) bull+=3;  // HTF alignment = powerful
  if(rsi<35)bull+=2; else if(rsi<45)bull+=1;
  if(macdCross)bull+=2; if(macdExpBull)bull+=1;
  if(stochOversold)bull+=2;
  if(bullEngulf)bull+=2; if(hammer)bull+=2;
  if(bullMomentum3)bull+=1;
  if(roc10>0.3)bull+=1;
  if(highVolume&&last.c>last.o)bull+=1;
  if(aboveVwap)bull+=1;
  if(breakout&&bullTrend)bull+=2;
  if(bullDiverg)bull+=2;
  if(strongTrend&&adxBull)bull+=1;

  // Bear confidence
  let bear=0;
  if(bearTrend)bear+=4; else if(weakBear)bear+=2;
  if(trendingMarket&&!adxBull)bear+=3; else if(trendingMarket)bear+=1;
  if(htfTrend===-1)bear+=3;
  if(rsi>65)bear+=2; else if(rsi>55)bear+=1;
  if(!macdCross)bear+=2; if(macdExpBear)bear+=1;
  if(stochOverbought)bear+=2;
  if(bearEngulf)bear+=2; if(shootStar)bear+=2;
  if(bearMomentum3)bear+=1;
  if(roc10<-0.3)bear+=1;
  if(highVolume&&last.c<last.o)bear+=1;
  if(belowVwap)bear+=1;
  if(breakout&&bearTrend)bear+=2;
  if(bearDiverg)bear+=2;
  if(strongTrend&&!adxBull)bear+=1;

  // ── Signal classification ──
  let trend_signal='NEUTRAL';
  if(bull>=8)trend_signal='STRONG_BUY';
  else if(bull>=5)trend_signal='BUY';   // was 6 — slightly easier to trigger
  else if(bear>=8)trend_signal='STRONG_SELL';
  else if(bear>=5)trend_signal='SELL';  // was 6

  // ── Support / Resistance zones ──
  // Same logic as the Edge Function: find local swing highs/lows over the
  // window, then flag if price is currently right up against the nearest
  // one — this is what lets entries avoid buying into a ceiling or
  // shorting into a floor (the repeated whipsaw pattern seen in the logs).
  const swingHighs=[], swingLows=[];
  for(let i=2;i<n-2;i++){
    if(highs[i]>highs[i-1]&&highs[i]>highs[i-2]&&highs[i]>highs[i+1]&&highs[i]>highs[i+2])swingHighs.push(highs[i]);
    if(lows[i]<lows[i-1]&&lows[i]<lows[i-2]&&lows[i]<lows[i+1]&&lows[i]<lows[i+2])swingLows.push(lows[i]);
  }
  const resistanceAbove=swingHighs.filter(h=>h>price).sort((a,b)=>a-b)[0]||null;
  const supportBelow=swingLows.filter(l=>l<price).sort((a,b)=>b-a)[0]||null;
  const distToResistancePct=resistanceAbove?(resistanceAbove-price)/price*100:null;
  const distToSupportPct=supportBelow?(price-supportBelow)/price*100:null;
  const nearResistance=distToResistancePct!==null&&distToResistancePct<Math.max(atrPct,0.15);
  const nearSupport=distToSupportPct!==null&&distToSupportPct<Math.max(atrPct,0.15);

  return{
    ema8,ema9,ema13,ema21,ema50,rsi,stochRSI,stochOversold,stochOverbought,
    macdLine,sigLine,macdHist,macdCross,macdExpBull,macdExpBear,
    adx,plusDI,minusDI,trendingMarket,strongTrend,adxBull,
    htfTrend,htfADX,
    atr,atrPct,bullTrend,bearTrend,weakBull,weakBear,
    bullEngulf,bearEngulf,hammer,shootStar,bullMomentum3,bearMomentum3,
    bullDiverg,bearDiverg,highVolume,veryHighVol,
    aboveVwap,belowVwap,breakout,vwap,
    roc10,momStrong,trend_signal,bull,bear,price,
    nearResistance,nearSupport,distToResistancePct,distToSupportPct
  };
}

// ── GLOBAL REGIME: Candle indicators PRIMARY, 24h change as minor tiebreaker ──
function getMarketRegime(){
  let bullC=0,bearC=0,trendingC=0;
  const inds={};

  // 24h change — used as tiebreaker when candles are neutral
  let liveUp=0, liveDn=0;
  for(const coin of COINS){
    const chg=liveChanges[coin.id]||0;
    if(chg>0.8) liveUp++;       // coin is up >0.8% today = bullish context
    else if(chg<-0.8) liveDn++; // coin is down >0.8% today = bearish context
  }
  const liveBullContext = liveUp >= Math.ceil(COINS.length*0.5); // 50%+ coins up today
  const liveBearContext = liveDn >= Math.ceil(COINS.length*0.5); // 50%+ coins down today

  for(const coin of COINS){
    const data=candleData[`${coin.id}_${state.tf}`];
    if(!data||data.length<30)continue;
    const ind=calcAdvancedIndicators(data,higherTFData[coin.id]);
    if(!ind)continue;
    inds[coin.id]=ind;
    if(ind.trendingMarket)trendingC++;

    const lchg=liveChanges[coin.id]||0;
    const candleBull = ind.bullTrend || ind.weakBull;
    const candleBear = ind.bearTrend || ind.weakBear;

    let isBull, isBear;
    if(candleBull && !candleBear){
      isBull=true; isBear=false;
    } else if(candleBear && !candleBull){
      // Candle says bear — but if 24h is strongly positive, downgrade to neutral
      if(lchg > 1.5){ isBull=false; isBear=false; } // short-term pullback in bull day
      else { isBull=false; isBear=true; }
    } else {
      // Neutral candles — use RSI + 24h change + recent candle direction
      const lastC=data[data.length-1], prevC=data[data.length-2];
      const recentDown = lastC&&prevC&&lastC.c<prevC.c;
      const recentUp   = lastC&&prevC&&lastC.c>prevC.c;
      // 24h change as primary tiebreaker in neutral candle situation
      if(lchg > 1.0 && (ind.rsi>40||recentUp))      { isBull=true;  isBear=false; }
      else if(lchg < -1.0 && (ind.rsi<60||recentDown)){ isBull=false; isBear=true; }
      else {
        isBull = ind.rsi>55 && recentUp;
        isBear = ind.rsi<45 && recentDown;
      }
    }
    if(isBull&&!isBear) bullC++;
    else if(isBear&&!isBull) bearC++;
  }

  const total=COINS.length||4;
  const bullPct=bullC/total, bearPct=bearC/total;

  // Regime — candle-based primary, but 24h context prevents false extremes
  // e.g. STRONG_BEAR blocked if 60%+ coins are up today
  let regime=
    bullPct>=0.65?'STRONG_BULL':
    bullPct>=0.4&&bearPct<0.25?'BULL':
    bearPct>=0.65?'STRONG_BEAR':
    bearPct>=0.4&&bullPct<0.25?'BEAR':'CHOP';

  // Sanity check: don't call STRONG_BEAR when market is broadly up today (and vice versa)
  if(regime==='STRONG_BEAR' && liveBullContext) regime='BEAR';
  if(regime==='STRONG_BULL' && liveBearContext) regime='BULL';
  // ★ FIX: Also prevent BULL/BEAR when 24h context clearly contradicts 1M candles
  if(regime==='BULL' && liveBearContext) regime='CHOP';  // 60%+ coins down today — don't go LONG
  if(regime==='BEAR' && liveBullContext) regime='CHOP';  // 60%+ coins up today — don't go SHORT

  return{regime,bullC,bearC,trendingC,inds,
    allUp:bullC===total,
    allDown:bearC===total,
    isChop:regime==='CHOP'};
}

// ── SELF-LEARNING: AI analyses own trade history every 30s ──
// ══════════════════════════════════════════════════════════════════
// AI BRAIN v2 — Coin-wise Reinforcement Learning
// ══════════════════════════════════════════════════════════════════
const aiMemory = {

  // ── Per-coin stats (populated by learnFromHistory) ──
  coinStats: {},
  // coinStats[coinId] = {
  //   longWins, longLosses, shortWins, shortLosses,
  //   totalPnl, avgPnl, preference (0-1), lastUpdated
  // }

  // ── Global stats ──
  winRateLong:  0.5,
  winRateShort: 0.5,
  totalTrades:  0,
  tradesSinceAdjust: 0,  // resets every 20-30 trades → trigger strategy adjust

  // ── Strategy weights (self-adjusting) ──
  // Each multiplies its indicator's contribution to entry score
  strategyWeights: {
    rsi:        1.0,  // RSI signal weight
    macd:       1.0,  // MACD signal weight
    volume:     1.0,  // Volume confirmation weight
    pattern:    1.0,  // Candle pattern weight (engulf, hammer, etc.)
    htf:        1.0,  // Higher timeframe alignment weight
    adx:        1.0,  // ADX trend strength weight
  },

  // ── Mood system ──
  mood: 'NEUTRAL',  // CONFIDENT | CAUTIOUS | REVENGE | NEUTRAL
  moodUpdatedAt: 0,

  // ── Best/worst performing regime ──
  regimeStats: {},
  // regimeStats[regime] = { wins, losses, totalPnl }

  // ════════════════════════════════════════════════════════════
  // CORE: Learn from full trade history every 30s
  // ════════════════════════════════════════════════════════════
  learnFromHistory() {
    const log = (state.aiTradeLog || []).filter(t => t.pnl !== null && t.pnl !== undefined);
    if (log.length < 3) return;

    // ── 1. Coin-wise stats ──
    const newCoinStats = {};
    for (const t of log) {
      const id = t.coin;
      if (!id) continue;
      if (!newCoinStats[id]) {
        newCoinStats[id] = { longWins:0, longLosses:0, shortWins:0, shortLosses:0, totalPnl:0, trades:0 };
      }
      const cs = newCoinStats[id];
      cs.totalPnl += (t.pnl || 0);
      cs.trades++;
      const isLong  = t.type === 'sell';
      const isShort = t.type === 'short_closed';
      if (t.pnl > 0) { if (isLong) cs.longWins++;  else if (isShort) cs.shortWins++;  }
      else            { if (isLong) cs.longLosses++; else if (isShort) cs.shortLosses++; }
    }
    // Compute per-coin win rate & preference score (0=avoid, 1=prefer)
    for (const [id, cs] of Object.entries(newCoinStats)) {
      const totalW = cs.longWins + cs.shortWins;
      const totalL = cs.longLosses + cs.shortLosses;
      const total  = totalW + totalL;
      const wr     = total > 0 ? totalW / total : 0.5;
      const avgPnl = cs.trades > 0 ? cs.totalPnl / cs.trades : 0;
      // Preference: 60% win rate weight + 40% avg pnl (normalized, capped)
      const pnlScore = Math.max(-1, Math.min(1, avgPnl / 5)); // $5 avg = full score
      cs.winRate   = wr;
      cs.avgPnl    = avgPnl;
      cs.preference = Math.max(0, Math.min(1, (wr - 0.3) * 1.5 * 0.6 + (pnlScore + 1) / 2 * 0.4));
      newCoinStats[id] = cs;
    }
    this.coinStats = newCoinStats;

    // ── 2. Global long/short win rates ──
    const longs  = log.filter(t => t.type === 'sell');
    const shorts = log.filter(t => t.type === 'short_closed');
    this.winRateLong  = longs.length  ? longs.filter(t => t.pnl > 0).length  / longs.length  : 0.5;
    this.winRateShort = shorts.length ? shorts.filter(t => t.pnl > 0).length / shorts.length : 0.5;
    this.totalTrades  = log.length;

    // ── 3. Regime stats ──
    for (const t of log) {
      const r = t.regime || 'UNKNOWN';
      if (!this.regimeStats[r]) this.regimeStats[r] = { wins:0, losses:0, totalPnl:0 };
      this.regimeStats[r].totalPnl += (t.pnl || 0);
      if (t.pnl > 0) this.regimeStats[r].wins++; else this.regimeStats[r].losses++;
    }

    // ── 4. Strategy weight adjustment (every 20-30 trades) ──
    this.tradesSinceAdjust = log.length - (this._lastAdjustAt || 0);
    if (this.tradesSinceAdjust >= 20) {
      this._adjustStrategyWeights(log);
      this._lastAdjustAt = log.length;
    }

    // ── 5. Mood update ──
    // Tier 5 — Anti-Revenge Overdrive: force CAUTIOUS on losing streak
    if(isTierUnlocked(5)){
      const streak5 = log.slice(0,5).filter(t=>t.pnl<0).length;
      if(streak5>=3 && this.mood!=='CAUTIOUS'){
        this.mood='CAUTIOUS';
        console.log('[Tier5] Anti-Revenge: forcing CAUTIOUS after '+streak5+' losses');
      }
    }
    const recent5   = log.slice(0, 5);
    const recentWins = recent5.filter(t => t.pnl > 0).length;
    const recentLoss = recent5.filter(t => t.pnl < 0).length;
    const recent8 = log.slice(0, 8);
    const consLoss = recent8.findIndex(t => t.pnl > 0); // consecutive losses from top
    const consecLosses = consLoss === -1 ? recent8.length : consLoss;
    const netStreak = (typeof state!=='undefined' ? (state.aiWins||0)-(state.aiLosses||0) : 0);
    if      (consecLosses >= 5)                             this.mood = 'CAUTIOUS'; // 5+ consecutive losses
    else if (netStreak <= -6)                                this.mood = 'REVENGE';  // ★ bad LIFETIME record forces pause, even if recent trades mixed
    else if (recentWins >= 4)                               this.mood = 'CONFIDENT';
    else if (recentLoss >= 3)                               this.mood = 'REVENGE';
    else if (this.winRateLong < 0.35 && this.winRateShort < 0.35) this.mood = 'CAUTIOUS';
    else                                                    this.mood = 'NEUTRAL';
    this.moodUpdatedAt = Date.now();

    // ── 6. Update UI signal box ──
    const el = document.getElementById('ai-signal-text');
    if (el) {
      const moodMap   = { CONFIDENT:'😤 CONFIDENT', REVENGE:'😡 REVENGE', CAUTIOUS:'😰 CAUTIOUS', NEUTRAL:'🤖 ANALYZING' };
      const moodColor = { CONFIDENT:'var(--green)', REVENGE:'var(--red)', CAUTIOUS:'var(--amber)', NEUTRAL:'var(--cyan)' };
      el.textContent = moodMap[this.mood] || '🤖 ANALYZING';
      el.style.color = moodColor[this.mood] || 'var(--cyan)';
    }

    // ── 7. Log summary ──
    const topCoin = Object.entries(this.coinStats).sort((a,b) => b[1].preference - a[1].preference)[0];
    console.log(
      `[AI Brain] Trades:${log.length} | LWR:${(this.winRateLong*100).toFixed(0)}%`
      + ` SWR:${(this.winRateShort*100).toFixed(0)}%`
      + ` | Mood:${this.mood}`
      + ` | TopCoin:${topCoin ? topCoin[0]+'('+( topCoin[1].preference*100).toFixed(0)+'%)' : 'N/A'}`
      + ` | Weights:RSI=${this.strategyWeights.rsi.toFixed(2)} MACD=${this.strategyWeights.macd.toFixed(2)}`
    );
  },

  // ════════════════════════════════════════════════════════════
  // Strategy weight self-adjustment (RL-style reward signal)
  // Looks at last 20+ trades, finds which indicator combinations
  // led to wins vs losses, adjusts weights accordingly
  // ════════════════════════════════════════════════════════════
  _adjustStrategyWeights(log) {
    // Use last 20 trades as learning window
    const window = log.slice(0, Math.min(20, log.length));
    if (window.length < 10) return;

    const wins  = window.filter(t => t.pnl > 0);
    const losses= window.filter(t => t.pnl < 0);
    const winRate = wins.length / window.length;

    // Simple reward: if win rate > 60%, reinforce current weights
    //                if win rate < 40%, soften all weights toward 1.0
    //                in between: small nudge based on avg pnl
    const avgPnl = window.reduce((s, t) => s + (t.pnl||0), 0) / window.length;

    if (winRate >= 0.6 && avgPnl > 0) {
      // Winning strategy — small reinforce (push away from 1.0 by 5%)
      for (const k in this.strategyWeights) {
        const w = this.strategyWeights[k];
        this.strategyWeights[k] = Math.min(1.5, w > 1 ? w * 1.05 : w / 0.95);
      }
    } else if (winRate <= 0.4 || avgPnl < -2) {
      // Losing — revert all weights toward neutral 1.0
      for (const k in this.strategyWeights) {
        this.strategyWeights[k] += (1.0 - this.strategyWeights[k]) * 0.3;
      }
      console.log('[AI Brain] Strategy reset toward neutral — recent performance poor');
    }

    // Per-indicator fine-tuning based on win/loss patterns:
    // If RSI was consistently high/low on losing trades → reduce RSI weight
    const lossRsiHigh = losses.filter(t => t.entryRsi && t.entryRsi > 65).length;
    const lossRsiLow  = losses.filter(t => t.entryRsi && t.entryRsi < 35).length;
    if (lossRsiHigh / Math.max(losses.length, 1) > 0.5) {
      // Too many losses entering on high RSI → reduce RSI weight for overbought entries
      this.strategyWeights.rsi = Math.max(0.5, this.strategyWeights.rsi * 0.9);
    }
    const winPatterns = wins.filter(t => t.hadPattern).length;
    if (winPatterns / Math.max(wins.length, 1) > 0.6) {
      // Candle patterns consistently in wins → boost pattern weight
      this.strategyWeights.pattern = Math.min(1.5, this.strategyWeights.pattern * 1.1);
    }

    // Clamp all weights to safe range
    for (const k in this.strategyWeights) {
      this.strategyWeights[k] = Math.max(0.4, Math.min(1.8, this.strategyWeights[k]));
    }
    console.log('[AI Brain] Weights adjusted:', JSON.stringify(
      Object.fromEntries(Object.entries(this.strategyWeights).map(([k,v])=>[k,+v.toFixed(2)]))
    ));
  },

  // ════════════════════════════════════════════════════════════
  // API: Should AI trade this coin? Returns preference score 0-1
  // ════════════════════════════════════════════════════════════
  getCoinPreference(coinId) {
    const cs = this.coinStats[coinId];
    if (!cs || cs.trades < 3) return 0.5; // not enough data — neutral
    return cs.preference;
  },

  // API: Coin-wise entry threshold modifier
  // High-preference coins get lower threshold (easier entry)
  // Low-preference coins get higher threshold (harder entry)
  coinEntryBoost(coinId) {
    const pref = this.getCoinPreference(coinId);
    if (pref >= 0.7) return -2;  // favourite coin — more aggressive
    if (pref >= 0.5) return -1;  // decent coin — slight boost
    if (pref <= 0.2) return +3;  // bad coin — avoid unless very strong signal
    if (pref <= 0.35)return +2;  // weak coin — need stronger confirmation
    return 0;
  },

  // API: Size multiplier — bigger size on preferred coins
  coinSizeMult(coinId) {
    const pref = this.getCoinPreference(coinId);
    if (pref >= 0.7) return 1.15;  // prefer — slightly larger
    if (pref <= 0.2) return 0.6;   // avoid  — smaller size
    return 1.0;
  },

  // API: Should AI attempt shorts right now?
  shortsWorking() {
    const mkt = typeof getMarketRegime==='function' ? getMarketRegime() : null;
    // In strong bear market, allow shorts even with lower win rate
    if(mkt && (mkt.regime==='STRONG_BEAR'||mkt.regime==='BEAR')) return this.winRateShort >= 0.25;
    return this.winRateShort >= 0.35;
  },

  // API: Global size penalty based on mood + global win rates
  sizePenalty(side) {
    let mult = 1.0;
    if (this.mood === 'CAUTIOUS')  mult *= 0.70; // was 0.5 — too brutal, caused size spiral
    if (this.mood === 'REVENGE')   mult *= 0.65; // was 0.5
    if (this.mood === 'CONFIDENT') mult *= 1.20;
    // winRate penalty: only if truly bad (< 0.33 = 1 in 3)
    if (side === 'short' && this.winRateShort < 0.33) mult *= 0.80;
    if (side === 'long'  && this.winRateLong  < 0.33) mult *= 0.80;
    return Math.max(0.5, Math.min(1.4, mult));
  },

  // API: Entry threshold boost from mood
  entryBoost() {
    if (this.mood === 'CAUTIOUS')  return +2;
    if (this.mood === 'CONFIDENT') return -1;
    if (this.mood === 'REVENGE')   return +3; // ★ FIX: losing streak → be MORE selective, not less!
    return 0;
  },

  // API: Apply strategy weights to a raw score component map
  // Usage: applyWeights({ rsi: 3, macd: 2, pattern: 2, volume: 1, htf: 3, adx: 2 })
  applyWeights(components) {
    const w = this.strategyWeights;
    return (
      (components.rsi     || 0) * w.rsi     +
      (components.macd    || 0) * w.macd    +
      (components.volume  || 0) * w.volume  +
      (components.pattern || 0) * w.pattern +
      (components.htf     || 0) * w.htf     +
      (components.adx     || 0) * w.adx
    );
  }
};
setInterval(() => { if(isTierUnlocked(3)) aiMemory.learnFromHistory(); }, 30000); // Tier 3 gates AI learning

function checkAITrade(){
  const now=Date.now();
  const mkt=getMarketRegime();
  const aggMult=userBehaviourModel.aggressionMult();

  // ── AI PORTFOLIO CAP: max $5000 total (cash + holdings) ──
  // Prevents exponential compounding — keeps game fair
  const aiTotalCheck = state.aiCash
    + Object.values(state.aiHoldings).reduce((s,h)=>s+(h.qty*(livePrices[Object.keys(state.aiHoldings).find(k=>state.aiHoldings[k]===h)]||h.avgCost)),0)
    + Object.entries(state.aiShorts).reduce((s,[id,sh])=>s+sh.margin,0);
  if(aiTotalCheck >= 5000) return; // AI portfolio cap reached

  // ── FORCED ENTRY: if no trade in 4min, relax thresholds to get AI moving ──
  const _msSinceLastTrade = now - _lastAITradeTime;
  const _forcedMode = _msSinceLastTrade > 720000; // 12 minutes with no trade (was 4min — too eager, forced weak chop trades)
  const _forcedThreshReduction = _forcedMode ? 1 : 0; // reduce thresholds by 1 only (was 3 — too aggressive, let genuinely bad setups stay skipped)

  const winStreak=(state.aiWins||0)-(state.aiLosses||0);
  const streakBoost=Math.min(1.30, Math.max(0.90, 1+(winStreak*0.03))); // floor 0.90 (was 0.85)

  const entryThreshBase=mkt.isChop?12:10;  // Rebalanced: yesterday's 11/9 was too loose, caused noise trades
  // REVENGE mood mein entryBoost -1 return karta hai — lekin short block pe NO effect
  const entryThresh=Math.max(4, Math.round(entryThreshBase/aggMult) + aiMemory.entryBoost() - _forcedThreshReduction);

  // ── DIRECTION BLOCKS — ABSOLUTE, no mood override ──
  // STRONG_BULL/BULL → shorts completely forbidden (even REVENGE mood)
  // STRONG_BEAR/BEAR → longs completely forbidden
  const hardBlockShort = mkt.regime==='STRONG_BULL' || mkt.regime==='BULL';
  const hardBlockLong  = mkt.regime==='STRONG_BEAR' || mkt.regime==='BEAR';
  // Extra safety: in STRONG_BULL, also close any existing shorts immediately (emergency exit)
  // in STRONG_BEAR, also close any existing longs immediately

  // Emergency close wrong-direction positions
  if(mkt.regime==='STRONG_BULL'){
    for(const coinId in state.aiShorts){
      const sh=state.aiShorts[coinId];if(!sh)continue;
      const price=livePrices[coinId];if(!price)continue;
      const pct=(sh.entryPrice-price)/sh.entryPrice*100;
      const holdSec=(now-(sh.entryTs||now))/1000;
      if(pct<=-1.2||holdSec>120){executeAITrade('close_short',null,coinId);delete aiTrailingStop[coinId];aiCooldown[coinId]=now;}
    }
  }
  if(mkt.regime==='STRONG_BEAR'){
    for(const coinId in state.aiHoldings){
      const h=state.aiHoldings[coinId];if(!h||h.qty<=1e-6)continue;
      const price=livePrices[coinId];if(!price)continue;
      const pct=(price-h.avgCost)/h.avgCost*100;
      const holdSec=(now-(h.entryTs||now))/1000;
      if(pct<=-1.2||holdSec>120){executeAITrade('sell',null,coinId);delete aiTrailingStop[coinId];aiCooldown[coinId]=now;}
    }
  }

  for(const coin of COINS){
    const data=candleData[`${coin.id}_${state.tf}`];
    if(!data||data.length<30)continue;

    const cooldown=mkt.isChop?90000:60000; // 60-90s cooldown — reduce overtrading
    if(aiCooldown[coin.id]&&now-aiCooldown[coin.id]<cooldown)continue;

    const ind=mkt.inds[coin.id]||calcAdvancedIndicators(data,higherTFData[coin.id]);
    if(!ind)continue;
    const price=livePrices[coin.id];if(!price)continue;
    const holding=state.aiHoldings[coin.id];
    const short  =state.aiShorts[coin.id];
    // Pause new entries on REVENGE mood OR neutral with bad lifetime streak (<-5)
    // (declared ONCE here, shared by both short & long entry blocks below —
    //  previously duplicated inside short-only scope, causing ReferenceError
    //  in the long block whenever short block didn't run, killing ALL trades)
    const _netStreak = (state.aiWins||0)-(state.aiLosses||0);
    const canTradeNow = aiMemory.mood !== 'REVENGE' && !(_netStreak < -5 && aiMemory.mood === 'NEUTRAL');

    // ══════════════════════════════════════════════════════════
    // ★ FEE-AWARE TP/SL — round-trip fee = 0.2%
    // Minimum TP must beat fees with margin
    // RR ratio enforced: TP >= 2× SL always
    // ══════════════════════════════════════════════════════════
    const FEE_RT=0.20;  // 0.2% of margin round-trip (fees now margin-based, not notional)
    const MIN_TP=0.65;  // Rebalanced: 0.50 was too tight, caused noise-triggered exits
    const MIN_SL=0.45;  // Rebalanced: 0.35 was too tight, matches Edge Function fix
    // Leverage-aware tightening: higher leverage on an OPEN position sits closer to
    // liquidation, so scale its TP/SL window down proportionally. Uses the position's
    // own stored leverage (set at entry time in executeAITrade) — falls back to the
    // configured base AI leverage when nothing is open yet (i.e. no change for fresh entries).
    const _openLev = (holding&&holding.qty>1e-6&&holding.leverage) || (short&&short.leverage) || (LEVERAGE_CONFIG.aiLeverage||5);
    const _levDeflator = 1 / (1 + Math.max(0,_openLev-5)*0.08);
    // CHOP markets rarely make big moves — a sideways range means the same
    // trending-market TP is almost never reached, so CHOP trades were
    // mostly getting force-closed by the time-stop instead of hitting TP.
    // Give CHOP trades a smaller, realistically-reachable target instead.
    const MIN_TP_CHOP=0.30, MIN_SL_CHOP=0.25;
    const atrTP = mkt.isChop
      ? Math.max(MIN_TP_CHOP, ind.atrPct*0.7*_levDeflator)
      : Math.max(MIN_TP, ind.atrPct*(ind.strongTrend?1.6:1.1)*_levDeflator);
    const atrSL = mkt.isChop
      ? Math.max(MIN_SL_CHOP, ind.atrPct*0.40*_levDeflator)
      : Math.max(MIN_SL, ind.atrPct*0.55*_levDeflator);
    // Enforce RR — TP must be at least 1.8× SL
    const tp=Math.max(atrTP, atrSL*1.8);
    const sl=atrSL;

    // ══════════════════════════════════════════════════════════
    // EXIT — SHORT
    // ══════════════════════════════════════════════════════════
    if(short){
      const pct=(short.entryPrice-price)/short.entryPrice*100;
      const holdSec=(now-(short.entryTs||now))/1000;

      // Trailing: activate at 60% of TP, trail by 25% of TP
      const trailActivate=tp*0.6;
      const trailDist=tp*0.25;
      if(pct>=trailActivate){
        const trail=aiTrailingStop[coin.id];
        const newTrail=pct-trailDist;
        if(!trail||newTrail>trail) aiTrailingStop[coin.id]=newTrail;
        if(pct<aiTrailingStop[coin.id]){
          delete aiTrailingStop[coin.id];
          executeAITrade('close_short',null,coin.id);aiCooldown[coin.id]=now;continue;
        }
      }
      const exitShort=
        pct>=tp                                        // TP hit
        || pct<=-sl                                    // SL hit
        || (hardBlockShort&&pct>-(FEE_RT*0.3))        // regime flip — exit FASTER (was *0.5, too slow in bull)
        || (ind.bullEngulf&&pct>0.1)                   // strong reversal candle
        || (ind.trend_signal==='STRONG_BUY'&&pct>0)   // signal fully flipped
        || (ind.htfTrend===1&&pct>=(FEE_RT))          // HTF flipped — exit if covering fees
        || (!mkt.isChop && holdSec>600&&pct<-sl*0.6)   // trending: early cut, give real room
        || (!mkt.isChop && holdSec>1200&&pct<=-(FEE_RT*0.5)) // trending: final backstop
        || (mkt.isChop && holdSec>1800&&pct<=0);        // CHOP: only cut stuck flat positions, let its own tight SL/TP resolve first
    }

    // ══════════════════════════════════════════════════════════
    // EXIT — LONG
    // ══════════════════════════════════════════════════════════
    if(holding&&holding.qty>1e-6){
      const pct=(price-holding.avgCost)/holding.avgCost*100;
      const holdSec=(now-(holding.entryTs||now))/1000;

      const trailActivate=tp*0.6;
      const trailDist=tp*0.25;
      if(pct>=trailActivate){
        const trail=aiTrailingStop[coin.id];
        const newTrail=pct-trailDist;
        if(!trail||newTrail>trail) aiTrailingStop[coin.id]=newTrail;
        if(pct<aiTrailingStop[coin.id]){
          delete aiTrailingStop[coin.id];
          executeAITrade('sell',null,coin.id);aiCooldown[coin.id]=now;continue;
        }
      }
      const exitLong=
        pct>=tp
        || pct<=-sl
        || (hardBlockLong&&pct>-(FEE_RT*0.5))
        || (ind.bearEngulf&&pct>0.1)
        || (ind.trend_signal==='STRONG_SELL'&&pct>0)
        || (ind.htfTrend===-1&&pct>=FEE_RT)
        || (ind.rsi>82&&pct>tp*0.5)                  // extreme overbought at partial TP
        || (!mkt.isChop && holdSec>600&&pct<-sl*0.6)   // trending: early cut, give real room
        || (!mkt.isChop && holdSec>1200&&pct<=-(FEE_RT*0.5)) // trending: final backstop
        || (mkt.isChop && holdSec>1800&&pct<=0);        // CHOP: only cut stuck flat positions
      if(exitLong){delete aiTrailingStop[coin.id];executeAITrade('sell',null,coin.id);aiCooldown[coin.id]=now;continue;}
    }

    if((holding&&holding.qty>1e-6)||short)continue;
    if(state.aiCash<80)continue;

    // ── MAX 2 OPEN POSITIONS AT ONCE ──
    const openLongs  = Object.values(state.aiHoldings).filter(h=>h.qty>1e-6).length;
    const openShorts = Object.keys(state.aiShorts).length;
    if(openLongs + openShorts >= 2) continue; // realistic position limit

    // ══════════════════════════════════════════════════════════
    // ENTRY — SHORT
    // ABSOLUTE BLOCK in BULL/STRONG_BULL — no exceptions, no mood override
    // ══════════════════════════════════════════════════════════
    if(!hardBlockShort && aiMemory.shortsWorking()){
      // Double-check regime — REVENGE mood entryBoost cannot sneak a short in bull market
      // Block ALL trades in true flat-chop (ADX<22) — no edge, fees dominate
      const trueChop = mkt.isChop && ind.adx < 16; // was <22 = same as trendingMarket boundary, blocked ~all CHOP trades
      const canShort = (mkt.regime==='BEAR' || mkt.regime==='STRONG_BEAR' || mkt.isChop)
                       && !hardBlockShort && !trueChop;
      if(canShort){
        const hadPatternShort = !!(ind.bearEngulf||ind.shootStar);
        const shortComponents = {
          adx:     (ind.trendingMarket&&!ind.adxBull?3:0)+(ind.strongTrend&&!ind.adxBull?2:0),
          htf:     (ind.htfTrend===-1?3:0),
          rsi:     (ind.rsi>65?3:ind.rsi>60?2:0),
          macd:    (!ind.macdCross?2:0)+(ind.macdExpBear?1:0),
          pattern: (ind.bearEngulf?2:0)+(ind.shootStar?2:0)+(ind.bearMomentum3?2:0),
          volume:  (ind.veryHighVol&&ind.bearTrend?2:0)+(ind.belowVwap?2:0),
        };
        // Tier 1 (StochRSI) + Tier 2 (Patterns) gate their bonus points
        const t1=isTierUnlocked(1), t2=isTierUnlocked(2);
        const shortScore =
          (ind.bearTrend?4:ind.weakBear?2:0)
          +(ind.bear>=8?3:ind.bear>=6?2:ind.bear>=4?1:0)
          +(t1&&ind.stochOverbought?2:0)+(ind.bearDiverg?2:0)  // Tier 1 gates StochRSI
          +(ind.momStrong&&ind.roc10<-0.5?2:0)
          +(mkt.regime==='STRONG_BEAR'?3:mkt.regime==='BEAR'?2:0)
          + aiMemory.applyWeights({
            ...shortComponents,
            pattern: t2?shortComponents.pattern:0  // Tier 2 gates pattern bonus
          });
        const coinBoost   = aiMemory.coinEntryBoost(coin.id);
        // CHOP market = very high bar (15), don't trade noise
        const bearBonus = (mkt.regime==='STRONG_BEAR'||mkt.regime==='BEAR') ? -2 : 0;
        const shortThresh = ind.trendingMarket
          ? Math.max(entryThresh+3+coinBoost+bearBonus, 10)
          : Math.max(entryThresh+5+coinBoost+bearBonus, 15);  // CHOP=15 (was 13, too low)
        const shortAdxOk = ind.trendingMarket || shortScore >= 14; // ★ ADX filter for shorts
        // Tier 6: Multi-TF — if unlocked, require HTF (1H) to also be bearish
        const t6ShortOk = !isTierUnlocked(6) || ind.htfTrend===-1;
        // ★ HARD MOMENTUM GATE: actual price must be falling (roc10<=0.15), not just indicators
        // Root cause fix: 6/6 prior losses were shorts taken while price was actually rising —
        // RSI/MACD gave false bearish reads during a slow uptrend. Price action is the final say.
        const shortMomOk = ind.roc10 <= 0.15;
        // ★ ORDER BOOK GATE (fail-open): only blocks if book is clearly stacked against
        // the short (heavy buy-side depth). Missing/stale (>60s) data never blocks.
        const _obS = orderBookImbalance[coin.id];
        const shortObOk = !_obS || (now-_obS.ts>60000) || _obS.ratio<=0.62;
        const shortOk = shortScore>=shortThresh
          &&(ind.trend_signal==='STRONG_SELL'||ind.trend_signal==='SELL'||shortScore>=shortThresh+4)
          &&ind.htfTrend!==1
          &&ind.rsi>20
          &&shortAdxOk&&t6ShortOk&&shortMomOk&&shortObOk&&!ind.nearSupport;
        // canTradeNow declared once at top of loop (shared scope)
        if(shortOk && canTradeNow){
          const confidence=Math.min(shortScore/18,1);
          const sizeMult=aiMemory.sizePenalty('short')*aiMemory.coinSizeMult(coin.id);
          let riskAmt;
          if(isTierUnlocked(4)){
            const wr=Math.max(0.3, aiMemory.winRateShort);
            const avgW=Math.max(1, 3); const avgL=Math.max(1,3);
            const kelly=Math.max(0.015, Math.min(0.10, (wr*avgW-(1-wr)*avgL)/Math.max(1,avgW)));
            riskAmt=state.aiCash*kelly*streakBoost*sizeMult;
          } else {
            riskAmt=state.aiCash*(0.05+confidence*0.07)*streakBoost*sizeMult;
          }
          const margin=Math.max(150,Math.min(Math.floor(riskAmt*1.7),state.aiCash*0.62,420)); // raised cap+base for faster AI $ growth
          executeAITrade('short',margin,coin.id,{entryRsi:ind.rsi,hadPattern:hadPatternShort,regime:mkt.regime});
          if(state.aiShorts[coin.id])state.aiShorts[coin.id].entryTs=now;
          aiCooldown[coin.id]=now;continue;
        }
      }
    }

    // ══════════════════════════════════════════════════════════
    // ENTRY — LONG (hard-blocked in BEAR)
    // ★ PULLBACK ENTRY: wait for small dip before entering in bull market
    //   This avoids buying the very top of a spike
    // ══════════════════════════════════════════════════════════
    if(!hardBlockLong){
      const canLong=(mkt.regime==='BULL'||mkt.regime==='STRONG_BULL'||mkt.isChop||mkt.regime==='BEAR')
                    && !(mkt.isChop && ind.adx<16); // was <22, same fix as short side
      if(canLong){
        const longComponents = {
          adx:     (ind.trendingMarket&&ind.adxBull?3:0)+(ind.strongTrend&&ind.adxBull?2:0),
          htf:     (ind.htfTrend===1?3:0),
          rsi:     (ind.rsi<35?3:ind.rsi<42?2:ind.rsi<52?1:0),
          macd:    (ind.macdCross?2:0)+(ind.macdExpBull?1:0),
          pattern: (ind.bullEngulf?3:0)+(ind.hammer?3:0)+(ind.bullMomentum3?2:0)+(ind.bullDiverg?3:0),
          volume:  (ind.veryHighVol&&ind.bullTrend?2:ind.highVolume&&ind.bullTrend?1:0)+(ind.aboveVwap?2:0),
        };
        // Tier 1 (StochRSI) + Tier 2 (Patterns) gate their bonus points
        const t1L=isTierUnlocked(1), t2L=isTierUnlocked(2);
        const longScore =
          (ind.bullTrend?4:ind.weakBull?2:0)
          +(ind.bull>=8?3:ind.bull>=6?2:ind.bull>=4?1:0)
          +(t1L&&ind.stochOversold?3:0)                  // Tier 1 gates StochRSI bonus
          +(ind.breakout&&ind.bullTrend?2:0)
          +(ind.momStrong&&ind.roc10>0.5?2:0)
          +(mkt.regime==='STRONG_BULL'?3:mkt.regime==='BULL'?2:0)
          + aiMemory.applyWeights({
            ...longComponents,
            pattern: t2L?longComponents.pattern:0        // Tier 2 gates pattern bonus
          });

        // PULLBACK FILTER: block only when extremely overbought (RSI>78 in STRONG_BULL)
        // Previous threshold was RSI<58 — completely blocked entries in bull runs (RSI=70-85)
        const pullbackOk=mkt.regime==='STRONG_BULL'
          ? ind.rsi<76 || ind.stochOversold || ind.bullEngulf || ind.hammer || longScore>=entryThresh+4
          : true;

        const longAdxOk=ind.trendingMarket||(longScore>=10);
        // In BEAR regime allow only extreme oversold bounce (RSI<28) entries
        // STRONG_BEAR=fully blocked | BEAR=only extreme RSI<24 bounce
        const bearLongAllowed = mkt.regime==='STRONG_BULL'||mkt.regime==='BULL'||mkt.isChop
          || (mkt.regime==='BEAR' && ind.rsi<24 && ind.stochOversold && longScore>=entryThresh+5);
        // STRONG_BEAR: no longs at all — bear rallies destroy P&L
        // Tier 6: Multi-TF — if unlocked, require HTF to be bullish (htfTrend=1)
        const t6LongOk = !isTierUnlocked(6) || ind.htfTrend===1;
        // ★ HARD MOMENTUM GATE: actual price must be rising (roc10>=-0.15), not just indicators
        const longMomOk = ind.roc10 >= -0.15;
        // ★ ORDER BOOK GATE (fail-open): only blocks if book is clearly stacked against
        // the long (heavy sell-side depth). Missing/stale (>60s) data never blocks.
        const _obL = orderBookImbalance[coin.id];
        const longObOk = !_obL || (now-_obL.ts>60000) || _obL.ratio>=0.38;
        const longOk=canLong&&bearLongAllowed&&longScore>=entryThresh
          &&(ind.trend_signal==='STRONG_BUY'||ind.trend_signal==='BUY'||longScore>=entryThresh+5)
          &&longAdxOk&&(ind.htfTrend!==-1||longScore>=entryThresh+5)&&pullbackOk
          &&ind.rsi>18&&ind.rsi<86&&t6LongOk&&longMomOk&&longObOk&&!ind.nearResistance;

        // REVENGE mode = pause
        if(longOk && canTradeNow){
          const hadPatternLong = !!(ind.bullEngulf||ind.hammer);
          const confidence=Math.min(longScore/18,1);
          const coinBoostL = aiMemory.coinEntryBoost(coin.id);
          const longThresh = Math.max(entryThresh+coinBoostL, 5);
          if(longScore < longThresh){ /* coin preference says skip */ }
          else {
            const sizeMult=aiMemory.sizePenalty('long')*aiMemory.coinSizeMult(coin.id);
            let riskAmt;
            if(isTierUnlocked(4)){
              // ★ Tier 4: Kelly Criterion — f = (wr*avgWin - (1-wr)*avgLoss) / avgWin
              const wr=Math.max(0.3, aiMemory.winRateLong);
              const avgW=Math.max(1, aiMemory.coinStats[coin.id]?.avgPnl||3);
              const avgL=Math.max(1, 3-avgW*0.5); // estimate
              const kelly=Math.max(0.02, Math.min(0.12, (wr*avgW-(1-wr)*avgL)/Math.max(1,avgW)));
              riskAmt=state.aiCash*kelly*streakBoost*sizeMult;
            } else {
              riskAmt=state.aiCash*(0.055+confidence*0.08)*streakBoost*sizeMult;
            }
            const amount=Math.max(150,Math.min(Math.floor(riskAmt*1.7),state.aiCash*0.72,420)); // raised cap+base for faster AI $ growth
            executeAITrade('buy',amount,coin.id,{entryRsi:ind.rsi,hadPattern:hadPatternLong,regime:mkt.regime});
            if(state.aiHoldings[coin.id])state.aiHoldings[coin.id].entryTs=now;
            aiCooldown[coin.id]=now;
          }
        }
      }
    }
  }
}

function executeAITrade(side, amount, coinId, meta={}) {
  // meta = { entryRsi, hadPattern, regime } — stored for RL learning
  const regime = meta.regime || (typeof getMarketRegime==='function' ? null : null);
  coinId=coinId||state.selectedCoin;
  const price=livePrices[coinId];
  if(!price)return;
  const time=new Date().toLocaleTimeString();

  if(side==='buy'){
    // Dynamic AI leverage: stronger trend/mood = higher leverage (up to aiMaxLeverage)
    let AI_LEV = LEVERAGE_CONFIG.aiLeverage || 5;
    const _maxLev = LEVERAGE_CONFIG.aiMaxLeverage || 10;
    if(regime==='STRONG_BULL')            AI_LEV=Math.min(_maxLev, AI_LEV+3); // 8x in strong bull
    else if(regime==='BULL')              AI_LEV=Math.min(_maxLev, AI_LEV+1); // 6x in bull
    else if(aiMemory.mood==='CONFIDENT')  AI_LEV=Math.min(_maxLev, AI_LEV+2); // 7x when confident
    else if(aiMemory.mood==='CAUTIOUS')   AI_LEV=Math.max(1, AI_LEV-2);       // 3x when cautious
    else if(aiMemory.mood==='REVENGE')    AI_LEV=Math.max(2, AI_LEV-1);       // 4x
    AI_LEV=Math.round(AI_LEV);
    if(!amount)amount=Math.floor(Math.random()*200+100);
    if(amount>state.aiCash)amount=state.aiCash;
    if(amount<10)return;
    const fee    = amount * 0.001;
    const margin = amount - fee;
    const qty    = (margin * AI_LEV) / price; // ✅ leveraged qty
    state.aiCash -= amount;
    if(!state.aiHoldings[coinId]) state.aiHoldings[coinId]={qty:0,avgCost:price,invested:0,margin:0,leverage:AI_LEV};
    const h=state.aiHoldings[coinId];
    // Weighted avg cost by quantity (proper VWAP entry)
    const totalQty = h.qty + qty;
    h.avgCost  = totalQty > 1e-10 ? (h.avgCost*h.qty + price*qty)/totalQty : price;
    h.qty      = totalQty;
    h.margin   = (h.margin||0) + margin;
    h.invested = h.margin;
    h.leverage = AI_LEV;
    state.aiTradeLog.unshift({type:'buy',coin:coinId,qty,price,amount,fee,pnl:null,time,leverage:AI_LEV,
      entryRsi:meta.entryRsi||null, hadPattern:meta.hadPattern||false, regime:meta.regime||null});
    _lastAITradeTime = Date.now(); // reset forced-entry timer

  }else if(side==='sell'){
    const h=state.aiHoldings[coinId];
    if(!h||h.qty<=0.000001)return;
    const actualQty=h.qty;
    const AI_LEV = h.leverage || LEVERAGE_CONFIG.aiLeverage || 5;
    const margin = h.margin || h.invested || 0;
    const exitFee = margin * 0.001;  // fee on margin not notional
    const grossPnl = actualQty * (price - h.avgCost);
    const pnl = grossPnl - exitFee;
    // ✅ Return: margin + pnl
    state.aiCash += margin + pnl;
    delete state.aiHoldings[coinId];
    if(pnl>0){state.aiWins++;addAiPoints(calcAiPts(pnl, margin));}else{state.aiLosses++;}
    state.aiTradeLog.unshift({type:'sell',coin:coinId,qty:actualQty,price,pnl,fee:exitFee,time,
      leverage:AI_LEV, margin:margin, entryPrice:h.avgCost,
      entryRsi:meta.entryRsi||null, hadPattern:meta.hadPattern||false, regime:meta.regime||null});

  }else if(side==='short'){
    // Dynamic AI leverage for shorts
    let AI_LEV = LEVERAGE_CONFIG.aiLeverage || 5;
    const _maxLev2 = LEVERAGE_CONFIG.aiMaxLeverage || 10;
    if(regime==='STRONG_BEAR')            AI_LEV=Math.min(_maxLev2, AI_LEV+3); // 8x in strong bear
    else if(regime==='BEAR')              AI_LEV=Math.min(_maxLev2, AI_LEV+1); // 6x in bear
    else if(aiMemory.mood==='CONFIDENT')  AI_LEV=Math.min(_maxLev2, AI_LEV+2); // 7x when confident
    else if(aiMemory.mood==='CAUTIOUS')   AI_LEV=Math.max(1, AI_LEV-2);        // 3x when cautious
    else if(aiMemory.mood==='REVENGE')    AI_LEV=Math.max(2, AI_LEV-1);        // 4x
    AI_LEV=Math.round(AI_LEV);
    if(!amount||amount<10)return;
    if(amount>state.aiCash)amount=state.aiCash;
    const fee = amount * 0.001;
    const margin = amount - fee;
    const qty = (margin * AI_LEV) / price; // ✅ leveraged qty for short
    state.aiCash -= amount;
    state.aiShorts[coinId] = {
      qty, entryPrice:price, margin,
      leverage:AI_LEV,
      entryRsi:meta.entryRsi||null, hadPattern:meta.hadPattern||false
    };
    state.aiTradeLog.unshift({type:'short',coin:coinId,qty,price,amount,fee,pnl:null,time,
      leverage:AI_LEV,
      entryRsi:meta.entryRsi||null, hadPattern:meta.hadPattern||false, regime:meta.regime||null});
    _lastAITradeTime = Date.now(); // reset forced-entry timer

  }else if(side==='close_short'){
    const sh=state.aiShorts[coinId];
    if(!sh)return;
    const fee=(sh.margin||0)*0.001;  // ✅ FIX: fee on margin not notional
    const pnl=(sh.entryPrice-price)*sh.qty-fee;
    state.aiCash+=sh.margin+pnl;
    delete state.aiShorts[coinId];
    if(pnl>0){state.aiWins++;addAiPoints(calcAiPts(pnl, sh.margin||100));}else{state.aiLosses++;}
    state.aiTradeLog.unshift({type:'short_closed',coin:coinId,qty:sh.qty,price,pnl,fee,time,
      leverage:sh.leverage||5, margin:sh.margin||0, entryPrice:sh.entryPrice,
      entryRsi:sh.entryRsi||null, hadPattern:sh.hadPattern||false, regime:meta.regime||null});
  }

  if(state.aiTradeLog.length>50)state.aiTradeLog.length=50;
  saveState();
}

// ── EXPORT SAVE ──
function exportSave(){
  const bundle={state,lifetimePts,v:2,ts:Date.now()};
  const blob=new Blob([JSON.stringify(bundle)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`aibattle-save-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('💾 Save file downloaded!','var(--amber)');
}

// ── IMPORT SAVE ──
function importSave(){
  const input=document.createElement('input');
  input.type='file';input.accept='.json';
  input.onchange=e=>{
    const file=e.target.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try{
        const bundle=JSON.parse(ev.target.result);
        // ── Only copy known, expected keys from the imported file into
        //    state — never a raw Object.assign(state, bundle.state).
        //    A crafted save file could otherwise inject keys like
        //    '__proto__' / 'constructor' (prototype pollution) or just
        //    silently corrupt state with unexpected fields. ──
        const ALLOWED_STATE_KEYS = [
          'userCash','userPositions','userTradeLog','userWins','userLosses',
          'aiCash','aiHoldings','aiShorts','aiTradeLog','aiWins','aiLosses',
          'selectedCoin','tf','userTradeSize','_sizeKey','_bestValue',
          'currentLeverage','dailyDate','battleActive','unlockedTiers',
        ];
        if(bundle.state && typeof bundle.state==='object'){
          for(const key of ALLOWED_STATE_KEYS){
            if(Object.prototype.hasOwnProperty.call(bundle.state,key)){
              state[key]=bundle.state[key];
            }
          }
        }
        if(bundle.lifetimePts){lifetimePts.ai=Number(bundle.lifetimePts.ai)||0;lifetimePts.user=Number(bundle.lifetimePts.user)||0;}
        saveState();saveLifetimePts(lifetimePts.ai,lifetimePts.user);
        updateUI();
        showToast('📂 Save loaded successfully!','#4ab8ff');
      }catch(err){showToast('❌ Invalid save file','var(--red)');}
    };
    reader.readAsText(file);
  };
  input.click();
}

// ── TOAST NOTIFICATION ──
function showToast(msg, color='var(--green)'){
  const t=document.createElement('div');
  t.style.cssText=`position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#1a1a2e;border:1px solid ${color};color:${color};padding:10px 20px;border-radius:6px;font-family:'Orbitron',monospace;font-size:12px;z-index:99999;pointer-events:none;box-shadow:0 0 15px ${color}44`;
  t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),2500);
}
function quickClose(coinId, action){
  if(state.selectedCoin !== coinId){
    state.selectedCoin = coinId;
    if(!candleData[`${coinId}_${state.tf}`]) loadAllCandles();
  }
  // Call with correct signature: (side, evt)
  // action should be 'close_long' or 'close_short'
  placeUserFuturesTrade(action, null);
}

// ---- USER TRADING (FUTURES STYLE) ----

// ── Leverage selector ──────────────────────────────────────
function setLeverage(lev){
  state.currentLeverage = lev;
  // Update button UI
  document.querySelectorAll('.lev-btn').forEach(b=>{
    const btnLev = parseInt(b.textContent);
    b.classList.toggle('active', btnLev === lev);
  });
  const dispEl = document.getElementById('leverage-display');
  if(dispEl) dispEl.textContent = lev + 'x';
  // Update position size display
  _updatePosSizeDisplay();
  saveState();
  notify(`⚡ Leverage set to ${lev}x`, 'reward');
}

function _updatePosSizeDisplay(){
  const lev  = state.currentLeverage || LEVERAGE_CONFIG.defaultLeverage;
  const size = state.userTradeSize   || GAME_CONFIG.defaultTradeSize;
  const pos  = Math.floor(size * lev);
  const el   = document.getElementById('position-size-display');
  if(el) el.textContent = `Position: $${pos.toLocaleString()} (${lev}x)`;
}

function setUserSize(amount){
  const actual = amount===0 ? Math.floor(state.userCash) : amount;
  state.userTradeSize = actual;
  state._sizeKey = amount; // track which button is active
  // Update button classes
  document.querySelectorAll('.size-btn').forEach(b=>b.classList.remove('active'));
  const idMap={50:'size-50',100:'size-100',250:'size-250',0:'size-max'};
  const el=document.getElementById(idMap[amount]);
  if(el) el.classList.add('active');
  // Update display
  const disp=document.getElementById('size-display');
  if(disp) disp.textContent = amount===0?`$${actual} (MAX)`:`$${actual}`;
  _updatePosSizeDisplay();
  saveState();
}

function placeUserFuturesTrade(side,evt){
  const price=livePrices[state.selectedCoin];
  if(!price){notify('Price not available','loss');return;}
  const coin=state.selectedCoin;
  const pos=state.userPositions[coin];
  const time=new Date().toLocaleTimeString();

  // CLOSE LONG
  if(side==='close_long'){
    if(!pos||pos.side!=='long'||pos.qty<1e-8){notify('No LONG position to close!','loss');return;}
    // ✅ FIX: exit fee on MARGIN (same as entry fee) — not notional (was 20x too high at 20x lev)
    const exitFee   = (pos.margin || pos.invested || 0) * 0.001;
    const grossPnl  = pos.qty * (price - pos.avgCost);
    const pnl       = grossPnl - exitFee;
    state.userCash += (pos.margin || pos.invested) + pnl; // return margin ± profit/loss
    if(pnl>0){state.userWins++;const earnedPts=calcPts(pnl, pos.margin||100);addUserPoints(earnedPts);}else{state.userLosses++;}
    state.userTradeLog.unshift({type:'close_long',coin,qty:pos.qty,price,pnl,fee:exitFee,time});
    delete state.userPositions[coin];
    const msgL=pnl>=0?`✅ LONG closed +$${pnl.toFixed(2)}`:`❌ LONG loss -$${Math.abs(pnl).toFixed(2)}`;
    notify(msgL,pnl>=0?'profit':'loss',evt);
    if(evt)floatPnl((pnl>=0?'+':'')+`$${pnl.toFixed(2)}`,pnl>=0?'#00ff88':'#ff3355',evt.clientX,evt.clientY);
    if(pnl>=0)spawnParticles(window.innerWidth/2,window.innerHeight/2,'#00ff88',30);
    else{const el=document.getElementById('user-panel');if(el)el.style.animation='shake 0.4s ease';}
    saveState();updateUI();return;
  }

  // CLOSE SHORT
  if(side==='close_short'){
    if(!pos||pos.side!=='short'||pos.qty<1e-8){notify('No SHORT position to close!','loss');return;}
    const fee=(pos.margin||pos.invested||0)*0.001;  // ✅ FIX: margin-based fee
    const pnl=(pos.entryPrice-price)*pos.qty-fee;
    state.userCash+=pos.margin+pnl;
    if(pnl>0){state.userWins++;const earnedPts=calcPts(pnl, pos.margin||100);addUserPoints(earnedPts);}else{state.userLosses++;}
    state.userTradeLog.unshift({type:'close_short',coin,qty:pos.qty,price,pnl,fee,time});
    delete state.userPositions[coin];
    const msgS=pnl>=0?`✅ SHORT closed +$${pnl.toFixed(2)}`:`❌ SHORT loss -$${Math.abs(pnl).toFixed(2)}`;
    notify(msgS,pnl>=0?'profit':'loss',evt);
    if(evt)floatPnl((pnl>=0?'+':'')+`$${pnl.toFixed(2)}`,pnl>=0?'#00ff88':'#ff3355',evt.clientX,evt.clientY);
    if(pnl>=0)spawnParticles(window.innerWidth/2,window.innerHeight/2,'#00ff88',30);
    saveState();updateUI();return;
  }

  // If opposite position exists, close it first
  if(pos){
    if(side==='long'&&pos.side==='short'){placeUserFuturesTrade('close_short');return;}
    if(side==='short'&&pos.side==='long'){placeUserFuturesTrade('close_long');return;}
  }

  // OPEN / ADD LONG
  if(side==='long'){
    const lev    = state.currentLeverage || LEVERAGE_CONFIG.defaultLeverage;
    const amount = Math.min(state.userTradeSize||GAME_CONFIG.defaultTradeSize, state.userCash);
    if(amount<5){notify('Not enough cash!','loss');return;}
    if(amount>state.userCash){notify('Insufficient cash!','loss');return;}
    // Margin = amount, Notional = amount * leverage
    const entryFee = amount * 0.001;              // entry fee on margin
    const margin   = amount - entryFee;           // net margin committed
    const notional = margin * lev;                // position size in $
    const qty      = notional / price;            // actual coin quantity
    state.userCash -= amount;
    if(!pos||pos.side!=='long'){
      const _slIn=parseFloat(document.getElementById('sl-pct-input')?.value);
      const _tpIn=parseFloat(document.getElementById('tp-pct-input')?.value);
      state.userPositions[coin]={
        side:'long', qty, avgCost:price,
        invested:margin, margin, leverage:lev, notional,
        slPct:(_slIn>0?_slIn:null), tpPct:(_tpIn>0?_tpIn:null)
      };
    }else{
      // Average into existing long position
      const p=state.userPositions[coin];
      const totalQty    = p.qty + qty;
      p.avgCost         = (p.avgCost*p.qty + price*qty) / totalQty;
      p.qty             = totalQty;
      p.margin         += margin;
      p.invested        = p.margin;
      p.notional        = totalQty * price;
    }
    state.userTradeLog.unshift({type:'buy_long',coin,qty,price,amount,fee:entryFee,pnl:null,time,leverage:lev});
    notify(`📈 LONG ${qty.toFixed(4)} ${coin} @$${fmtPrice(price)} (${lev}x)`,'profit');
  }

  // OPEN / ADD SHORT
  else if(side==='short'){
    const lev    = state.currentLeverage || LEVERAGE_CONFIG.defaultLeverage;
    const amount = Math.min(state.userTradeSize||GAME_CONFIG.defaultTradeSize, state.userCash);
    if(amount<5){notify('Not enough cash!','loss');return;}
    if(amount>state.userCash){notify('Insufficient cash!','loss');return;}
    const entryFee = amount * 0.001;
    const margin   = amount - entryFee;
    const notional = margin * lev;
    const qty      = notional / price;
    state.userCash -= amount;
    if(!pos||pos.side!=='short'){
      const _slIn=parseFloat(document.getElementById('sl-pct-input')?.value);
      const _tpIn=parseFloat(document.getElementById('tp-pct-input')?.value);
      state.userPositions[coin]={
        side:'short', qty, entryPrice:price,
        margin, invested:margin, leverage:lev, notional,
        slPct:(_slIn>0?_slIn:null), tpPct:(_tpIn>0?_tpIn:null)
      };
    }else{
      const p=state.userPositions[coin];
      const totalQty    = p.qty + qty;
      p.entryPrice      = (p.entryPrice*p.qty + price*qty) / totalQty;
      p.qty             = totalQty;
      p.margin         += margin;
      p.invested        = p.margin;
      p.notional        = totalQty * price;
    }
    state.userTradeLog.unshift({type:'sell_short',coin,qty,price,amount,fee:entryFee,pnl:null,time,leverage:lev});
    notify(`📉 SHORT ${qty.toFixed(4)} ${coin} @$${fmtPrice(price)} (${lev}x)`,'short');
  }

  saveState();updateUI();
}

// ---- UI UPDATE ----
function updateTicker(){
  for(const [id,el1,el2] of [['BTC','tk-btc','tk-btc2'],['ETH','tk-eth','tk-eth2'],['SOL','tk-sol','tk-sol2'],['BNB','tk-bnb','tk-bnb2'],['ANTHROPIC','tk-anthropic','tk-anthropic2']]){
    const p=livePrices[id],c=liveChanges[id];
    if(!p)continue;
    const cls=c>=0?'up':'down',sym=c>=0?'▲':'▼';
    const label=id==='ANTHROPIC'?'🤖 ANTHROPIC/PERP':id+'/USDT';
    const str=`${label} <span class="${cls}">${sym}$${fmtPrice(p)} (${c>=0?'+':''}${(c||0).toFixed(2)}%)</span>`;
    [el1,el2].forEach(id2=>{const e=document.getElementById(id2);if(e)e.innerHTML=str;});
  }
}

// ── SCORE CARD FLASH ON CHANGE ──
let _prevAiPort=0,_prevUserPort=0;
function flashIfChanged(id,newVal,prevVal){
  if(Math.abs(newVal-prevVal)>0.005){
    const el=document.getElementById(id);if(!el)return;
    el.classList.remove('flashing');void el.offsetWidth;el.classList.add('flashing');
    setTimeout(()=>el.classList.remove('flashing'),400);
  }
}

function updateUI(){
  // Coin tabs
  document.getElementById('coin-tabs').innerHTML=COINS.map(c=>{
    const price=livePrices[c.id],chg=liveChanges[c.id];
    const active=c.id===state.selectedCoin?' active':'';
    return `<div class="coin-tab${active}" onclick="selectCoin('${c.id}')"><span style="color:${c.color}">${c.icon}</span> ${c.id} <span style="color:${(chg||0)>=0?'#00ff88':'#ff3355'}">${chg!==undefined?(chg>=0?'+':'')+chg.toFixed(1)+'%':'...'}</span></div>`;
  }).join('');

  // AI panel — equity = free cash + sum(margin + unrealizedPnL per position)
  // ✅ FIX: For leveraged holdings, show margin+pnl — NOT qty*price (notional)
  const aiLongVal=Object.entries(state.aiHoldings).reduce((s,[id,h])=>{
    const cur=livePrices[id]||h.avgCost;
    const margin = h.margin || h.invested || 0;
    const unrealizedPnl = h.qty * (cur - h.avgCost); // leveraged gain/loss
    return s + margin + unrealizedPnl; // ✅ margin + leveraged pnl
  },0);
  const aiShortVal=Object.entries(state.aiShorts||{}).reduce((s,[id,sh])=>{
    const cur=livePrices[id]||sh.entryPrice;
    const margin = sh.margin || 0;
    const unrealizedPnl = sh.qty * (sh.entryPrice - cur); // short gains when price drops
    return s + margin + unrealizedPnl;
  },0);
  const aiTotal = state.aiCash + aiLongVal + aiShortVal;
  const aiPnl = aiTotal - 1000;
  document.getElementById('ai-cash').textContent='$'+fmtUSD(aiTotal);
  document.getElementById('ai-pnl').textContent=`P&L: ${aiPnl>=0?'+':''}$${fmtUSD(aiPnl)}`;
  document.getElementById('ai-pnl').className=`ai-pnl ${aiPnl>=0?'positive':'negative'}`;

  // AI trade log
  const aiLog=document.getElementById('ai-trade-log');
  let logItems=[];
  // Open LONG positions
  Object.entries(state.aiHoldings).forEach(([id,h])=>{
    if(h.qty>1e-8){const cur=livePrices[id]||h.avgCost;const upnl=(cur-h.avgCost)/h.avgCost*100;
    const lev=h.leverage||5;
    const levChip=`<span style="font-size:9px;background:var(--cyan)22;border:1px solid var(--cyan)55;border-radius:3px;padding:1px 4px;color:var(--cyan);margin-left:2px">${lev}x</span>`;
    logItems.push(`<div class="ai-trade-item" style="border-left-color:var(--cyan)">📈 LONG ${id}${levChip} | ${h.qty.toFixed(4)} @$${fmtPrice(h.avgCost)} | <span style="color:${upnl>=0?'var(--green)':'var(--red)'}">${upnl>=0?'+':''}${upnl.toFixed(2)}%</span></div>`);}
  });
  // Open SHORT positions
  Object.entries(state.aiShorts||{}).forEach(([id,sh])=>{
    if(sh.qty>1e-8){const cur=livePrices[id]||sh.entryPrice;const upnl=(sh.entryPrice-cur)/sh.entryPrice*100;
    const lev=sh.leverage||5;
    const sLevChip=`<span style="font-size:9px;background:var(--amber)22;border:1px solid var(--amber)55;border-radius:3px;padding:1px 4px;color:var(--amber);margin-left:2px">${lev}x</span>`;
    logItems.push(`<div class="ai-trade-item short">📉 SHORT ${id}${sLevChip} | ${sh.qty.toFixed(4)} @$${fmtPrice(sh.entryPrice)} | <span style="color:${upnl>=0?'var(--green)':'var(--red)'}">${upnl>=0?'+':''}${upnl.toFixed(2)}%</span></div>`);}
  });
  logItems=logItems.concat(state.aiTradeLog.slice(0,5).map(t=>{
    const cls=t.type==='short'?'short':t.type==='short_closed'?'short_closed':t.pnl!=null?(t.pnl>0?'profit':'loss'):'';
    const pnlStr=t.pnl!=null?` P&L:${t.pnl>=0?'+':'-'}$${Math.abs(t.pnl).toFixed(2)}`:'';  // FIX: explicit '-' for losses (was ambiguous)
    const lev=t.leverage||'';
    const mar=t.margin?`$${Math.round(t.margin)}`:'';
    const levStr=lev?`<span style="font-size:9px;background:#ffffff11;border:1px solid #ffffff22;border-radius:3px;padding:0 4px;margin-right:3px;color:#aaddff">${lev}x${mar?' '+mar:''}</span>`:'';
    const icon=t.type==='buy'?'🟢':t.type==='sell'?'🔴':t.type==='short'?'📉':'📊';
    return `<div class="ai-trade-item ${t.type} ${cls}">${icon} ${t.time} ${levStr}${t.type.toUpperCase()} ${t.qty.toFixed(4)} ${t.coin} @$${fmtPrice(t.price)}${pnlStr}</div>`;
  }));
  aiLog.innerHTML=logItems.length?logItems.join(''):'<div style="color:var(--text2);font-size:11px;text-align:center;padding:8px">Waiting...</div>';

  // User panel — equity = free cash + sum(margin + unrealizedPnl per position)
  // ★ KEY FIX: For leveraged positions, we add margin+pnl — NOT full notional (qty*price)
  const userPosVals=Object.entries(state.userPositions||{}).reduce((s,[id,p])=>{
    const cur=livePrices[id]||p.avgCost||p.entryPrice;
    const margin = p.margin || p.invested || 0;
    if(p.side==='long'){
      const unrealizedPnl = p.qty * (cur - p.avgCost);
      return s + margin + unrealizedPnl; // ✅ margin + leveraged gain/loss
    } else {
      const unrealizedPnl = p.qty * (p.entryPrice - cur);
      return s + margin + unrealizedPnl; // ✅ same formula for shorts
    }
  },0);
  const userTotal=state.userCash+userPosVals;
  const userPnl=userTotal-1000;
  document.getElementById('user-cash').textContent='$'+fmtUSD(userTotal);
  document.getElementById('user-pnl').textContent=`P&L: ${userPnl>=0?'+':''}$${fmtUSD(userPnl)}`;
  document.getElementById('user-pnl').style.color=userPnl>=0?'var(--green)':'var(--red)';

  // User positions
  const posEntries=Object.entries(state.userPositions||{}).filter(([,p])=>p.qty>1e-8);
  let holdHtml=posEntries.map(([id,p])=>{
    const cur=livePrices[id]||p.avgCost||p.entryPrice;
    const isLong=p.side==='long';
    const margin = p.margin || p.invested || 0;
    const lev    = p.leverage || 1;
    // NET P&L = gross - exit fee (fee on margin, same as entry)
    const grossPnl = isLong ? p.qty*(cur-p.avgCost) : p.qty*(p.entryPrice-cur);
    const exitFeeEst = margin * 0.001;
    const pnl    = grossPnl - exitFeeEst;  // net after fee
    const pnlPct = (pnl / Math.max(margin,1)) * 100;
    const entryPriceStr=isLong?fmtPrice(p.avgCost):fmtPrice(p.entryPrice);
    const color=isLong?'var(--green)':'var(--amber)';
    const closeAction=isLong?'close_long':'close_short';
    // TP button: net profit >= 0.2% | CL button: net loss >= 0.8%
    let actionBtn='';
    if(pnlPct>=0.2){
      actionBtn=`<button class="btn-tp" onclick="quickClose('${id}','${closeAction}')">✓ TAKE PROFIT +${pnlPct.toFixed(2)}%</button>`;
    } else if(pnlPct<=-0.8){
      actionBtn=`<button class="btn-cl" onclick="quickClose('${id}','${closeAction}')">⚠ CUT LOSS ${pnlPct.toFixed(2)}%</button>`;
    }
    return `<div class="holding" style="border-color:${color}">
      <div class="holding-row">
        <div>
          <div class="holding-name" style="color:${color}">${isLong?'📈 LONG':'📉 SHORT'} ${id} <span style="font-size:9px;background:${color}22;border:1px solid ${color}55;border-radius:3px;padding:1px 4px;">${lev}x</span></div>
          <div class="holding-qty">${p.qty.toFixed(4)} @$${entryPriceStr}</div>
          ${(p.slPct||p.tpPct)?`<div style="font-size:9px;color:var(--text2);margin-top:2px;">${p.tpPct?`🎯TP:${p.tpPct}%`:''} ${p.slPct?`🛑SL:${p.slPct}%`:''}</div>`:''}
        </div>
        <div>
          <div class="holding-value" style="color:${color}">$${fmtUSD(margin)}</div>
          <div style="font-size:10px;font-family:'Share Tech Mono',monospace;color:${pnl>=0?'var(--green)':'var(--red)'};text-align:right">${pnl>=0?'+':''}$${fmtUSD(pnl)} (${pnlPct>=0?'+':''}${pnlPct.toFixed(2)}%)</div>
        </div>
      </div>
      ${actionBtn}
    </div>`;
  }).join('');
  document.getElementById('user-holdings').innerHTML=holdHtml||'<div style="color:var(--text2);font-size:11px;text-align:center;padding:8px">No open positions.</div>';

  // ── BATTLE METRIC: use real portfolio value (includes unrealized PnL) ──
  // aiTotal & userTotal already calculated above in this same updateUI call
  const aiPortfolio=aiTotal;    // cash + all open positions mark-to-market
  const userPortfolio=userTotal;
  const aiPnlPct=((aiPortfolio-1000)/1000)*100;
  const userPnlPct=((userPortfolio-1000)/1000)*100;
  const portfolioGap=Math.abs(userPortfolio-aiPortfolio);

  // Dynamic header portfolio cards
  const statsEl = document.getElementById('hdr-stats');
  if(statsEl){
    const aiColor  = aiPortfolio >= 1000 ? 'var(--green)' : 'var(--red)';
    const uColor   = userPortfolio >= 1000 ? 'var(--green)' : 'var(--red)';
    const gap      = portfolioGap;
    const leader   = userPortfolio >= aiPortfolio ? '👤 YOU' : '🤖 AI';
    const leaderC  = userPortfolio >= aiPortfolio ? 'var(--cyan)' : 'var(--purple)';
    statsEl.innerHTML =
      `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:center">
        <span style="font-size:10px;color:var(--text2)">🤖 AI</span>
        <span style="font-size:12px;font-weight:700;color:${aiColor};font-family:'Orbitron',monospace">$${fmtUSD(aiPortfolio)}</span>
        <span style="font-size:9px;color:var(--text2);padding:0 4px">vs</span>
        <span style="font-size:10px;color:var(--text2)">👤 YOU</span>
        <span style="font-size:12px;font-weight:700;color:${uColor};font-family:'Orbitron',monospace">$${fmtUSD(userPortfolio)}</span>
        <span style="font-size:9px;background:${leaderC}22;border:1px solid ${leaderC}44;border-radius:4px;padding:1px 6px;color:${leaderC}">
          ${leader} +$${fmtUSD(gap)}
        </span>
      </div>`;
  }

  // Daily reset check
  checkDailyReset();

  // Header: show portfolio value as points display (more meaningful)
  const aiL=state.aiLosses||0,uL=state.userLosses||0;
  document.getElementById('ai-wins').textContent=state.aiWins+'W/'+aiL+'L';
  document.getElementById('user-wins').textContent=state.userWins+'W/'+uL+'L';
  // ── AI Mood & Streak display ──
  const winStreakVal=(state.aiWins||0)-(state.aiLosses||0);
  const moodEl=document.getElementById('ai-mood-display');
  if(moodEl){
    const streakStr=winStreakVal>=0?`+${winStreakVal}🔥`:`${winStreakVal}💔`;
    // Calculate current AI leverage for display (same logic as executeAITrade)
    let _dispLev=LEVERAGE_CONFIG.aiLeverage||5;
    const _mxL=LEVERAGE_CONFIG.aiMaxLeverage||10;
    // Show what leverage AI *would* use next trade (approx, no regime context here)
    if(aiMemory.mood==='CONFIDENT') _dispLev=Math.min(_mxL,_dispLev+2);
    else if(aiMemory.mood==='CAUTIOUS') _dispLev=Math.max(1,_dispLev-2);
    else if(aiMemory.mood==='REVENGE') _dispLev=Math.max(2,_dispLev-1);
    _dispLev=Math.round(_dispLev);
    moodEl.textContent=`MOOD: ${aiMemory.mood||'NEUTRAL'} | LEV: ${_dispLev}x | STREAK: ${streakStr}`;
    const moodColors={CONFIDENT:'var(--green)',REVENGE:'var(--red)',CAUTIOUS:'var(--amber)',NEUTRAL:'var(--text2)'};
    moodEl.style.color=moodColors[aiMemory.mood]||'var(--text2)';
  }

  // ── AI INDICATORS LIVE DISPLAY ──────────────────────────────
  const indEl = document.getElementById('ai-indicators');
  if(indEl){
    const selKey = `${state.selectedCoin}_${state.tf}`;
    const indData = candleData[selKey];
    if(indData && indData.length >= 30){
      const ind = calcAdvancedIndicators(indData, higherTFData[state.selectedCoin]);
      const mkt2 = getMarketRegime();
      if(ind){
        const chip=(label,val,color)=>`<span style="display:inline-flex;align-items:center;gap:2px;font-size:9px;padding:2px 5px;border-radius:4px;border:1px solid ${color}44;background:${color}11;color:${color};font-family:'JetBrains Mono',monospace;margin:1px 1px 1px 0">${label}<b>${val}</b></span>`;
        const rsiC  = ind.rsi>65?'var(--red)':ind.rsi<35?'var(--cyan)':'var(--text2)';
        const adxC  = ind.adx>25?'var(--green)':'var(--amber)';
        const macdC = (ind.macd||0)>0?'var(--green)':'var(--red)';
        const emaC  = ind.ema9>ind.ema21?'var(--green)':'var(--red)';
        const atrPct = ind.atrPct!=null?ind.atrPct:(ind.atr&&livePrices[state.selectedCoin]?(ind.atr/livePrices[state.selectedCoin]*100):0);
        const atrC  = atrPct>1.5?'var(--red)':atrPct>0.5?'var(--amber)':'var(--text2)';
        const stoch = ind.stochRsi!=null?ind.stochRsi:50;
        const stochC= stoch>80?'var(--red)':stoch<20?'var(--cyan)':'var(--text2)';
        const regC  = {'STRONG_BULL':'#00ff88','BULL':'var(--green)','STRONG_BEAR':'#ff4466','BEAR':'var(--red)','CHOP':'var(--amber)'}[mkt2.regime]||'var(--text2)';
        indEl.innerHTML =
          '<div style="font-size:9px;color:var(--text2);margin-bottom:3px;letter-spacing:0.05em">⚡ AI INDICATORS — LIVE</div><div style="display:flex;flex-wrap:wrap;gap:0">' +
          chip('RSI ', ind.rsi.toFixed(0), rsiC) +
          chip('MACD ', (ind.macd||0)>0?'+'+((ind.macd||0).toFixed(1)):((ind.macd||0).toFixed(1)), macdC) +
          chip('ADX ', ind.adx.toFixed(0), adxC) +
          chip('EMA ', ind.ema9>ind.ema21?'▲':'▼', emaC) +
          chip('ATR% ', atrPct.toFixed(2), atrC) +
          chip('SRSI ', stoch.toFixed(0), stochC) +
          chip('REGIME ', mkt2.regime.replace('STRONG_','S·'), regC) +
          '</div>';
      }
    } else {
      indEl.innerHTML='<div style="font-size:9px;color:var(--text2);text-align:center;padding:4px">Loading indicators...</div>';
    }
  }

  // Null-safe portfolio display (IDs may not exist in all layouts)
  {const e=document.getElementById('ai-points');if(e)e.textContent='$'+fmtUSD(aiPortfolio);}
  {const e=document.getElementById('user-points');if(e)e.textContent='$'+fmtUSD(userPortfolio);}
  {const e=document.getElementById('daily-date');if(e)e.textContent=state.dailyDate;}
  // POINTS SYSTEM: Show DAILY pts in header (resets 5AM IST), lifetime below
  const aiDisplayPts   = dailyPts.ai   || 0;
  const userDisplayPts = dailyPts.user || 0;
  const aiPtsEl   = document.getElementById('ai-pts-display');
  const userPtsEl = document.getElementById('user-pts-display');
  if(aiPtsEl){
    aiPtsEl.textContent = aiDisplayPts;
    aiPtsEl.dataset.prev = aiDisplayPts;
    aiPtsEl.style.color = 'var(--purple)';
    aiPtsEl.title = 'AI daily pts (5AM IST reset) | Lifetime: ' + lifetimePts.ai;
  }
  if(userPtsEl){
    userPtsEl.textContent = userDisplayPts;
    userPtsEl.dataset.prev = userDisplayPts;
    userPtsEl.style.color = 'var(--green)';
    userPtsEl.title = 'Your daily pts (5AM IST reset) | Lifetime: ' + lifetimePts.user;
  }
  // Show lifetime pts below daily pts
  const aiLifeEl = document.getElementById('ai-lifetime-display');
  const userLifeEl = document.getElementById('user-lifetime-display');
  if(aiLifeEl) aiLifeEl.textContent = (lifetimePts.ai || 0).toLocaleString();
  if(userLifeEl) userLifeEl.textContent = (lifetimePts.user || 0).toLocaleString();

  // Leaderboard — rank by portfolio value
  const aiLbStr=`${(aiPnlPct>=0?'+':'')}${aiPnlPct.toFixed(2)}%`;
  const userLbStr=`${(userPnlPct>=0?'+':'')}${userPnlPct.toFixed(2)}%`;
  // Winner = higher portfolio value (fair — not wins count, not lifetime pts)
  const aiIsLeading = aiPortfolio >= userPortfolio;
  const l1 = {
    name: aiIsLeading ? '🤖 AI' : '👤 YOU',
    portfolio: aiIsLeading ? aiPortfolio : userPortfolio,
    pts: aiIsLeading ? aiDisplayPts : userDisplayPts,
    lifePts: aiIsLeading ? lifetimePts.ai : lifetimePts.user,
    pnl: aiIsLeading ? aiLbStr : userLbStr,
    wins: aiIsLeading ? state.aiWins : state.userWins,
    losses: aiIsLeading ? state.aiLosses : state.userLosses,
  };
  const l2 = {
    name: aiIsLeading ? '👤 YOU' : '🤖 AI',
    portfolio: aiIsLeading ? userPortfolio : aiPortfolio,
    pts: aiIsLeading ? userDisplayPts : aiDisplayPts,
    lifePts: aiIsLeading ? lifetimePts.user : lifetimePts.ai,
    pnl: aiIsLeading ? userLbStr : aiLbStr,
    wins: aiIsLeading ? state.userWins : state.aiWins,
    losses: aiIsLeading ? state.userLosses : state.aiLosses,
  };
  // Leaderboard: portfolio + today's pts + lifetime total
  document.getElementById('leader-1-name').textContent = l1.name;
  document.getElementById('leader-1-wins').textContent = `${l1.wins}W/${l1.losses}L`;
  document.getElementById('leader-1-points').textContent = `$${fmtUSD(l1.portfolio)} | +${l1.pts}PTS`;
  const l1tot = document.getElementById('leader-1-total');
  if(l1tot) l1tot.textContent = l1.lifePts > 0 ? `🏆${l1.lifePts.toLocaleString()}` : '';
  document.getElementById('leader-2-name').textContent = l2.name;
  document.getElementById('leader-2-wins').textContent = `${l2.wins}W/${l2.losses}L`;
  document.getElementById('leader-2-points').textContent = `$${fmtUSD(l2.portfolio)} | +${l2.pts}PTS`;
  const l2tot = document.getElementById('leader-2-total');
  if(l2tot) l2tot.textContent = l2.lifePts > 0 ? `🏆${l2.lifePts.toLocaleString()}` : '';

  // Battle status — compare actual portfolio value (fair, includes open positions)
  const rc=document.getElementById('reward-card'),rt=document.getElementById('reward-text'),ra=document.getElementById('reward-amount'),ri=document.getElementById('reward-icon');
  const gapStr=`$${fmtUSD(portfolioGap)} | AI:${aiPnlPct>=0?'+':''}${aiPnlPct.toFixed(2)}% YOU:${userPnlPct>=0?'+':''}${userPnlPct.toFixed(2)}%`;
  if(aiPortfolio>userPortfolio+0.01){
    rc.className='reward-card penalty';ri.textContent='🤖';
    rt.className='reward-text penalty';rt.textContent='AI PORTFOLIO WINNING';
    ra.className='reward-amount penalty';ra.textContent=gapStr;
  }else if(userPortfolio>aiPortfolio+0.01){
    rc.className='reward-card';ri.textContent='🏆';
    rt.className='reward-text';rt.textContent='YOUR PORTFOLIO WINNING!';
    ra.className='reward-amount';ra.textContent=gapStr;
    // Occasional confetti when user is leading
    if(Math.random()<0.04)spawnParticles(Math.random()*window.innerWidth,0,'#00ff88',8);
    // On-chain save happens on RESET or manual button only (not every second)
  }else{
    rc.className='reward-card';ri.textContent='⚔️';
    rt.className='reward-text';rt.textContent='TIED BATTLE';
    ra.className='reward-amount';ra.textContent='Make a move!';
  }

  // Stats
  const total=state.aiTradeLog.length+state.userTradeLog.length;
  const userCloses=state.userTradeLog.filter(t=>(t.type==='close_long'||t.type==='close_short')&&t.pnl!=null);
  const winRate=userCloses.length?((userCloses.filter(t=>t.pnl>0).length/userCloses.length)*100).toFixed(1):0;
  document.getElementById('stat-total-trades').textContent=total;
  document.getElementById('stat-winrate').textContent=winRate+'%';
  document.getElementById('stat-lead').textContent=userPortfolio>=aiPortfolio?'👤 YOU':'🤖 AI';

  // Timer — countdown to next 5 AM IST reset
  const diff=msUntil5AMIST(),hrs=Math.floor(diff/3600000),mins=Math.floor((diff%3600000)/60000),secs=Math.floor((diff%60000)/1000);
  document.getElementById('stat-time-left').textContent=`${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;

  updateTicker();
  // Update wallet badge (daily + lifetime) on every UI tick
  if(walletAddress) updateWalletBadge();
  checkWinEvents();
  flashIfChanged('ai-points',aiPortfolio,_prevAiPort);
  flashIfChanged('user-points',userPortfolio,_prevUserPort);
  _prevAiPort=aiPortfolio;_prevUserPort=userPortfolio;
  drawChart();
  updateAISignal();
  updateTierBadge();
}

// ---- HELPERS ----
function selectCoin(id){
  state.selectedCoin=id;
  if(!candleData[`${id}_${state.tf}`])loadAllCandles().then(updateUI);
  else updateUI();
}
function setTf(tf){
  state.tf=tf;
  document.querySelectorAll('.tf-btn').forEach(b=>b.classList.toggle('active',b.textContent===tf.toUpperCase()));
  loadAllCandles().then(updateUI);
}
function fmtPrice(p,coin){if(!p)return '—';if(p>=10000)return p.toLocaleString('en',{maximumFractionDigits:0});if(p>=100)return p.toFixed(2);if(p>=1)return p.toFixed(3);return p.toFixed(5);}
function fmtUSD(n){return Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');}
// ── SOUND ENGINE ──
const AC=new(window.AudioContext||window.webkitAudioContext)();
function resumeAC(){if(AC.state==='suspended')AC.resume();}
document.addEventListener('click',resumeAC,{once:true});

function playSound(type){
  try{
    resumeAC();
    const g=AC.createGain();g.connect(AC.destination);
    const now=AC.currentTime;
    if(type==='profit'){
      // Rising arpeggio (win sound)
      [[261,0],[329,0.08],[392,0.16],[523,0.24]].forEach(([f,t])=>{
        const o=AC.createOscillator();o.connect(g);o.type='sine';
        o.frequency.setValueAtTime(f,now+t);g.gain.setValueAtTime(0.18,now+t);g.gain.exponentialRampToValueAtTime(0.001,now+t+0.25);
        o.start(now+t);o.stop(now+t+0.3);
      });
    }else if(type==='loss'){
      // Descending thud
      [[220,0],[185,0.1],[155,0.2]].forEach(([f,t])=>{
        const o=AC.createOscillator();o.connect(g);o.type='sawtooth';
        o.frequency.setValueAtTime(f,now+t);g.gain.setValueAtTime(0.12,now+t);g.gain.exponentialRampToValueAtTime(0.001,now+t+0.25);
        o.start(now+t);o.stop(now+t+0.3);
      });
    }else if(type==='short'){
      // Tense pulse
      [440,550,440].forEach((f,i)=>{
        const o=AC.createOscillator();o.connect(g);o.type='square';
        o.frequency.setValueAtTime(f,now+i*0.07);g.gain.setValueAtTime(0.08,now+i*0.07);g.gain.exponentialRampToValueAtTime(0.001,now+i*0.07+0.12);
        o.start(now+i*0.07);o.stop(now+i*0.07+0.15);
      });
    }else if(type==='reward'){
      // Fanfare
      [[523,0],[659,0.1],[784,0.2],[1047,0.3]].forEach(([f,t])=>{
        const o=AC.createOscillator();o.connect(g);o.type='triangle';
        o.frequency.setValueAtTime(f,now+t);g.gain.setValueAtTime(0.2,now+t);g.gain.exponentialRampToValueAtTime(0.001,now+t+0.35);
        o.start(now+t);o.stop(now+t+0.4);
      });
    }else{
      // Click tick
      const o=AC.createOscillator();o.connect(g);o.type='sine';
      o.frequency.setValueAtTime(880,now);g.gain.setValueAtTime(0.07,now);g.gain.exponentialRampToValueAtTime(0.001,now+0.1);
      o.start(now);o.stop(now+0.12);
    }
  }catch(e){}
}

// ── CHARACTER SYSTEM ──
const charAI = document.getElementById('char-ai');
const charUser = document.getElementById('char-user');
const aiBadge = document.getElementById('ai-status-badge');
const userBadge = document.getElementById('user-status-badge');
let charAITimer = null, charUserTimer = null;

function setCharAnim(charEl, badge, anim, label, color, duration=1200){
  if(!charEl) return;
  charEl.className = 'char-svg-wrap ' + anim;
  if(badge){ badge.textContent = label; badge.style.color = color; }
  clearTimeout(charAITimer);
  if(charEl === charAI){
    charAITimer = setTimeout(()=>{ charEl.className='char-svg-wrap idle'; if(badge){badge.textContent='STANDBY';badge.style.color='var(--purple)';} }, duration);
  } else {
    charUserTimer = setTimeout(()=>{ charEl.className='char-svg-wrap idle-flip'; if(badge){badge.textContent='READY';badge.style.color='var(--green)';} }, duration);
  }
}

function spawnCharFloat(text, color, isLeft){
  const arena = document.getElementById('char-arena');
  if(!arena) return;
  const el = document.createElement('div');
  el.className = 'char-float';
  el.textContent = text;
  el.style.cssText = `color:${color};text-shadow:0 0 10px ${color};left:${isLeft?'15px':'auto'};right:${isLeft?'auto':'15px'};bottom:70px;`;
  arena.appendChild(el);
  setTimeout(()=>el.remove(), 1000);
}

function spawnArenaEffect(emoji, isLeft){
  const arena = document.getElementById('char-arena');
  if(!arena) return;
  const el = document.createElement('div');
  el.className = 'lightning-effect';
  el.textContent = emoji;
  el.style.cssText = `left:${isLeft?'50px':'auto'};right:${isLeft?'auto':'50px'};bottom:${40+Math.random()*20}px;`;
  arena.appendChild(el);
  setTimeout(()=>el.remove(), 700);
}

function updateHPBars(){
  // Treat portfolio value as HP: 0 = $0, full = $1500 (cap)
  const aiTotal = parseFloat(document.getElementById('ai-cash')?.textContent?.replace(/[$,]/g,'')||1000);
  const userCashEl = document.getElementById('user-cash');
  const userTotal = parseFloat(userCashEl?.textContent?.replace(/[$,]/g,'')||1000);
  const aiPct = Math.max(0, Math.min(100, (aiTotal/1500)*100));
  const userPct = Math.max(0, Math.min(100, (userTotal/1500)*100));

  const aiBar = document.getElementById('ai-hp-bar');
  const userBar = document.getElementById('user-hp-bar');
  if(aiBar){
    aiBar.style.width = aiPct + '%';
    aiBar.className = 'char-hp-bar' + (aiPct<30?' critical':aiPct<50?' low':'');
  }
  if(userBar){
    userBar.style.width = userPct + '%';
    userBar.className = 'char-hp-bar' + (userPct<30?' critical':userPct<50?' low':'');
  }

  // Update battle result text
  const brt = document.getElementById('battle-result-text');
  if(brt){
    if(aiTotal > userTotal+0.5) brt.textContent = '🤖 AI LEADING';
    else if(userTotal > aiTotal+0.5) brt.textContent = '👤 YOU WINNING!';
    else brt.textContent = 'DEAD HEAT ⚔️';
  }
}

// ── HOOK: AI Trade Events ──
const _origExecAI = executeAITrade;
window.executeAITrade = function(side, amount, coinId){
  _origExecAI(side, amount, coinId);
  const price = livePrices[coinId||state.selectedCoin];
  setTimeout(()=>{
    if(side==='buy'){
      setCharAnim(charAI, aiBadge, 'attack', 'BUY!', 'var(--green)', 900);
      spawnArenaEffect('⚡', true);
      spawnCharFloat('BUY', '#00ff88', true);
    } else if(side==='sell'){
      // Check if it was profit
      const lastTrade = state.aiTradeLog[0];
      const wasPnl = lastTrade?.pnl;
      if(wasPnl > 0){
        setCharAnim(charAI, aiBadge, 'win', 'WIN! 🏆', 'var(--green)', 1400);
        spawnArenaEffect('🌟', true);
        spawnCharFloat('+$'+Math.abs(wasPnl||0).toFixed(2), '#00ff88', true);
        spawnParticles(70, window.innerHeight*0.4, '#cc44ff', 20);
      } else {
        setCharAnim(charAI, aiBadge, 'lose', 'LOSS 💀', 'var(--red)', 1200);
        spawnCharFloat('-$'+Math.abs(wasPnl||0).toFixed(2), '#ff3355', true);
      }
    } else if(side==='short'){
      setCharAnim(charAI, aiBadge, 'attack', 'SHORT!', 'var(--amber)', 900);
      spawnArenaEffect('🗡️', true);
      spawnCharFloat('SHORT', '#ffaa00', true);
    } else if(side==='close_short'){
      const lastTrade = state.aiTradeLog[0];
      const wasPnl = lastTrade?.pnl;
      if(wasPnl > 0){
        setCharAnim(charAI, aiBadge, 'win', 'WIN! 🏆', 'var(--green)', 1400);
        spawnArenaEffect('✨', true);
        spawnCharFloat('+$'+Math.abs(wasPnl||0).toFixed(2), '#00ff88', true);
        spawnParticles(70, window.innerHeight*0.4, '#cc44ff', 15);
      } else {
        setCharAnim(charAI, aiBadge, 'lose', 'LOSS 💀', 'var(--red)', 1200);
        spawnCharFloat('-$'+Math.abs(wasPnl||0).toFixed(2), '#ff3355', true);
      }
    }
    updateHPBars();
  }, 50);
};

// ── HOOK: User Trade Events ──
const _origUserTrade = placeUserFuturesTrade;
window.placeUserFuturesTrade = function(side, evt){
  _origUserTrade(side, evt);
  setTimeout(()=>{
    if(side==='long'){
      setCharAnim(charUser, userBadge, 'attack-flip', 'LONG! 📈', 'var(--green)', 900);
      spawnArenaEffect('⚡', false);
      spawnCharFloat('LONG', '#00ff88', false);
    } else if(side==='short'){
      setCharAnim(charUser, userBadge, 'attack-flip', 'SHORT! 📉', 'var(--amber)', 900);
      spawnArenaEffect('🗡️', false);
      spawnCharFloat('SHORT', '#ffaa00', false);
    } else if(side==='close_long'||side==='close_short'){
      // Read last user trade for pnl
      const lastT = state.userTradeLog[0];
      const pnl = lastT?.pnl;
      if(pnl > 0){
        setCharAnim(charUser, userBadge, 'win-flip', 'WIN! 🏆', 'var(--green)', 1600);
        spawnArenaEffect('🌟', false);
        spawnArenaEffect('💥', false);
        spawnCharFloat('+$'+Math.abs(pnl).toFixed(2), '#00ff88', false);
        // Big particle burst for user win
        spawnParticles(window.innerWidth-80, window.innerHeight*0.4, '#00ff88', 30);
        spawnParticles(window.innerWidth/2, window.innerHeight*0.35, '#00d4ff', 20);
        screenFlash('#00ff88');
      } else if(pnl < 0){
        setCharAnim(charUser, userBadge, 'lose', 'OUCH! 💀', 'var(--red)', 1200);
        spawnCharFloat('-$'+Math.abs(pnl).toFixed(2), '#ff3355', false);
        spawnArenaEffect('💥', false);
        screenFlash('#ff3355');
      }
    }
    updateHPBars();
  }, 80);
};

// Periodic idle HP update
setInterval(updateHPBars, 3000);


// ── WIN CELEBRATION ──
let _prevAiWins=state.aiWins||0, _prevUserWins=state.userWins||0;
let _prevAiPts=lifetimePts.ai, _prevUserPts=lifetimePts.user;

function spawnFirecrackers(cx, cy, color){
  // Launch 3 rockets then burst
  const rockets=['🎆','🎇','✨'];
  rockets.forEach((r,i)=>{
    setTimeout(()=>{
      const rx=cx + (Math.random()-0.5)*120;
      const el=document.createElement('div');
      el.className='firecracker-rocket';
      el.textContent=r;
      el.style.cssText=`left:${rx}px;top:${cy+20}px;`;
      document.body.appendChild(el);
      // On rocket reaching top, burst
      setTimeout(()=>{
        el.remove();
        const burstEmojis=['🌟','⭐','💥','✨','🔥','💫'];
        const glowEl=document.createElement('div');
        glowEl.className='firecracker-glow';
        glowEl.style.cssText=`left:${rx-40}px;top:${cy-80}px;background:radial-gradient(circle,${color}99 0%,transparent 70%)`;
        document.body.appendChild(glowEl);
        setTimeout(()=>glowEl.remove(),600);
        for(let j=0;j<8;j++){
          const angle=(j/8)*Math.PI*2;
          const dist=50+Math.random()*50;
          const bel=document.createElement('div');
          bel.className='firecracker-burst';
          bel.textContent=burstEmojis[Math.floor(Math.random()*burstEmojis.length)];
          bel.style.cssText=`left:${rx}px;top:${cy-80}px;--fx:${Math.cos(angle)*dist}px;--fy:${Math.sin(angle)*dist}px;font-size:${12+Math.random()*8}px`;
          document.body.appendChild(bel);
          setTimeout(()=>bel.remove(),700);
        }
      },480);
    }, i*180);
  });
}

function celebrateWin(isUser, pnl){
  const color = isUser ? '#00ff88' : '#cc44ff';
  const cardId = isUser ? 'sc-user-wins' : 'sc-ai-wins';
  const ptsId  = isUser ? 'sc-user-pts'  : 'sc-ai-pts';
  const x = isUser ? window.innerWidth*0.82 : window.innerWidth*0.18;
  const y = 130;
  const card=document.getElementById(cardId);
  if(card){card.style.setProperty('--fw-color',color);card.classList.remove('win-celebrate');void card.offsetWidth;card.classList.add('win-celebrate');setTimeout(()=>card.classList.remove('win-celebrate'),800);}
  const pcard=document.getElementById(ptsId);
  if(pcard){pcard.style.setProperty('--fw-color',color);pcard.classList.remove('win-celebrate');void pcard.offsetWidth;pcard.classList.add('win-celebrate');setTimeout(()=>pcard.classList.remove('win-celebrate'),800);}
  spawnParticles(x, y, color, 25);
  spawnFirecrackers(x, y, color);
  floatPnl('+$'+pnl.toFixed(2)+' 🏆', color, x, y+40);
  screenFlash(color);
  if(isUser){setCharAnim(charUser,userBadge,'win-flip','WIN!🏆','var(--green)',1600);spawnArenaEffect('🌟',false);}
  else{setCharAnim(charAI,aiBadge,'win','WIN!🏆','var(--purple)',1600);spawnArenaEffect('🌟',true);}
  playSound('reward');
}

function spawnSadCryEffect(cx, cy){
  // Big cry emoji center
  const cryEl=document.createElement('div');
  cryEl.className='cry-emoji';
  cryEl.textContent='😢';
  cryEl.style.cssText=`left:${cx-16}px;top:${cy-30}px`;
  document.body.appendChild(cryEl);
  setTimeout(()=>cryEl.remove(),1200);

  // Rain of tears
  for(let i=0;i<10;i++){
    setTimeout(()=>{
      const tx=cx+(Math.random()-0.5)*100;
      const tel=document.createElement('div');
      tel.className='tear-drop';
      tel.textContent='💧';
      tel.style.cssText=`left:${tx}px;top:${cy-20+Math.random()*20}px`;
      document.body.appendChild(tel);
      setTimeout(()=>tel.remove(),900);
    }, i*80);
  }

  // Sad cloud above
  const cloudEl=document.createElement('div');
  cloudEl.className='sad-cloud';
  cloudEl.textContent='🌧️';
  cloudEl.style.cssText=`left:${cx-14}px;top:${cy-60}px`;
  document.body.appendChild(cloudEl);
  setTimeout(()=>cloudEl.remove(),1400);

  // Broken heart float
  const heartEl=document.createElement('div');
  heartEl.className='cry-emoji';
  heartEl.textContent='💔';
  heartEl.style.cssText=`left:${cx+30}px;top:${cy-10}px;font-size:20px;animation-delay:0.2s`;
  document.body.appendChild(heartEl);
  setTimeout(()=>heartEl.remove(),1400);
}

function celebrateLoss(isUser, pnl){
  const color='#ff3355';
  const x = isUser ? window.innerWidth*0.82 : window.innerWidth*0.18;
  floatPnl('-$'+Math.abs(pnl).toFixed(2)+' 💀', color, x, 160);
  screenFlash(color);
  spawnSadCryEffect(x, 160);
  if(isUser)setCharAnim(charUser,userBadge,'lose','LOSS💀','var(--red)',1200);
  else setCharAnim(charAI,aiBadge,'lose','LOSS💀','var(--red)',1200);
}

function checkWinEvents(){
  if(state.aiWins>_prevAiWins){
    const lastT=state.aiTradeLog.find(t=>t.pnl!=null&&t.pnl>0);
    celebrateWin(false, lastT?.pnl||1);
    _prevAiWins=state.aiWins;
  }
  if(state.userWins>_prevUserWins){
    const lastT=state.userTradeLog.find(t=>t.pnl!=null&&t.pnl>0);
    celebrateWin(true, lastT?.pnl||1);
    _prevUserWins=state.userWins;
  }
  // Loss detection
  if(lifetimePts.ai<_prevAiPts){
    const lastT=state.aiTradeLog.find(t=>t.pnl!=null&&t.pnl<0);
    if(lastT)celebrateLoss(false,lastT.pnl);
  }
  _prevAiPts=lifetimePts.ai;
  _prevUserPts=lifetimePts.user;
}

const pCanvas=document.getElementById('particle-canvas');
const pCtx=pCanvas.getContext('2d');
let particles=[];
function resizePC(){pCanvas.width=window.innerWidth;pCanvas.height=window.innerHeight;}
window.addEventListener('resize',resizePC);resizePC();

function spawnParticles(x,y,color,count=18){
  // Safety cap: if the tab was backgrounded (rAF throttled/stopped) while
  // trades kept coming in via the 6s state poll, don't let this grow forever.
  if(particles.length>1000) particles.splice(0, particles.length-500);
  for(let i=0;i<count;i++){
    const angle=Math.random()*Math.PI*2;
    const speed=2+Math.random()*6;
    particles.push({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-3,life:1,color,size:3+Math.random()*4,decay:0.025+Math.random()*0.02});
  }
}
function animParticles(){
  pCtx.clearRect(0,0,pCanvas.width,pCanvas.height);
  particles=particles.filter(p=>p.life>0);
  particles.forEach(p=>{
    pCtx.save();pCtx.globalAlpha=p.life;pCtx.fillStyle=p.color;
    pCtx.beginPath();pCtx.arc(p.x,p.y,p.size*p.life,0,Math.PI*2);pCtx.fill();pCtx.restore();
    p.x+=p.vx;p.y+=p.vy;p.vy+=0.2;p.life-=p.decay;
  });
  requestAnimationFrame(animParticles);
}
animParticles();

// ── FLOATING PnL POPUP ──
function floatPnl(msg,color,x,y){
  const el=document.createElement('div');
  el.className='float-pnl';el.textContent=msg;
  el.style.cssText=`left:${x-30}px;top:${y-20}px;color:${color};text-shadow:0 0 12px ${color}`;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),1200);
}

// ── SCREEN FLASH ──
function screenFlash(color){
  const el=document.createElement('div');
  el.style.cssText=`position:fixed;inset:0;background:${color};opacity:0.08;pointer-events:none;z-index:9997;transition:opacity 0.4s`;
  document.body.appendChild(el);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{el.style.opacity='0';setTimeout(()=>el.remove(),400);}));
}

// ── TRADE BUTTON RIPPLE ──
function ripple(btn,color){
  const r=document.createElement('span');
  const rect=btn.getBoundingClientRect();
  r.style.cssText=`position:absolute;border-radius:50%;background:${color};opacity:0.4;width:10px;height:10px;top:50%;left:50%;transform:translate(-50%,-50%) scale(0);transition:transform 0.5s,opacity 0.5s;pointer-events:none`;
  btn.style.position='relative';btn.style.overflow='hidden';btn.appendChild(r);
  requestAnimationFrame(()=>{r.style.transform='translate(-50%,-50%) scale(15)';r.style.opacity='0';});
  setTimeout(()=>r.remove(),500);
}

// ── UPGRADED NOTIFY ──
function notify(msg,type,evt){
  const el=document.getElementById('notif');el.textContent=msg;el.className=type||'';el.classList.add('show');
  playSound(type);
  // Particles at click location
  if(evt){spawnParticles(evt.clientX,evt.clientY,type==='profit'?'#00ff88':type==='loss'?'#ff3355':type==='short'?'#ffaa00':'#00d4ff');}
  // Screen flash
  if(type==='profit')screenFlash('#00ff88');
  else if(type==='loss')screenFlash('#ff3355');
  else if(type==='reward')screenFlash('#00d4ff');
  if(notifTimer)clearTimeout(notifTimer);
  notifTimer=setTimeout(()=>el.classList.remove('show'),2800);
}
let notifTimer=null;

// ── LIQUIDATION CHECKER ──────────────────────────────────────
// Futures positions get liquidated when loss >= 90% of margin
function checkLiquidations(){
  const threshold = LEVERAGE_CONFIG.liquidationThreshold; // 0.90
  let anyLiquidated = false;
  Object.entries(state.userPositions||{}).forEach(([id,p])=>{
    const cur = livePrices[id];
    if(!cur||!p.qty) return;
    const margin      = p.margin || p.invested || 0;
    const unrealizedPnl = p.side==='long'
      ? p.qty * (cur - p.avgCost)
      : p.qty * (p.entryPrice - cur);
    // Liquidation: unrealized loss >= threshold% of margin
    if(unrealizedPnl <= -margin * threshold){
      const remnant = Math.max(0, margin + unrealizedPnl); // tiny amount left
      state.userCash += remnant;
      state.userLosses++;
      state.userTradeLog.unshift({
        type:'liquidated', coin:id, qty:p.qty,
        price:cur, pnl:-(margin-remnant),
        time:new Date().toLocaleTimeString()
      });
      delete state.userPositions[id];
      anyLiquidated = true;
      notify(`⚡ LIQUIDATED! ${id} margin wiped (${p.leverage||1}x)`, 'loss');
      screenFlash('#ff3355');
      const el=document.getElementById('user-panel');
      if(el){el.style.animation='shake 0.4s ease';setTimeout(()=>el.style.animation='',500);}
    }
  });
  if(anyLiquidated){ saveState(); updateUI(); }
}

// ── INIT ──────────────────────────────────────────────────────
(async function init(){
  await loadAllCandles();
  await refreshAll();
  updateUI();
  // Restore leverage UI from saved state
  const savedLev = state.currentLeverage || LEVERAGE_CONFIG.defaultLeverage;
  document.querySelectorAll('.lev-btn').forEach(b=>{
    b.classList.toggle('active', parseInt(b.textContent)===savedLev);
  });
  const levDisp = document.getElementById('leverage-display');
  if(levDisp) levDisp.textContent = savedLev + 'x';
  _updatePosSizeDisplay();
  setInterval(updateUI,1000);
  setInterval(checkLiquidations, 500); // check liquidations every 500ms
  // ★ Show regime in AI signal box for debugging
  setInterval(()=>{
    const mkt=getMarketRegime();
    const el=document.getElementById('ai-signal-text');
    if(el){
      const regimeColor={'STRONG_BULL':'var(--green)','BULL':'var(--green)','STRONG_BEAR':'var(--red)','BEAR':'var(--red)','CHOP':'var(--amber)'};
      const shortStr=`${mkt.regime} (${mkt.bullC}↑/${mkt.bearC}↓)`;
      // Only update if it's showing regime info, not overwriting signal
      if(!el.dataset.signalOverride) el.dataset.regimeHint=shortStr;
    }
  },2000);
  setInterval(refreshAll,30000);
  if(!SERVER_AI_MODE){
    // ── AI trade loop, driven by a Web Worker tick so it keeps firing every 2s
    //    even when this tab is backgrounded/minimized (browsers throttle normal
    //    setInterval in inactive tabs, which used to stall the AI). This does NOT
    //    keep trading if the tab/browser is fully closed or the device sleeps —
    //    that requires a server-side cron job (see SERVER_AI_MODE above).
    (function startAiLoop(){
      try{
        const workerCode = "setInterval(()=>{ self.postMessage('tick'); }, 2000);";
        const blob = new Blob([workerCode], {type:'application/javascript'});
        const aiWorker = new Worker(URL.createObjectURL(blob));
        aiWorker.onmessage = () => checkAITrade();
        aiWorker.onerror = () => { aiWorker.terminate(); setInterval(checkAITrade,2000); }; // fallback if worker dies
      }catch(e){
        setInterval(checkAITrade,2000); // fallback: Workers unsupported/blocked in this environment
      }
    })();
  } else {
    // Server owns the AI now — just pull its progress into the UI periodically.
    setInterval(pollServerAiState, 6000);
  }

  // ★ Emergency audit: every 5s, force-close ALL positions that are against current regime
  setInterval(()=>{
    const mkt=getMarketRegime();
    const now=Date.now();
    // Bull market → close ALL AI shorts immediately
    if(mkt.regime==='STRONG_BULL'||mkt.regime==='BULL'){
      Object.keys(state.aiShorts).forEach(coinId=>{
        const sh=state.aiShorts[coinId];
        if(!sh)return;
        const price=livePrices[coinId];if(!price)return;
        const pct=(sh.entryPrice-price)/sh.entryPrice*100;
        const holdSec=(now-(sh.entryTs||now))/1000;
        // Close if: any loss OR held >30s in wrong market
        if(pct<=-0.15||holdSec>30||pct>=0.3){
          executeAITrade('close_short',null,coinId);
          delete aiTrailingStop[coinId];
          aiCooldown[coinId]=now;
          console.log(`[AI Emergency] Closed short ${coinId} in ${mkt.regime} market`);
        }
      });
    }
    // Bear market → close ALL AI longs immediately
    if(mkt.regime==='STRONG_BEAR'||mkt.regime==='BEAR'){
      Object.keys(state.aiHoldings).forEach(coinId=>{
        const h=state.aiHoldings[coinId];
        if(!h||h.qty<=1e-6)return;
        const price=livePrices[coinId];if(!price)return;
        const pct=(price-h.avgCost)/h.avgCost*100;
        const holdSec=(now-(h.entryTs||now))/1000;
        if(pct<=-0.15||holdSec>30||pct>=0.3){
          executeAITrade('sell',null,coinId);
          delete aiTrailingStop[coinId];
          aiCooldown[coinId]=now;
          console.log(`[AI Emergency] Closed long ${coinId} in ${mkt.regime} market`);
        }
      });
    }
  },5000);
  // FIX: Refresh ALL coins candle data (not just selected coin — AI needs fresh data for all 4)
  setInterval(async()=>{
    for(const coin of COINS){
      try{
        const key=`${coin.id}_${state.tf}`;
        const data=await fetchKlines(coin.symbol,state.tf,80);
        if(data)candleData[key]=data;
        await new Promise(r=>setTimeout(r,400)); // stagger to avoid rate limit
      }catch(e){}
    }
  },20000);
  window.addEventListener('resize',drawChart);
})();
// ══════════════════════════════════════════════
// WALLET SYSTEM v2 — MetaMask
// ══════════════════════════════════════════════
const SEPOLIA_CHAIN_ID = '0xaa36a7';
const WALLET_STORE = 'aiBattleWallet';
let walletAddress = null;
let walletSaveTs = null;


// ── Detect environment ──
function isMetaMaskBrowser(){ return !!(window.ethereum && window.ethereum.isMetaMask && navigator.userAgent.includes('MetaMaskMobile')); }

// EIP-6963 announced providers store
const _eip6963Providers = [];
window.addEventListener('eip6963:announceProvider', e => {
  _eip6963Providers.push(e.detail.provider);
});
window.dispatchEvent(new Event('eip6963:requestProvider'));

function getMetaMaskProvider(){
  // EIP-6963 first (most reliable, avoids conflicts)
  const mm6963 = _eip6963Providers.find(p => p.isMetaMask && !p.isBraveWallet && !p.isCoinbaseWallet && !p.isNightly);
  if(mm6963) return mm6963;
  // window.ethereum.providers array (multiple wallets installed)
  if(window.ethereum && window.ethereum.providers){
    const mm = window.ethereum.providers.find(p => p.isMetaMask && !p.isBraveWallet && !p.isCoinbaseWallet && !p.isNightly);
    if(mm) return mm;
  }
  // Direct window.ethereum — but only if it's actually MetaMask
  if(window.ethereum && window.ethereum.isMetaMask && !window.ethereum.isNightly) return window.ethereum;
  // Last resort: any ethereum provider (handles Nightly conflict case)
  if(window.ethereum) return window.ethereum;
  return null;
}
function hasMetaMask(){ return !!getMetaMaskProvider(); }
function isFileProcotol(){ return location.protocol === 'file:' || location.protocol === 'content:'; }

// ── Show connect options modal ──
function showConnectOptions(){
  const modal = document.getElementById('connect-options-modal');
  modal.style.display = 'flex';
  const mmStatus = document.getElementById('mm-ext-status');
  const mmBrowserOpt = document.getElementById('mm-browser-option');

  // Always try to detect after short delay (MetaMask injects async)
  if(mmStatus) mmStatus.textContent = '🔄 Detecting...';
  setTimeout(()=>{
    if(isMetaMaskBrowser()){
      if(mmStatus) mmStatus.textContent = '✅ MetaMask browser — click to connect';
    } else if(hasMetaMask()){
      if(mmStatus) mmStatus.textContent = '✅ Detected — click to connect';
    } else {
      if(mmStatus) mmStatus.textContent = '🦊 Click to connect or install';
      if(mmBrowserOpt) mmBrowserOpt.style.display = 'block';
    }
  }, 300);

  if(isFileProcotol() && mmBrowserOpt) mmBrowserOpt.style.display = 'block';
}
function closeConnectOptions(){ document.getElementById('connect-options-modal').style.display='none'; }

// ── Option 1: Open file in MetaMask built-in browser ──
function openInMetaMaskBrowser(){
  closeConnectOptions();
  // Get current file path and open in MetaMask browser
  const filePath = location.href;
  // Try to open MetaMask app with deep link
  const mmDeepLink = 'metamask://browser/open?url=' + encodeURIComponent(filePath);
  showToast('🦊 Opening MetaMask browser...','var(--amber)');
  // Show instructions modal
  showMMBrowserInstructions(filePath);
}

function showMMBrowserInstructions(filePath){
  const d = document.createElement('div');
  d.id = 'mm-instructions';
  d.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:10003;display:flex;align-items:center;justify-content:center';
  d.innerHTML=`
    <div style="background:var(--bg3);border:1px solid var(--amber);border-radius:8px;padding:24px;max-width:340px;width:90%">
      <div style="font-family:'Orbitron',monospace;font-size:13px;font-weight:700;color:var(--amber);letter-spacing:2px;text-align:center;margin-bottom:16px">🦊 METAMASK BROWSER</div>
      <div style="font-size:12px;color:var(--text);font-family:'Share Tech Mono',monospace;line-height:1.8;margin-bottom:16px">
        <div style="color:var(--cyan);margin-bottom:8px">Steps to open in MetaMask:</div>
        <div>1️⃣ MetaMask app kholo</div>
        <div>2️⃣ Bottom tab → <span style="color:var(--amber)">Browser</span> dabao</div>
        <div>3️⃣ Address bar mein type karo:</div>
        <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:4px;padding:8px;margin:8px 0;word-break:break-all;color:var(--green);font-size:10px">${filePath}</div>
        <div>4️⃣ ✅ Wallet auto-connect hoga!</div>
      </div>
      <button onclick="navigator.clipboard&&navigator.clipboard.writeText('${filePath}').then(()=>showToast('📋 Path copied!','var(--green)'))" style="width:100%;padding:8px;font-family:'Orbitron',monospace;font-size:10px;font-weight:700;border:1px solid var(--green);background:var(--green-dim);color:var(--green);border-radius:4px;cursor:pointer;margin-bottom:8px;letter-spacing:1px">📋 COPY FILE PATH</button>
      <button onclick="document.getElementById('mm-instructions').remove()" style="width:100%;padding:8px;font-family:'Orbitron',monospace;font-size:10px;border:1px solid var(--border2);background:transparent;color:var(--text2);border-radius:4px;cursor:pointer;letter-spacing:1px">✕ CLOSE</button>
    </div>`;
  document.body.appendChild(d);
}

// ── Ensure user is on Sepolia network ──
async function ensureSepolia(){
  const eth = getMetaMaskProvider();
  if(!eth) return;
  try{
    const chainId = await eth.request({method:'eth_chainId'});
    if(chainId === SEPOLIA_CHAIN_ID) return;
    try{
      await eth.request({method:'wallet_switchEthereumChain',params:[{chainId:SEPOLIA_CHAIN_ID}]});
    }catch(e){
      if(e.code===4902){
        await eth.request({method:'wallet_addEthereumChain',params:[{
          chainId:SEPOLIA_CHAIN_ID,
          chainName:'Sepolia Testnet',
          nativeCurrency:{name:'SepoliaETH',symbol:'ETH',decimals:18},
          rpcUrls:['https://rpc.sepolia.org'],
          blockExplorerUrls:['https://sepolia.etherscan.io']
        }]});
      } else { throw e; }
    }
  }catch(e){ showToast('⚠ Switch to Sepolia: '+e.message,'var(--amber)'); }
}

// ── Option 2: MetaMask extension/injected ──
async function connectMetaMask(){
  closeConnectOptions();
  
  // Try to get provider — wait up to 1s for MetaMask to inject
  let eth = getMetaMaskProvider();
  if(!eth){
    showToast('🔄 Waiting for MetaMask...','var(--amber)');
    await new Promise(r=>setTimeout(r,800));
    eth = getMetaMaskProvider();
  }

  if(!eth){
    showToast('🦊 MetaMask not found!','var(--red)');
    setTimeout(()=>{
      if(confirm('MetaMask extension nahi mila.\n\nInstall karna hai?\n(Ya MetaMask app ka built-in browser use karo)'))
        window.open('https://metamask.io/download/','_blank');
    },400);
    return;
  }

  try{
    showToast('🦊 Connecting MetaMask...','var(--amber)');
    const accounts = await eth.request({method:'eth_requestAccounts'});
    if(!accounts || !accounts.length){showToast('❌ No accounts found','var(--red)');return;}
    await ensureSepolia(eth);
    walletAddress = accounts[0];
    onWalletConnected(accounts[0], false);
    loadWalletData(accounts[0]);
    showToast(`✅ Connected: ${shortAddr(accounts[0])}`,'var(--green)');
  }catch(err){
    if(err.code===4001) showToast('❌ Connection rejected by user','var(--red)');
    else if(err.code===-32002) showToast('⏳ MetaMask already processing — check extension!','var(--amber)');
    else showToast('❌ '+( err.message||'Connection failed'),'var(--red)');
  }
}



// ── On wallet connected ──
function onWalletConnected(address, silent){
  const btn=document.getElementById('wl-connect-btn');
  const addrEl=document.getElementById('wl-addr-display');
  const badge=document.getElementById('wl-pts-badge');
  if(btn){btn.textContent='✅ '+shortAddr(address);btn.classList.add('connected');btn.onclick=openWalletModal;}
  if(addrEl) addrEl.textContent=shortAddr(address);
  if(badge) badge.style.display='inline-flex';
  updateWalletBadge();
  const _eth = getMetaMaskProvider();
  if(_eth && !window._walletListening){
    window._walletListening=true;
    _eth.on('accountsChanged',accs=>{if(!accs.length)disconnectWallet();else if(accs[0]!==walletAddress){walletAddress=accs[0];onWalletConnected(accs[0],false);loadWalletData(accs[0]);}});
    _eth.on('chainChanged',cid=>{if(cid!==SEPOLIA_CHAIN_ID)showToast('⚠ Switch to Sepolia!','var(--amber)');});
  }
  // Wallet-keyed localStorage: same wallet = same points on all devices (after chain load)
  // Auto cloud sync on connect
  onWalletConnectCloudSync(address);
}

// ══════════════════════════════════════════════════════════════
// CROSS-DEVICE SYNC — Supabase (wallet address = primary key)
// Single source of truth. No API key setup needed.
// Same wallet on any device always sees same state.
// ══════════════════════════════════════════════════════════════



// ── Build the row object that maps to battle_states schema ──
function buildSupaSnap(){
  const today = new Date().toISOString().split('T')[0];
  // positions = { userPositions, aiHoldings, aiShorts, dailyDate, battleActive,
  //               selectedCoin, userTradeSize, _bestValue, _sizeKey, lifetimePts }
  const positions = {
    userPositions : state.userPositions || {},
    aiHoldings    : state.aiHoldings    || {},
    aiShorts      : state.aiShorts      || {},
    dailyDate     : state.dailyDate     || today,
    battleActive  : state.battleActive  || false,
    selectedCoin  : state.selectedCoin  || 'BTC',
    userTradeSize : state.userTradeSize || 500,
    userLosses    : state.userLosses    || 0,
    aiLosses      : state.aiLosses      || 0,
    _bestValue    : state._bestValue    || 1000,
    _sizeKey      : state._sizeKey      || '500',
    lifetimePts   : { ai: lifetimePts.ai, user: lifetimePts.user }
  };
  return {
    wallet_address : walletAddress.toLowerCase(),
    user_cash      : state.userCash,
    ai_cash        : state.aiCash,
    user_points    : lifetimePts.user,
    ai_points      : lifetimePts.ai,
    user_wins      : state.userWins  || 0,
    ai_wins        : state.aiWins    || 0,
    positions      : positions,
    trade_log      : {
      user : (state.userTradeLog || []).slice(0, 100),
      ai   : (state.aiTradeLog   || []).slice(0, 100)
    },
    updated_at     : new Date().toISOString()
  };
}

// ── Apply a Supabase row back into local state ──
function applySupaRow(row){
  if(!row) return false;
  try{
    state.userCash   = row.user_cash  ?? state.userCash;
    state.aiCash     = row.ai_cash    ?? state.aiCash;
    state.userWins   = row.user_wins  || 0;
    state.aiWins     = row.ai_wins    || 0;
    lifetimePts.user = row.user_points || 0;
    lifetimePts.ai   = row.ai_points   || 0;

    const p = row.positions || {};
    state.userPositions = p.userPositions || {};
    state.aiHoldings    = p.aiHoldings    || {};
    state.aiShorts      = p.aiShorts      || {};
    state.dailyDate     = p.dailyDate     || state.dailyDate;
    state.battleActive  = p.battleActive  ?? state.battleActive;
    state.selectedCoin  = p.selectedCoin  || state.selectedCoin;
    state.userTradeSize = p.userTradeSize  || state.userTradeSize;
    state.userLosses    = p.userLosses    || 0;
    state.aiLosses      = p.aiLosses      || 0;
    state._bestValue    = p._bestValue    || state._bestValue;
    state._sizeKey      = p._sizeKey      || state._sizeKey;
    if(p.lifetimePts){
      lifetimePts.user = Math.max(lifetimePts.user, p.lifetimePts.user || 0);
      lifetimePts.ai   = Math.max(lifetimePts.ai,   p.lifetimePts.ai   || 0);
    }

    const tl = row.trade_log || {};
    state.userTradeLog = tl.user || [];
    state.aiTradeLog   = tl.ai   || [];

    // Mirror to localStorage as offline fallback
    saveState();
    saveLifetimePts(lifetimePts.ai, lifetimePts.user);
    updateUI();
    updateWalletBadge();
    return true;
  }catch(e){ console.error('[Supabase] applySupaRow error:', e); return false; }
}

// ── SERVER_AI_MODE: pull the AI's server-driven progress into the UI ──
// Only touches AI-side state (ai_cash/aiHoldings/aiShorts/aiWins/aiPoints/
// aiTradeLog) — never touches the user's own cash/positions/trade log, so
// this can safely run alongside the user's own local trading at any time.
async function pollServerAiState(){
  if(!walletAddress) return;
  try{
    const url = `${SUPA_URL}/rest/v1/${SUPA_TABLE}?wallet_address=eq.${walletAddress.toLowerCase()}&select=ai_cash,ai_wins,ai_points,positions,trade_log`;
    const r = await fetch(url, { headers:{ apikey:SUPA_KEY, Authorization:'Bearer '+SUPA_KEY } });
    if(!r.ok) return;
    const rows = await r.json();
    const row = rows && rows[0];
    if(!row) return;
    state.aiCash = row.ai_cash ?? state.aiCash;
    state.aiWins = row.ai_wins || 0;
    lifetimePts.ai = Math.max(lifetimePts.ai, row.ai_points || 0);
    const p = row.positions || {};
    state.aiHoldings = p.aiHoldings || {};
    state.aiShorts   = p.aiShorts   || {};
    state.aiLosses   = p.aiLosses   || 0;
    const tl = row.trade_log || {};
    state.aiTradeLog = tl.ai || [];
    updateUI();
  }catch(e){ console.error('[ServerAI] poll failed:', e); }
}

// ── UPSERT current state to Supabase ──
async function supabaseSave(){
  if(!walletAddress) return false;
  if(SERVER_AI_MODE) return supabaseSaveUserOnly();
  const row = buildSupaSnap();
  try{
    const r = await fetch(`${SUPA_URL}/rest/v1/${SUPA_TABLE}`, {
      method  : 'POST',
      headers : {
        'Content-Type'  : 'application/json',
        'apikey'        : SUPA_KEY,
        'Authorization' : 'Bearer ' + SUPA_KEY,
        'Prefer'        : 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(row)
    });
    if(r.ok || r.status === 201){
      setSyncBadge(true);
      console.log('[Supabase] Saved at', new Date().toLocaleTimeString());
      return true;
    }
    const err = await r.text().catch(()=>'');
    console.error('[Supabase] Save failed:', r.status, err);
    setSyncBadge(false);
    return false;
  }catch(e){
    console.error('[Supabase] Network error on save:', e);
    setSyncBadge(false);
    return false;
  }
}

// ── SERVER_AI_MODE save path: writes ONLY the user's own fields via the
//    atomic merge_user_state RPC, so it can never clobber the AI's
//    server-driven progress no matter when the two writes overlap.
async function supabaseSaveUserOnly(){
  const today = new Date().toISOString().split('T')[0];
  try{
    const r = await fetch(`${SUPA_URL}/rest/v1/rpc/merge_user_state`, {
      method  : 'POST',
      headers : { 'Content-Type':'application/json', apikey:SUPA_KEY, Authorization:'Bearer '+SUPA_KEY, Prefer:'return=minimal' },
      body: JSON.stringify({
        p_wallet          : walletAddress.toLowerCase(),
        p_user_cash       : state.userCash,
        p_user_wins       : state.userWins || 0,
        p_user_points     : lifetimePts.user,
        p_user_positions  : state.userPositions || {},
        p_daily_date      : state.dailyDate || today,
        p_battle_active   : state.battleActive || false,
        p_selected_coin   : state.selectedCoin || 'BTC',
        p_user_trade_size : state.userTradeSize || 500,
        p_user_losses     : state.userLosses || 0,
        p_best_value      : state._bestValue || 1000,
        p_size_key        : state._sizeKey || '500',
        p_lifetime_pts    : { ai: lifetimePts.ai, user: lifetimePts.user },
        p_user_trade_log  : (state.userTradeLog || []).slice(0,100),
      })
    });
    if(r.ok || r.status===204){ setSyncBadge(true); return true; }
    console.error('[Supabase] merge_user_state failed:', r.status, await r.text().catch(()=>''));
    setSyncBadge(false); return false;
  }catch(e){ console.error('[Supabase] Network error on save:', e); setSyncBadge(false); return false; }
}

// ── LOAD state from Supabase for this wallet ──
async function supabaseLoad(){
  if(!walletAddress) return null;
  try{
    const addr = encodeURIComponent(walletAddress.toLowerCase());
    const r = await fetch(
      `${SUPA_URL}/rest/v1/${SUPA_TABLE}?wallet_address=eq.${addr}&limit=1`,
      {
        headers:{
          'apikey'        : SUPA_KEY,
          'Authorization' : 'Bearer ' + SUPA_KEY,
          'Accept'        : 'application/json'
        }
      }
    );
    if(!r.ok){ console.error('[Supabase] Load failed:', r.status); return null; }
    const rows = await r.json();
    return (Array.isArray(rows) && rows.length) ? rows[0] : null;
  }catch(e){
    console.error('[Supabase] Network error on load:', e);
    return null;
  }
}

// ── Debounced auto-save after every trade / AI trade ──
let _supaSaveDebounce = null;
function autoCloudSync(){
  if(!walletAddress) return;
  if(_supaSaveDebounce) clearTimeout(_supaSaveDebounce);
  _supaSaveDebounce = setTimeout(()=>{ supabaseSave().catch(()=>{}); }, 3000);
}

// ── Sync badge helper ──
function setSyncBadge(ok){
  const b = document.getElementById('supabase-sync-badge');
  if(!b) return;
  b.style.display = 'inline-block';
  b.textContent   = ok ? '☁️ SYNCED' : '⚠️ SYNC ERR';
  b.style.color      = ok ? 'var(--green)' : 'var(--red)';
  b.style.borderColor= ok ? 'var(--green)' : 'var(--red)';
  b.style.background = ok ? 'var(--green-dim)' : 'var(--red-dim)';
}

// ── On wallet connect: load from Supabase (source of truth) ──
async function onWalletConnectCloudSync(address){
  showToast('☁️ Loading your state from cloud...','var(--cyan)');
  const row = await supabaseLoad();
  if(!row){
    // First time this wallet — save initial state
    showToast('☁️ New wallet — initialising cloud state','var(--green)');
    await supabaseSave();
    return;
  }
  const cloudTs  = row.updated_at ? new Date(row.updated_at).getTime() : 0;
  const localTs  = state.ts || 0;
  if(cloudTs > localTs + 5000){
    applySupaRow(row);
    showToast('✅ Cloud state restored! '+new Date(cloudTs).toLocaleTimeString(),'var(--green)');
  } else {
    showToast('✅ Already up to date — pushing local to cloud','var(--cyan)');
    await supabaseSave();
  }
}

// ── Hook saveState so every save auto-pushes to Supabase ──
const _origSaveStateCloud = saveState;
window.saveState = function(){
  _origSaveStateCloud();
  autoCloudSync();
};

// ── Manual force-sync (called from wallet modal) ──
async function syncFromCloud(){
  if(!walletAddress){ showToast('🔗 Wallet connect karo pehle','var(--amber)'); return; }
  closeWalletModal();
  showToast('☁️ Syncing from cloud...','var(--cyan)');
  const row = await supabaseLoad();
  if(!row){ showToast('☁️ No cloud data yet','var(--amber)'); return; }
  if(applySupaRow(row)){
    showToast('✅ Synced from cloud! '+new Date(row.updated_at).toLocaleTimeString(),'var(--green)');
  } else {
    showToast('❌ Sync failed','var(--red)');
  }
}



function updateWalletBadge(){
  // ── Daily pts badge (resets 5 AM IST) ──
  const dailyEl = document.getElementById('wl-pts-val');
  const dailyPtsVal = dailyPts.user || 0;
  if(dailyEl) dailyEl.textContent = dailyPtsVal;

  // ── Lifetime badge (never resets) ──
  const lifetimeEl  = document.getElementById('wl-lifetime-val');
  const lifetimeBadgeEl = document.getElementById('wl-lifetime-badge');
  const lifetimeVal = lifetimePts.user || 0;
  if(lifetimeEl) lifetimeEl.textContent = lifetimeVal.toLocaleString();

  // Badge color by rank tier
  const tier =
    lifetimeVal >= 10000 ? {color:'#ff4444', label:'💎 LEGEND'}  :
    lifetimeVal >= 5000  ? {color:'#ffd700', label:'🥇 GOLD'}    :
    lifetimeVal >= 2000  ? {color:'#c0c0c0', label:'🥈 SILVER'}  :
    lifetimeVal >= 500   ? {color:'#cd7f32', label:'🥉 BRONZE'}  :
                           {color:'var(--cyan)', label:'🏆'};

  if(lifetimeBadgeEl){
    lifetimeBadgeEl.style.color  = tier.color;
    lifetimeBadgeEl.style.borderColor = tier.color+'66';
    lifetimeBadgeEl.style.background  = tier.color+'18';
    // Show tier label on badge
    const tierLabel = lifetimeBadgeEl.querySelector('span:first-of-type');
    if(tierLabel) tierLabel.textContent = tier.label + ' ';
  }

  if(walletAddress){
    document.getElementById('wl-pts-badge').style.display = 'inline-flex';
    if(lifetimeBadgeEl) lifetimeBadgeEl.style.display = 'inline-flex';
  }
}

async function loadWalletData(address){
  if(!address) return;
  // Supabase is the single source of truth — no RPC, no gas, no chain call
  // onWalletConnectCloudSync handles the full load; this is a lightweight refresh
  try{
    const key = 'aiBattle_pts_' + address.toLowerCase();
    const raw = localStorage.getItem(key);
    if(raw){
      const p = JSON.parse(raw);
      if(p.user > lifetimePts.user){ lifetimePts.user = p.user; }
      if(p.ai > lifetimePts.ai){ lifetimePts.ai = p.ai; }
    }
  }catch(e){}
  updateWalletBadge();
  updateUI();
}

// saveScoreToChain removed — Supabase handles all saves automatically.
// Kept as a no-op stub in case any old reference exists.
async function saveScoreToChain(){
  if(!walletAddress){showToast('❌ Connect wallet first!','var(--red)');return;}
  showToast('☁️ Saving to Supabase...','var(--cyan)');
  const ok = await supabaseSave();
  if(ok) showToast('✅ Saved to cloud!','var(--green)');
  else showToast('❌ Save failed — check connection','var(--red)');
}

function disconnectWallet(){
  walletAddress=null;walletSaveTs=null;
  // Reset in-memory pts — will reload from chain on next connect
  lifetimePts = {ai:0, user:0};
  const btn=document.getElementById('wl-connect-btn');
  if(btn){btn.textContent='🔗 CONNECT WALLET';btn.classList.remove('connected');btn.onclick=showConnectOptions;}
  document.getElementById('wl-addr-display').textContent='Not Connected';
  document.getElementById('wl-pts-badge').style.display='none';
  const lb=document.getElementById('wl-lifetime-badge');
  if(lb) lb.style.display='none';
  closeWalletModal();showToast('🔌 Disconnected','var(--text2)');
}

function openWalletModal(){
  if(!walletAddress){showConnectOptions();return;}
  const pts=lifetimePts.user||0,wins=state.userWins||0,trades=state.userTradeLog?.length||0;
  const wr=trades>0?Math.round((wins/trades)*100):0;
  document.getElementById('wm-addr').textContent=shortAddr(walletAddress);
  document.getElementById('wm-pts').textContent=pts;
  document.getElementById('wm-wins').textContent=wins;
  document.getElementById('wm-best').textContent='$'+fmtUSD(state._bestValue||1000);
  document.getElementById('wm-trades').textContent=trades;
  document.getElementById('wm-wr').textContent=wr+'%';
  document.getElementById('wm-saved').textContent=walletSaveTs?'✅ Chain: '+new Date(walletSaveTs).toLocaleString():'Not saved yet';
  document.getElementById('wallet-modal').classList.add('open');
}
function closeWalletModal(){ document.getElementById('wallet-modal').classList.remove('open'); }
document.getElementById('wallet-modal').addEventListener('click',e=>{if(e.target===document.getElementById('wallet-modal'))closeWalletModal();});
document.getElementById('connect-options-modal').addEventListener('click',e=>{if(e.target===document.getElementById('connect-options-modal'))closeConnectOptions();});

function shortAddr(addr){ return addr.slice(0,6)+'...'+addr.slice(-4); }

// Init on load — silently reconnect if MetaMask already authorized
async function initWallet(){
  if(!hasMetaMask()) return;
  const btn = document.getElementById('wl-connect-btn');
  if(btn) btn.textContent = '⏳ Checking...';
  try{
    // Add timeout so button never stays "Checking..." forever (5s max)
    const accountsPromise = (getMetaMaskProvider()||window.ethereum).request({method:'eth_accounts'});
    const timeoutPromise  = new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),5000));
    const accounts = await Promise.race([accountsPromise, timeoutPromise]);
    if(accounts && accounts.length){
      walletAddress = accounts[0];
      onWalletConnected(accounts[0], true); // silent=true, no toast
      // Immediately load score from blockchain
      loadWalletData(accounts[0]);
    } else {
      // No account connected — reset button
      if(btn){ btn.textContent='🔗 CONNECT WALLET'; btn.onclick=showConnectOptions; }
    }
  }catch(e){
    console.warn('initWallet error:', e.message);
    // Always reset button on any error (timeout, rejection, etc.)
    if(btn){ btn.textContent='🔗 CONNECT WALLET'; btn.onclick=showConnectOptions; }
  }
}
setTimeout(initWallet,800);


// ════════════════════════════════════════════════════════════════
// TIER UNLOCK SYSTEM — Sepolia gas-based feature unlocks
// ════════════════════════════════════════════════════════════════

function saveTiers(){
  localStorage.setItem('aiBattle_unlockedTiers', JSON.stringify(state.unlockedTiers||[]));
}

function isTierUnlocked(id){
  return (state.unlockedTiers||[]).includes(id);
}

function showTierModal(){
  const existing = document.getElementById('tier-modal-overlay');
  if(existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'tier-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:10010;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease';

  const tiers = (typeof TIER_DEFS !== 'undefined') ? TIER_DEFS : [];
  const tilesHtml = tiers.map(t => {
    const unlocked = isTierUnlocked(t.id);
    const walletOk = !!walletAddress;
    const borderCol = unlocked ? t.color : '#444';
    const bgCol     = unlocked ? t.color+'18' : '#1a1a1a';
    const badge     = unlocked
      ? `<span style="font-size:9px;padding:2px 6px;border-radius:3px;background:var(--green)22;color:var(--green);border:1px solid var(--green)44">✅ UNLOCKED</span>`
      : `<span style="font-size:9px;padding:2px 6px;border-radius:3px;background:#ff444422;color:#ff6666;border:1px solid #ff444444">🔒 LOCKED</span>`;
    const lockHint = unlocked ? '' : walletOk
      ? `<div style="font-size:9px;color:var(--amber);margin-top:5px">⚡ Click to unlock — Sepolia gas tx (testnet only, no real ETH)</div>`
      : `<div style="font-size:9px;color:#ff6666;margin-top:5px">🔗 Connect wallet first to unlock</div>`;
    return `<div style="background:${bgCol};border:1px solid ${borderCol};border-radius:8px;padding:10px 12px;margin-bottom:8px;cursor:${unlocked||!walletOk?'default':'pointer'}" ${!unlocked&&walletOk?'onclick="unlockTier('+t.id+')"':''}>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:12px;font-weight:700;color:${unlocked?t.color:'#ccc'}">${t.icon} TIER ${t.id} — ${t.name}</span>
        ${badge}
      </div>
      <div style="font-size:10px;color:${unlocked?'#ccc':'#777'};line-height:1.4">${t.desc}</div>
      ${lockHint}
    </div>`;
  }).join('');

  overlay.innerHTML = `
    <div style="background:var(--surface);border:1px solid #333;border-radius:12px;padding:20px;width:90%;max-width:480px;max-height:88vh;overflow-y:auto;position:relative">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
        <span style="font-size:18px">⚡</span>
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--cyan)">UNLOCK AI FEATURES</div>
          <div style="font-size:10px;color:var(--text2)">Each unlock sends a small Sepolia testnet transaction — gas only, no real ETH value transferred.</div>
        </div>
      </div>
      ${tilesHtml}
      <button onclick="document.getElementById('tier-modal-overlay').remove()"
        style="width:100%;margin-top:8px;padding:8px;background:transparent;border:1px solid #444;border-radius:6px;color:var(--text2);cursor:pointer;font-size:12px">
        ✕ Close
      </button>
    </div>`;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
}

// Poll for tx receipt and verify it actually mined successfully (status===0x1)
async function _waitForTxSuccess(provider, txHash, maxWaitMs=60000){
  const start = Date.now();
  while(Date.now()-start < maxWaitMs){
    try{
      const receipt = await provider.request({ method:'eth_getTransactionReceipt', params:[txHash] });
      if(receipt){
        return receipt.status==='0x1'; // true=success, false=reverted/failed
      }
    }catch(e){ /* keep polling */ }
    await new Promise(r=>setTimeout(r,2500));
  }
  return null; // timed out — unknown status
}

async function unlockTier(tierId){
  if(!walletAddress){
    showToast('🔗 Pehle wallet connect karo (CONNECT WALLET button)','warning');
    return;
  }
  if(isTierUnlocked(tierId)){
    showToast('Already unlocked!','info');
    return;
  }
  const tierDef = (typeof TIER_DEFS!=='undefined') ? TIER_DEFS.find(t=>t.id===tierId) : null;
  const tierName = tierDef ? tierDef.name : `Tier ${tierId}`;
  const provider = getMetaMaskProvider() || window.ethereum;
  if(!provider){
    showToast('MetaMask not found! Install it first.','error');
    return;
  }
  showToast(`⛽ Sending Sepolia gas tx to unlock ${tierName}...`, 'info');
  try {
    // ABI-encode a real call to unlockTier(uint256 tierId):
    //   selector 0x0924a868 = first 4 bytes of keccak256("unlockTier(uint256)")
    //   + tierId left-padded to a 32-byte word (standard Solidity calldata layout)
    // Previous version sent raw junk bytes ('0x'+tierId) that matched no real
    // function on the contract and always reverted — this is the actual fix.
    const encodedTierId = tierId.toString(16).padStart(64,'0');
    const txHash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{
        from   : walletAddress,
        to     : (typeof CONTRACT_ADDRESS!=='undefined') ? CONTRACT_ADDRESS : '0x4d76311E921FF2528044F4ff17C38dcd981EBd77',
        value  : '0x0',
        data   : '0x0924a868' + encodedTierId,
        chainId: '0xaa36a7', // Sepolia testnet
      }],
    });
    showToast(`⏳ Tx sent! Waiting for confirmation on Sepolia... (don't close)`, 'info');
    // ★ FIX: verify the tx ACTUALLY succeeded on-chain before unlocking — no more optimistic unlock
    const success = await _waitForTxSuccess(provider, txHash);
    if(success === true){
      if(!state.unlockedTiers) state.unlockedTiers = [];
      if(!state.unlockedTiers.includes(tierId)) state.unlockedTiers.push(tierId);
      saveTiers();
      showToast(`🎉 Tier ${tierId} — ${tierName} UNLOCKED! Confirmed on-chain.`, 'success');
    } else if(success === false){
      showToast(`❌ Transaction FAILED on-chain (reverted). Tier ${tierId} NOT unlocked. Check Etherscan: ${txHash.slice(0,10)}...`, 'error');
    } else {
      showToast(`⚠️ Couldn't confirm tx status (timeout). Check Etherscan manually: ${txHash.slice(0,10)}... Tier NOT unlocked yet — try again.`, 'warning');
    }
    setTimeout(showTierModal, 400);
  } catch(e){
    if(e.code===4001 || e.code===-32603){
      showToast('❌ Transaction rejected. Gas fee required on Sepolia testnet.','warning');
    } else if(e.message&&e.message.includes('network')){
      showToast('⚠️ Wrong network! Switch to Sepolia Testnet in MetaMask.','error');
    } else {
      // ★ FIX: on unknown errors, do NOT unlock — show error and let user retry
      showToast(`⚠️ TX error: ${e.message||'unknown'}. Tier NOT unlocked — please retry.`,'error');
    }
  }
}

// ── Update ai-tier-badge div with tier info ───────────────────
function updateTierBadge(){
  const el = document.getElementById('ai-tier-badge');
  if(!el) return;
  const unlocked = (state.unlockedTiers||[]).length;
  const total = (typeof TIER_DEFS!=='undefined') ? TIER_DEFS.length : 6;
  const allUnlocked = unlocked >= total;
  el.innerHTML = `<button onclick="showTierModal()" style="width:100%;padding:5px 8px;background:${allUnlocked?'var(--green)18':'var(--amber)18'};border:1px solid ${allUnlocked?'var(--green)44':'var(--amber)44'};border-radius:6px;color:${allUnlocked?'var(--green)':'var(--amber)'};font-size:10px;cursor:pointer;font-family:inherit;letter-spacing:0.05em">⚡ AI FEATURES ${unlocked}/${total} UNLOCKED</button>`;
}

// ══════════════════════════════════════════════════════════════
// PHASE 1 ADDITIONS — Auto SL/TP, Indicators Panel, Trade History
// (Everything below is NEW code. Nothing above this line was
//  removed or altered in its calculation/behavior.)
// ══════════════════════════════════════════════════════════════

// ── AUTO STOP-LOSS / TAKE-PROFIT ────────────────────────────────
// Runs independently every 500ms. Only acts on positions that have
// slPct/tpPct set (optional, user-entered at order time). Positions
// without these fields are completely unaffected — same as before.
function checkSLTP(){
  Object.entries(state.userPositions||{}).forEach(([id,p])=>{
    if(!p.slPct && !p.tpPct) return; // no auto SL/TP set — skip, unaffected
    const cur=livePrices[id];
    if(!cur||!p.qty) return;
    const margin=p.margin||p.invested||0;
    const isLong=p.side==='long';
    const grossPnl = isLong ? p.qty*(cur-p.avgCost) : p.qty*(p.entryPrice-cur);
    const exitFeeEst = margin*0.001;
    const pnl = grossPnl - exitFeeEst;
    const pnlPct = (pnl/Math.max(margin,1))*100;
    const closeAction = isLong ? 'close_long' : 'close_short';
    if(p.tpPct && pnlPct >= p.tpPct){
      notify(`🎯 AUTO TAKE-PROFIT hit for ${id}! (+${pnlPct.toFixed(2)}%)`,'profit');
      placeUserFuturesTrade(closeAction);
    } else if(p.slPct && pnlPct <= -Math.abs(p.slPct)){
      notify(`🛑 AUTO STOP-LOSS hit for ${id}! (${pnlPct.toFixed(2)}%)`,'loss');
      placeUserFuturesTrade(closeAction);
    }
  });
}
setInterval(checkSLTP, 500);

// ── BOLLINGER BANDS (new, standalone — doesn't touch calcAdvancedIndicators) ──
function calcBollinger(closes, period=20, mult=2){
  if(!closes||closes.length<period) return null;
  const slice=closes.slice(-period);
  const sma=slice.reduce((a,b)=>a+b,0)/period;
  const variance=slice.reduce((a,b)=>a+Math.pow(b-sma,2),0)/period;
  const stdDev=Math.sqrt(variance);
  const upper=sma+mult*stdDev;
  const lower=sma-mult*stdDev;
  const price=closes[closes.length-1];
  const percentB=(price-lower)/((upper-lower)||1);
  return{sma,upper,lower,percentB,price};
}

// ── INDICATORS PANEL (RSI / MACD / Bollinger) — read-only display ──
function updateIndicatorsPanel(){
  const body=document.getElementById('indicators-body');
  if(!body || body.style.display==='none') return;
  const key=`${state.selectedCoin}_${state.tf}`;
  const candles=candleData[key];
  if(!candles||candles.length<30) return;

  const ind=calcAdvancedIndicators(candles, higherTFData[state.selectedCoin]);
  const closes=candles.map(c=>c.c);
  const boll=calcBollinger(closes);

  if(ind){
    const rsiVal=ind.rsi;
    const rsiBar=document.getElementById('ind-rsi-bar');
    const rsiValEl=document.getElementById('ind-rsi-val');
    if(rsiBar){
      rsiBar.style.width=Math.min(100,Math.max(0,rsiVal))+'%';
      rsiBar.style.background=rsiVal>70?'var(--red)':rsiVal<30?'var(--green)':'var(--cyan)';
    }
    if(rsiValEl) rsiValEl.textContent=rsiVal.toFixed(1)+(rsiVal>70?' Overbought':rsiVal<30?' Oversold':'');

    const macdValEl=document.getElementById('ind-macd-val');
    if(macdValEl){
      const dir=ind.macdCross?'🟢 Bullish':'🔴 Bearish';
      macdValEl.textContent=`${dir} (Hist: ${ind.macdHist.toFixed(2)})`;
      macdValEl.style.color=ind.macdCross?'var(--green)':'var(--red)';
    }
  }
  const bollValEl=document.getElementById('ind-boll-val');
  if(bollValEl && boll){
    const pos = boll.percentB>1 ? 'Above Upper Band'
              : boll.percentB<0 ? 'Below Lower Band'
              : boll.percentB>0.8 ? 'Near Upper Band'
              : boll.percentB<0.2 ? 'Near Lower Band' : 'Middle';
    bollValEl.textContent=`${pos} (%B: ${(boll.percentB*100).toFixed(0)}%)`;
    bollValEl.style.color = boll.percentB>0.8?'var(--red)':boll.percentB<0.2?'var(--green)':'var(--text1)';
  }
}
setInterval(updateIndicatorsPanel, 1000);

function toggleIndicatorsPanel(){
  const bodyEl=document.getElementById('indicators-body');
  const icon=document.getElementById('ind-toggle-icon');
  if(!bodyEl) return;
  const isHidden=bodyEl.style.display==='none';
  bodyEl.style.display=isHidden?'flex':'none';
  if(icon) icon.textContent=isHidden?'▼':'▶';
}

// ── TRADE HISTORY DASHBOARD ──────────────────────────────────────
function showTradeHistory(){
  const body=document.getElementById('trade-history-body');
  const modal=document.getElementById('trade-history-modal');
  if(!body||!modal) return;
  const log=(state.userTradeLog||[]);
  if(!log.length){
    body.innerHTML='<div style="text-align:center;color:var(--text2);padding:24px;font-size:12px;">No trades yet.</div>';
  } else {
    body.innerHTML=`<table style="width:100%;border-collapse:collapse;">
      <thead><tr style="border-bottom:1px solid var(--border);color:var(--text2);text-align:left;">
        <th style="padding:6px 4px;">Time</th><th style="padding:6px 4px;">Coin</th>
        <th style="padding:6px 4px;">Type</th><th style="padding:6px 4px;">Price</th>
        <th style="padding:6px 4px;text-align:right;">PnL</th></tr></thead>
      <tbody>${log.map(t=>{
        const pnlColor = t.pnl>0?'var(--green)':t.pnl<0?'var(--red)':'var(--text2)';
        const pnlStr = (t.pnl!==null&&t.pnl!==undefined) ? `${t.pnl>=0?'+':''}$${t.pnl.toFixed(2)}` : '—';
        return `<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:6px 4px;">${t.time||''}</td>
          <td style="padding:6px 4px;">${t.coin||''}</td>
          <td style="padding:6px 4px;">${(t.type||'').toUpperCase()}</td>
          <td style="padding:6px 4px;">${t.price?'$'+fmtPrice(t.price):'—'}</td>
          <td style="padding:6px 4px;text-align:right;color:${pnlColor};">${pnlStr}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }
  modal.style.display='flex';
}
function closeTradeHistory(){
  const modal=document.getElementById('trade-history-modal');
  if(modal) modal.style.display='none';
}
function exportTradeHistoryCSV(){
  const log=(state.userTradeLog||[]);
  if(!log.length){ notify('No trades to export!','loss'); return; }
  const headers=['Time','Coin','Type','Price','Qty','PnL','Fee'];
  const rows=log.map(t=>[t.time||'',t.coin||'',t.type||'',t.price||'',t.qty||'',
                          (t.pnl!==undefined&&t.pnl!==null)?t.pnl:'', t.fee||'']);
  const csv=[headers.join(','),...rows.map(r=>r.join(','))].join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=`trade_history_${Date.now()}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════════════════════
// PHASE 2 — GLOBAL LEADERBOARD (real cross-player ranking)
// Uses the EXISTING `battle_states` Supabase table (read-only
// SELECT, ordered by points). No new table, no schema change,
// and does not touch supabaseSave/supabaseLoad/buildSupaSnap.
// ══════════════════════════════════════════════════════════════
async function loadGlobalLeaderboard(){
  try{
    const url = `${SUPA_URL}/rest/v1/${SUPA_TABLE}?select=wallet_address,user_points,user_cash,user_wins,positions&order=user_points.desc&limit=15`;
    const r = await fetch(url, {
      headers: {
        'apikey'        : SUPA_KEY,
        'Authorization' : 'Bearer ' + SUPA_KEY,
        'Accept'        : 'application/json'
      }
    });
    if(!r.ok){ console.error('[Leaderboard] fetch failed:', r.status); return null; }
    return await r.json();
  }catch(e){
    console.error('[Leaderboard] network error:', e);
    return null;
  }
}

async function showGlobalLeaderboard(){
  const modal=document.getElementById('global-leaderboard-modal');
  const body=document.getElementById('global-leaderboard-body');
  if(!modal||!body) return;
  modal.style.display='flex';
  body.innerHTML='<div style="text-align:center;color:var(--text2);padding:20px;font-size:12px;">Loading...</div>';

  const rows = await loadGlobalLeaderboard();
  if(!rows){
    body.innerHTML='<div style="text-align:center;color:var(--red);padding:20px;font-size:12px;">Could not load leaderboard. Check Supabase connection / RLS SELECT policy on battle_states.</div>';
    return;
  }
  if(!rows.length){
    body.innerHTML='<div style="text-align:center;color:var(--text2);padding:20px;font-size:12px;">No players yet — be the first!</div>';
    return;
  }
  body.innerHTML=`<table style="width:100%;border-collapse:collapse;">
    <thead><tr style="border-bottom:1px solid var(--border);color:var(--text2);text-align:left;font-size:10px;">
      <th style="padding:6px 4px;">#</th><th style="padding:6px 4px;">Wallet</th>
      <th style="padding:6px 4px;text-align:right;">Points</th>
      <th style="padding:6px 4px;text-align:right;">Portfolio</th>
      <th style="padding:6px 4px;text-align:right;">W/L</th></tr></thead>
    <tbody>${rows.map((row,i)=>{
      const losses = (row.positions && row.positions.userLosses) || 0;
      const isYou = walletAddress && row.wallet_address && row.wallet_address.toLowerCase()===walletAddress.toLowerCase();
      const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1);
      return `<tr style="border-bottom:1px solid var(--border);${isYou?'background:rgba(0,216,255,0.08);':''}">
        <td style="padding:6px 4px;">${medal}</td>
        <td style="padding:6px 4px;font-family:var(--font-mono);font-size:10px;">${shortAddr(row.wallet_address)}${isYou?' (You)':''}</td>
        <td style="padding:6px 4px;text-align:right;color:var(--cyan);">${(row.user_points||0).toLocaleString()}</td>
        <td style="padding:6px 4px;text-align:right;">$${fmtUSD(row.user_cash||1000)}</td>
        <td style="padding:6px 4px;text-align:right;font-size:10px;color:var(--text2);">${row.user_wins||0}W/${losses}L</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function closeGlobalLeaderboard(){
  const modal=document.getElementById('global-leaderboard-modal');
  if(modal) modal.style.display='none';
}

// ══════════════════════════════════════════════════════════════
// PHASE 2 — COPY TRADING (isolated module)
// Uses its OWN localStorage key + OWN position bucket (copyTradeCfg).
// Does NOT touch state.userPositions, state.userCash, placeUserFuturesTrade,
// checkLiquidations, saveState, or loadSavedState in any way.
// ══════════════════════════════════════════════════════════════
let copyTradeCfg = (function(){
  try{
    const saved = JSON.parse(localStorage.getItem('aiBattle_copyTrading')||'null');
    if(saved) return saved;
  }catch(e){}
  return { active:false, leaderWallet:'', allocation:100, ratioPct:50, stopLossUSD:50,
            pnlAccum:0, lastSeenTradeKey:null, positions:{} };
})();
function saveCopyTradeCfg(){ try{ localStorage.setItem('aiBattle_copyTrading', JSON.stringify(copyTradeCfg)); }catch(e){} }

async function fetchWalletRow(address){
  try{
    const addr=encodeURIComponent(address.toLowerCase());
    const r=await fetch(`${SUPA_URL}/rest/v1/${SUPA_TABLE}?wallet_address=eq.${addr}&limit=1`,{
      headers:{ apikey:SUPA_KEY, Authorization:'Bearer '+SUPA_KEY, Accept:'application/json' }
    });
    if(!r.ok) return null;
    const rows=await r.json();
    return (Array.isArray(rows)&&rows.length)?rows[0]:null;
  }catch(e){ return null; }
}

function _copyInvested(){
  return Object.values(copyTradeCfg.positions||{}).reduce((s,p)=>s+(p.margin||0),0);
}

async function pollCopyTrading(){
  if(!copyTradeCfg.active || !copyTradeCfg.leaderWallet) return;
  const row = await fetchWalletRow(copyTradeCfg.leaderWallet);
  if(!row || !row.trade_log || !row.trade_log.user || !row.trade_log.user.length) return;
  const newest = row.trade_log.user[0];
  const newestKey = `${newest.time}_${newest.coin}_${newest.type}`;
  if(copyTradeCfg.lastSeenTradeKey === newestKey) return;
  copyTradeCfg.lastSeenTradeKey = newestKey;
  saveCopyTradeCfg();

  const price = livePrices[newest.coin];
  if(!price) return;
  const ratio = (copyTradeCfg.ratioPct||50)/100;

  if(newest.type==='buy_long' || newest.type==='sell_short'){
    const side = newest.type==='buy_long' ? 'long' : 'short';
    const budget = copyTradeCfg.allocation - _copyInvested();
    const copyAmount = Math.min((newest.amount||0)*ratio, budget);
    if(copyAmount < 5) return;
    executeCopyTrade(side, newest.coin, copyAmount, newest.leverage||1, price);
  } else if(newest.type==='close_long' || newest.type==='close_short'){
    const side = newest.type==='close_long' ? 'long' : 'short';
    closeCopyTrade(newest.coin, side, price);
  }
}
setInterval(pollCopyTrading, 8000);

function executeCopyTrade(side, coin, amount, lev, price){
  const entryFee = amount*0.001;
  const margin = amount - entryFee;
  const notional = margin*lev;
  const qty = notional/price;
  copyTradeCfg.positions[coin] = { side, qty, entryPrice:price, margin, leverage:lev };
  saveCopyTradeCfg();
  notify(`📋 Copy-trade opened: ${side.toUpperCase()} ${coin} ($${amount.toFixed(2)})`, side==='long'?'profit':'short');
  renderCopyTradingPanel();
}

function closeCopyTrade(coin, side, price){
  const p = copyTradeCfg.positions[coin];
  if(!p || p.side!==side) return;
  const exitFee = p.margin*0.001;
  const grossPnl = side==='long' ? p.qty*(price-p.entryPrice) : p.qty*(p.entryPrice-price);
  const pnl = grossPnl - exitFee;
  copyTradeCfg.pnlAccum += pnl;
  delete copyTradeCfg.positions[coin];
  saveCopyTradeCfg();
  notify(`📋 Copy-trade closed: ${coin} ${pnl>=0?'+':''}$${pnl.toFixed(2)}`, pnl>=0?'profit':'loss');
  if(copyTradeCfg.stopLossUSD && copyTradeCfg.pnlAccum <= -Math.abs(copyTradeCfg.stopLossUSD)){
    copyTradeCfg.active=false;
    saveCopyTradeCfg();
    notify(`🛑 Copy Trading auto-stopped — loss limit reached ($${copyTradeCfg.pnlAccum.toFixed(2)})`,'loss');
  }
  renderCopyTradingPanel();
}

function openCopyTradingModal(){
  const modal=document.getElementById('copy-trading-modal');
  if(!modal) return;
  document.getElementById('ct-leader-input').value = copyTradeCfg.leaderWallet||'';
  document.getElementById('ct-allocation-input').value = copyTradeCfg.allocation||100;
  document.getElementById('ct-ratio-input').value = copyTradeCfg.ratioPct||50;
  document.getElementById('ct-stoploss-input').value = copyTradeCfg.stopLossUSD||50;
  renderCopyTradingPanel();
  modal.style.display='flex';
}
function closeCopyTradingModal(){
  const modal=document.getElementById('copy-trading-modal');
  if(modal) modal.style.display='none';
}
function startCopyTrading(){
  const leader=(document.getElementById('ct-leader-input').value||'').trim();
  if(!leader || leader.length<6){ notify('Enter a valid leader wallet address!','loss'); return; }
  copyTradeCfg.leaderWallet = leader;
  copyTradeCfg.allocation = parseFloat(document.getElementById('ct-allocation-input').value)||100;
  copyTradeCfg.ratioPct = parseFloat(document.getElementById('ct-ratio-input').value)||50;
  copyTradeCfg.stopLossUSD = parseFloat(document.getElementById('ct-stoploss-input').value)||50;
  copyTradeCfg.active = true;
  copyTradeCfg.pnlAccum = 0;
  saveCopyTradeCfg();
  notify(`📋 Copy Trading STARTED — following ${shortAddr(leader)}`,'profit');
  renderCopyTradingPanel();
}
function stopCopyTrading(){
  copyTradeCfg.active=false;
  saveCopyTradeCfg();
  notify('📋 Copy Trading stopped','loss');
  renderCopyTradingPanel();
}
function renderCopyTradingPanel(){
  const statusEl=document.getElementById('ct-status');
  const posEl=document.getElementById('ct-positions');
  if(statusEl){
    statusEl.innerHTML = copyTradeCfg.active
      ? `<span style="color:var(--green)">● ACTIVE</span> — Following ${shortAddr(copyTradeCfg.leaderWallet)} | P&L: <span style="color:${copyTradeCfg.pnlAccum>=0?'var(--green)':'var(--red)'}">${copyTradeCfg.pnlAccum>=0?'+':''}$${copyTradeCfg.pnlAccum.toFixed(2)}</span>`
      : `<span style="color:var(--text2)">● INACTIVE</span>`;
  }
  if(posEl){
    const entries=Object.entries(copyTradeCfg.positions||{});
    posEl.innerHTML = entries.length
      ? entries.map(([coin,p])=>`<div style="display:flex;justify-content:space-between;font-size:10px;padding:4px 0;border-bottom:1px solid var(--border);">
          <span>${p.side==='long'?'📈':'📉'} ${coin} @$${fmtPrice(p.entryPrice)}</span>
          <span>$${fmtUSD(p.margin)} (${p.leverage}x)</span>
        </div>`).join('')
      : '<div style="color:var(--text2);font-size:10px;text-align:center;padding:8px;">No active copy positions</div>';
  }
}

// ══════════════════════════════════════════════════════════════
// PHASE 2 — PVP BATTLES (1v1, isolated module)
// Requires a NEW Supabase table `battle_rooms` (SQL provided separately).
// Uses its OWN cash/position bucket (pvpState) — never touches
// state.userCash / state.userPositions / the AI-battle logic.
// ══════════════════════════════════════════════════════════════
let pvpState = {
  inRoom:false, roomCode:null, isPlayer1:false, status:'lobby',
  cash:1000, positions:{}, startingCash:1000, durationSec:300, startedAtMs:null,
  selectedCoin:'BTC', tradeSize:100, opponentValue:null, pollTimer:null
};

function generateRoomCode(){ return Math.floor(100000+Math.random()*900000).toString(); }

function showPvpView(view){
  ['pvp-lobby','pvp-waiting','pvp-active','pvp-result'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.style.display = (id===view) ? 'block' : 'none';
  });
}

function openPvpModal(){
  const modal=document.getElementById('pvp-modal');
  if(!modal) return;
  modal.style.display='flex';
  if(pvpState.inRoom){
    if(pvpState.status==='waiting') showPvpView('pvp-waiting');
    else if(pvpState.status==='active'){ showPvpView('pvp-active'); renderPvpCoinTabs(); renderPvpPositions(); }
    else showPvpView('pvp-lobby');
  } else showPvpView('pvp-lobby');
}
function closePvpModal(){ const modal=document.getElementById('pvp-modal'); if(modal) modal.style.display='none'; }
function resetPvpToLobby(){
  if(pvpState.pollTimer) clearInterval(pvpState.pollTimer);
  pvpState = { inRoom:false, roomCode:null, isPlayer1:false, status:'lobby', cash:1000, positions:{},
    startingCash:1000, durationSec:300, startedAtMs:null, selectedCoin:'BTC', tradeSize:100,
    opponentValue:null, pollTimer:null };
  showPvpView('pvp-lobby');
}

async function createPvpRoom(){
  if(!walletAddress){ notify('Connect your wallet first to play PvP!','loss'); return; }
  const startingCash=parseFloat(document.getElementById('pvp-cash-select').value)||1000;
  const durationSec=parseInt(document.getElementById('pvp-duration-select').value)||300;
  const roomCode=generateRoomCode();
  try{
    const r=await fetch(`${SUPA_URL}/rest/v1/battle_rooms`,{
      method:'POST',
      headers:{ 'Content-Type':'application/json', apikey:SUPA_KEY, Authorization:'Bearer '+SUPA_KEY, 'Prefer':'return=minimal' },
      body: JSON.stringify({
        room_code: roomCode, player1_wallet: walletAddress.toLowerCase(),
        status:'waiting', starting_cash: startingCash, duration_sec: durationSec,
        player1_state: { cash:startingCash, positions:{}, value:startingCash }
      })
    });
    if(!r.ok){ notify('Could not create room — battle_rooms table may not be set up yet.','loss'); return; }
    pvpState.inRoom=true; pvpState.roomCode=roomCode; pvpState.isPlayer1=true; pvpState.status='waiting';
    pvpState.cash=startingCash; pvpState.startingCash=startingCash; pvpState.durationSec=durationSec; pvpState.positions={};
    document.getElementById('pvp-room-code-display').textContent=roomCode;
    showPvpView('pvp-waiting');
    startPvpPolling();
  }catch(e){ notify('Network error creating room.','loss'); }
}

async function joinPvpRoom(){
  if(!walletAddress){ notify('Connect your wallet first to play PvP!','loss'); return; }
  const code=(document.getElementById('pvp-join-input').value||'').trim();
  if(!code||code.length<4){ notify('Enter a valid room code!','loss'); return; }
  try{
    const r=await fetch(`${SUPA_URL}/rest/v1/battle_rooms?room_code=eq.${encodeURIComponent(code)}&limit=1`,{
      headers:{ apikey:SUPA_KEY, Authorization:'Bearer '+SUPA_KEY, Accept:'application/json' }
    });
    const rows=await r.json();
    if(!rows||!rows.length){ notify('Room not found!','loss'); return; }
    const room=rows[0];
    if(room.status!=='waiting'||room.player2_wallet){ notify('Room already full or in progress!','loss'); return; }
    const startedAt=new Date().toISOString();
    const r2=await fetch(`${SUPA_URL}/rest/v1/battle_rooms?room_code=eq.${encodeURIComponent(code)}`,{
      method:'PATCH',
      headers:{ 'Content-Type':'application/json', apikey:SUPA_KEY, Authorization:'Bearer '+SUPA_KEY, 'Prefer':'return=minimal' },
      body: JSON.stringify({ player2_wallet: walletAddress.toLowerCase(), status:'active', started_at:startedAt,
        player2_state:{ cash:room.starting_cash, positions:{}, value:room.starting_cash } })
    });
    if(!r2.ok){ notify('Could not join room.','loss'); return; }
    pvpState.inRoom=true; pvpState.roomCode=code; pvpState.isPlayer1=false; pvpState.status='active';
    pvpState.cash=room.starting_cash; pvpState.startingCash=room.starting_cash; pvpState.durationSec=room.duration_sec;
    pvpState.startedAtMs=new Date(startedAt).getTime(); pvpState.positions={};
    showPvpView('pvp-active'); renderPvpCoinTabs(); renderPvpPositions();
    startPvpPolling();
  }catch(e){ notify('Network error joining room.','loss'); }
}

function startPvpPolling(){
  if(pvpState.pollTimer) clearInterval(pvpState.pollTimer);
  pvpState.pollTimer=setInterval(pollPvpRoom, 3000);
}

async function pollPvpRoom(){
  if(!pvpState.inRoom||!pvpState.roomCode) return;
  try{
    const r=await fetch(`${SUPA_URL}/rest/v1/battle_rooms?room_code=eq.${encodeURIComponent(pvpState.roomCode)}&limit=1`,{
      headers:{ apikey:SUPA_KEY, Authorization:'Bearer '+SUPA_KEY, Accept:'application/json' }
    });
    const rows=await r.json();
    if(!rows||!rows.length) return;
    const room=rows[0];

    if(pvpState.status==='waiting' && room.status==='active' && room.player2_wallet){
      pvpState.status='active';
      pvpState.startedAtMs=new Date(room.started_at).getTime();
      showPvpView('pvp-active'); renderPvpCoinTabs(); renderPvpPositions();
    }

    if(pvpState.status==='active'){
      const oppKey = pvpState.isPlayer1 ? 'player2_state' : 'player1_state';
      const oppStateVal = room[oppKey];
      if(oppStateVal){
        pvpState.opponentValue = oppStateVal.value;
        const oppEl=document.getElementById('pvp-opp-value');
        if(oppEl) oppEl.textContent='$'+fmtUSD(pvpState.opponentValue);
      }
      const myVal = pvpPortfolioValue();
      const myKey = pvpState.isPlayer1 ? 'player1_state' : 'player2_state';
      fetch(`${SUPA_URL}/rest/v1/battle_rooms?room_code=eq.${encodeURIComponent(pvpState.roomCode)}`,{
        method:'PATCH',
        headers:{ 'Content-Type':'application/json', apikey:SUPA_KEY, Authorization:'Bearer '+SUPA_KEY, 'Prefer':'return=minimal' },
        body: JSON.stringify({ [myKey]: { cash: pvpState.cash, positions: pvpState.positions, value: myVal } })
      }).catch(()=>{});

      const elapsed=(Date.now()-pvpState.startedAtMs)/1000;
      const remaining=Math.max(0, pvpState.durationSec-elapsed);
      const mm=Math.floor(remaining/60), ss=Math.floor(remaining%60);
      const timerEl=document.getElementById('pvp-timer');
      if(timerEl) timerEl.textContent=`${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;

      if(remaining<=0 && room.status==='active'){
        await finishPvpRoom(room, myVal);
      }
    }

    if(room.status==='finished' && pvpState.status!=='finished'){
      pvpState.status='finished';
      declarePvpResult(room);
    }
  }catch(e){ console.error('[PvP] poll error', e); }
}

async function finishPvpRoom(room, myVal){
  const oppKey = pvpState.isPlayer1 ? 'player2_state' : 'player1_state';
  const oppVal = (room[oppKey] && room[oppKey].value) || pvpState.startingCash;
  const myWallet = walletAddress.toLowerCase();
  const oppWallet = pvpState.isPlayer1 ? room.player2_wallet : room.player1_wallet;
  const winner = myVal>=oppVal ? myWallet : oppWallet;
  try{
    await fetch(`${SUPA_URL}/rest/v1/battle_rooms?room_code=eq.${encodeURIComponent(pvpState.roomCode)}&status=eq.active`,{
      method:'PATCH',
      headers:{ 'Content-Type':'application/json', apikey:SUPA_KEY, Authorization:'Bearer '+SUPA_KEY, 'Prefer':'return=minimal' },
      body: JSON.stringify({ status:'finished', winner_wallet: winner })
    });
  }catch(e){}
  pvpState.status='finished';
  declarePvpResult(Object.assign({}, room, { winner_wallet: winner }));
}

function declarePvpResult(room){
  if(pvpState.pollTimer) clearInterval(pvpState.pollTimer);
  showPvpView('pvp-result');
  const myWallet=(walletAddress||'').toLowerCase();
  const won = room.winner_wallet && room.winner_wallet.toLowerCase()===myWallet;
  if(won){
    try{
      const w = parseInt(localStorage.getItem('aiBattle_pvpWins')||'0',10)+1;
      localStorage.setItem('aiBattle_pvpWins', String(w));
    }catch(e){}
  }
  const textEl=document.getElementById('pvp-result-text');
  const detailEl=document.getElementById('pvp-result-detail');
  if(textEl){ textEl.textContent = won?'🏆 YOU WON!':'💔 YOU LOST'; textEl.style.color = won?'var(--green)':'var(--red)'; }
  if(detailEl){ detailEl.textContent = `Final: You $${fmtUSD(pvpPortfolioValue())} vs Opponent $${fmtUSD(pvpState.opponentValue||pvpState.startingCash)}`; }
}

function leavePvpRoom(){
  if(pvpState.pollTimer) clearInterval(pvpState.pollTimer);
  resetPvpToLobby();
  notify('Left PvP battle.','loss');
}

function pvpPortfolioValue(){
  let val=pvpState.cash;
  Object.entries(pvpState.positions||{}).forEach(([coin,p])=>{
    const cur=livePrices[coin]||p.entryPrice;
    const unrealizedPnl = p.side==='long' ? p.qty*(cur-p.entryPrice) : p.qty*(p.entryPrice-cur);
    val += p.margin + unrealizedPnl;
  });
  return val;
}

function renderPvpCoinTabs(){
  const el=document.getElementById('pvp-coin-tabs');
  if(!el) return;
  el.innerHTML = COINS.map(c=>{
    const active = c.id===pvpState.selectedCoin ? ' active' : '';
    return `<div class="coin-tab${active}" onclick="selectPvpCoin('${c.id}')"><span style="color:${c.color}">${c.icon}</span> ${c.id}</div>`;
  }).join('');
  const priceLabel=document.getElementById('pvp-price-label');
  const coinLabel=document.getElementById('pvp-coin-label');
  if(coinLabel) coinLabel.textContent=pvpState.selectedCoin;
  if(priceLabel) priceLabel.textContent=fmtPrice(livePrices[pvpState.selectedCoin]);
}
function selectPvpCoin(id){ pvpState.selectedCoin=id; renderPvpCoinTabs(); }
function setPvpSize(amt){
  pvpState.tradeSize=amt;
  const el=document.getElementById('pvp-size-display');
  if(el) el.textContent='$'+amt;
}
function pvpTrade(side){
  const coin=pvpState.selectedCoin;
  const price=livePrices[coin];
  if(!price){ notify('Price not available','loss'); return; }
  const amount=Math.min(pvpState.tradeSize||100, pvpState.cash);
  if(amount<5){ notify('Not enough PvP cash!','loss'); return; }
  const existing=pvpState.positions[coin];
  if(existing && existing.side!==side){ notify('Close your existing position first!','loss'); return; }
  const entryFee=amount*0.001;
  const margin=amount-entryFee;
  const lev=1;
  const notional=margin*lev;
  const qty=notional/price;
  pvpState.cash-=amount;
  if(!existing){
    pvpState.positions[coin]={ side, qty, entryPrice:price, margin, leverage:lev };
  } else {
    const totalQty=existing.qty+qty;
    existing.entryPrice=(existing.entryPrice*existing.qty+price*qty)/totalQty;
    existing.qty=totalQty; existing.margin+=margin;
  }
  notify(`⚔️ PvP ${side.toUpperCase()} ${coin} @$${fmtPrice(price)}`, side==='long'?'profit':'short');
  renderPvpPositions();
}
function pvpClosePosition(coin){
  const p=pvpState.positions[coin];
  if(!p) return;
  const price=livePrices[coin];
  if(!price) return;
  const exitFee=p.margin*0.001;
  const grossPnl = p.side==='long' ? p.qty*(price-p.entryPrice) : p.qty*(p.entryPrice-price);
  const pnl=grossPnl-exitFee;
  pvpState.cash += p.margin+pnl;
  delete pvpState.positions[coin];
  notify(`⚔️ PvP closed ${coin}: ${pnl>=0?'+':''}$${pnl.toFixed(2)}`, pnl>=0?'profit':'loss');
  renderPvpPositions();
}
function renderPvpPositions(){
  const myValEl=document.getElementById('pvp-my-value');
  if(myValEl) myValEl.textContent='$'+fmtUSD(pvpPortfolioValue());
  const el=document.getElementById('pvp-positions');
  if(!el) return;
  const entries=Object.entries(pvpState.positions||{});
  el.innerHTML = entries.length ? entries.map(([coin,p])=>{
    const cur=livePrices[coin]||p.entryPrice;
    const pnl = p.side==='long' ? p.qty*(cur-p.entryPrice) : p.qty*(p.entryPrice-cur);
    return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;padding:4px 0;border-bottom:1px solid var(--border);">
      <span>${p.side==='long'?'📈':'📉'} ${coin} @$${fmtPrice(p.entryPrice)}</span>
      <span style="color:${pnl>=0?'var(--green)':'var(--red)'}">${pnl>=0?'+':''}$${pnl.toFixed(2)}</span>
      <button class="btn-sm" style="font-size:8px;padding:2px 4px;" onclick="pvpClosePosition('${coin}')">✕</button>
    </div>`;
  }).join('') : '<div style="color:var(--text2);font-size:10px;text-align:center;padding:8px;">No positions yet</div>';
}
setInterval(()=>{ if(pvpState.inRoom && pvpState.status==='active') renderPvpPositions(); }, 1000);
