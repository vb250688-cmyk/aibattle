// ════════════════════════════════════════════════════════════════
//  app.js — AI Battle Trader · Game Logic
//  Constants & config → js/config.js
//  Styles → css/style.css
// ════════════════════════════════════════════════════════════════

  dailyDate:new Date().toISOString().split('T')[0], battleActive:true
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
}

// ── POINTS FORMULA: % based, hard capped 500 pts per trade ──
// pts = (pnl / tradeSize) * 500 → 1% gain = 5pts, 100% gain = 500pts max
function calcPts(pnl, tradeSize){
  const pct = pnl / Math.max(tradeSize, 1);
  return Math.max(1, Math.min(500, Math.round(pct * 500)));
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
  state.dailyDate=new Date().toISOString().split('T')[0];
  COINS.forEach(c=>{delete aiCooldown[c.id];});
  _prevAiPort=1000;_prevUserPort=1000;
  _prevAiWins=0;_prevUserWins=0;
  // ── POINTS ARE NEVER RESET by battle reset ──
  // Daily pts aur lifetime pts dono protected hain.
  // 5 AM IST pe auto-reset hoga daily pts — manually nahi hoga.
  // Force DOM reset
  ['ai-wins','user-wins'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent='0';});
  document.getElementById('ai-points').textContent='$1,000.00';
  document.getElementById('user-points').textContent='$1,000.00';
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
function initWs(){
  // Spot WebSocket for non-futures coins
  const spotCoins=COINS.filter(c=>!isFutures(c.symbol));
  const futCoins=COINS.filter(c=>isFutures(c.symbol));
  const streams=spotCoins.map(c=>c.symbol.toLowerCase()+'@ticker').join('/');
  ws=new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
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
  ws.onclose=()=>setTimeout(initWs,2000);

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
    wsFutures.onclose=()=>setTimeout(initWs,3000);
  }
}
initWs();

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
  if(bull>=9)trend_signal='STRONG_BUY';
  else if(bull>=6)trend_signal='BUY';
  else if(bear>=9)trend_signal='STRONG_SELL';
  else if(bear>=6)trend_signal='SELL';

  return{
    ema8,ema9,ema13,ema21,ema50,rsi,stochRSI,stochOversold,stochOverbought,
    macdLine,sigLine,macdHist,macdCross,macdExpBull,macdExpBear,
    adx,plusDI,minusDI,trendingMarket,strongTrend,adxBull,
    htfTrend,htfADX,
    atr,atrPct,bullTrend,bearTrend,weakBull,weakBear,
    bullEngulf,bearEngulf,hammer,shootStar,bullMomentum3,bearMomentum3,
    bullDiverg,bearDiverg,highVolume,veryHighVol,
    aboveVwap,belowVwap,breakout,vwap,
    roc10,momStrong,trend_signal,bull,bear,price
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
  const liveBullContext = liveUp >= Math.ceil(COINS.length*0.6); // 60%+ coins up today
  const liveBearContext = liveDn >= Math.ceil(COINS.length*0.6); // 60%+ coins down today

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
    const recent5   = log.slice(0, 5);
    const recentWins = recent5.filter(t => t.pnl > 0).length;
    const recentLoss = recent5.filter(t => t.pnl < 0).length;
    if      (recentWins >= 4)                               this.mood = 'CONFIDENT';
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
    return this.winRateShort >= 0.35;
  },

  // API: Global size penalty based on mood + global win rates
  sizePenalty(side) {
    let mult = 1.0;
    if (this.mood === 'CAUTIOUS') mult *= 0.5;
    if (this.mood === 'REVENGE')  mult *= 0.75;
    if (this.mood === 'CONFIDENT') mult *= 1.15;
    if (side === 'short' && this.winRateShort < 0.4) mult *= 0.7;
    if (side === 'long'  && this.winRateLong  < 0.4) mult *= 0.7;
    return Math.max(0.4, Math.min(1.3, mult));
  },

  // API: Entry threshold boost from mood
  entryBoost() {
    if (this.mood === 'CAUTIOUS')  return +2;
    if (this.mood === 'CONFIDENT') return -1;
    if (this.mood === 'REVENGE')   return -1; // only for allowed direction — hardBlock still applies
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
setInterval(() => aiMemory.learnFromHistory(), 30000);

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

  const winStreak=(state.aiWins||0)-(state.aiLosses||0);
  const streakBoost=Math.min(1.25, Math.max(0.85, 1+(winStreak*0.04)));

  const entryThreshBase=mkt.isChop?14:10;
  // REVENGE mood mein entryBoost -1 return karta hai — lekin short block pe NO effect
  const entryThresh=Math.max(5, Math.round(entryThreshBase/aggMult) + aiMemory.entryBoost());

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

    // ══════════════════════════════════════════════════════════
    // ★ FEE-AWARE TP/SL — round-trip fee = 0.2%
    // Minimum TP must beat fees with margin
    // RR ratio enforced: TP >= 2× SL always
    // ══════════════════════════════════════════════════════════
    const FEE_RT=0.20;  // 0.2% round-trip fee (0.1% × 2)
    const MIN_TP=0.55;  // minimum gross TP = 0.55% → net 0.35% after fees
    const MIN_SL=0.30;  // minimum SL = 0.30% (tight enough)
    const atrTP=Math.max(MIN_TP, ind.atrPct*(ind.strongTrend?1.6:1.1));
    const atrSL=Math.max(MIN_SL, ind.atrPct*0.55);
    // Enforce 2:1 RR — TP must be at least 2× SL
    const tp=Math.max(atrTP, atrSL*2.0);
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
        || (hardBlockShort&&pct>-(FEE_RT*0.5))        // regime flip — exit near breakeven
        || (ind.bullEngulf&&pct>0.1)                   // strong reversal candle
        || (ind.trend_signal==='STRONG_BUY'&&pct>0)   // signal fully flipped
        || (ind.htfTrend===1&&pct>=(FEE_RT))          // HTF flipped — exit if covering fees
        || (holdSec>480&&pct<FEE_RT);                 // ★ time-stop: 8min, only if not covering fees
      if(exitShort){delete aiTrailingStop[coin.id];executeAITrade('close_short',null,coin.id);aiCooldown[coin.id]=now;continue;}
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
        || (holdSec>480&&pct<FEE_RT);                // ★ 8min time-stop — only if underwater
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
      const canShort = (mkt.regime==='BEAR' || mkt.regime==='STRONG_BEAR' || mkt.isChop)
                       && !hardBlockShort; // redundant but explicit safety net
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
        const shortScore =
          (ind.bearTrend?4:ind.weakBear?2:0)
          +(ind.bear>=8?3:ind.bear>=6?2:ind.bear>=4?1:0)
          +(ind.stochOverbought?2:0)+(ind.bearDiverg?2:0)
          +(ind.momStrong&&ind.roc10<-0.5?2:0)
          +(mkt.regime==='STRONG_BEAR'?3:mkt.regime==='BEAR'?2:0)
          + aiMemory.applyWeights(shortComponents);
        const coinBoost   = aiMemory.coinEntryBoost(coin.id);
        const shortThresh = ind.trendingMarket
          ? Math.max(entryThresh+3+coinBoost, 12)
          : Math.max(entryThresh+5+coinBoost, 16);
        const shortOk = shortScore>=shortThresh
          &&(ind.trend_signal==='STRONG_SELL'||ind.trend_signal==='SELL')
          &&ind.htfTrend!==1
          &&ind.rsi>35;  // don't short already oversold
        if(shortOk){
          const confidence=Math.min(shortScore/18,1);
          const sizeMult=aiMemory.sizePenalty('short')*aiMemory.coinSizeMult(coin.id);
          const riskAmt=state.aiCash*(0.03+confidence*0.05)*streakBoost*sizeMult;
          const margin=Math.max(80,Math.min(Math.floor(riskAmt),state.aiCash*0.50,200));
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
      const canLong=mkt.regime==='BULL'||mkt.regime==='STRONG_BULL'||mkt.isChop;
      if(canLong){
        const longComponents = {
          adx:     (ind.trendingMarket&&ind.adxBull?3:0)+(ind.strongTrend&&ind.adxBull?2:0),
          htf:     (ind.htfTrend===1?3:0),
          rsi:     (ind.rsi<35?3:ind.rsi<42?2:ind.rsi<52?1:0),
          macd:    (ind.macdCross?2:0)+(ind.macdExpBull?1:0),
          pattern: (ind.bullEngulf?3:0)+(ind.hammer?3:0)+(ind.bullMomentum3?2:0)+(ind.bullDiverg?3:0),
          volume:  (ind.veryHighVol&&ind.bullTrend?2:ind.highVolume&&ind.bullTrend?1:0)+(ind.aboveVwap?2:0),
        };
        const longScore =
          (ind.bullTrend?4:ind.weakBull?2:0)
          +(ind.bull>=8?3:ind.bull>=6?2:ind.bull>=4?1:0)
          +(ind.stochOversold?3:0)
          +(ind.breakout&&ind.bullTrend?2:0)
          +(ind.momStrong&&ind.roc10>0.5?2:0)
          +(mkt.regime==='STRONG_BULL'?3:mkt.regime==='BULL'?2:0)
          + aiMemory.applyWeights(longComponents);

        // ★ PULLBACK FILTER: in strong bull, only enter when RSI pulled back below 55
        // This avoids chasing overbought entries
        const pullbackOk=mkt.regime==='STRONG_BULL'
          ? ind.rsi<58 || ind.stochOversold || ind.bullEngulf || ind.hammer
          : true;

        const longAdxOk=ind.trendingMarket||(longScore>=10);
        const longOk=canLong&&longScore>=entryThresh
          &&(ind.trend_signal==='STRONG_BUY'||ind.trend_signal==='BUY')
          &&longAdxOk&&ind.htfTrend!==-1&&pullbackOk
          &&ind.rsi>28&&ind.rsi<72;  // no extreme overbought entry

        if(longOk){
          const hadPatternLong = !!(ind.bullEngulf||ind.hammer);
          const confidence=Math.min(longScore/18,1);
          const coinBoostL = aiMemory.coinEntryBoost(coin.id);
          const longThresh = Math.max(entryThresh+coinBoostL, 5);
          if(longScore < longThresh){ /* coin preference says skip */ }
          else {
            const sizeMult=aiMemory.sizePenalty('long')*aiMemory.coinSizeMult(coin.id);
            const riskAmt=state.aiCash*(0.035+confidence*0.065)*streakBoost*sizeMult;
            const amount=Math.max(80,Math.min(Math.floor(riskAmt),state.aiCash*0.60,200));
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
    if(!amount)amount=Math.floor(Math.random()*200+100);
    if(amount>state.aiCash)amount=state.aiCash;
    if(amount<10)return;
    const fee=amount*0.001,qty=(amount-fee)/price;
    state.aiCash-=amount;
    if(!state.aiHoldings[coinId])state.aiHoldings[coinId]={qty:0,avgCost:0,invested:0};
    const h=state.aiHoldings[coinId];
    h.invested+=amount-fee;h.qty+=qty;h.avgCost=h.invested/h.qty;
    state.aiTradeLog.unshift({type:'buy',coin:coinId,qty,price,amount,fee,pnl:null,time,
      entryRsi:meta.entryRsi||null, hadPattern:meta.hadPattern||false, regime:meta.regime||null});

  }else if(side==='sell'){
    const h=state.aiHoldings[coinId];
    if(!h||h.qty<=0.000001)return;
    const actualQty=h.qty;
    const fee=actualQty*price*0.001;
    const proceeds=actualQty*price-fee;
    const pnl=proceeds-(h.avgCost*actualQty);
    state.aiCash+=proceeds;
    delete state.aiHoldings[coinId];
    if(pnl>0){state.aiWins++;addAiPoints(calcPts(pnl, h.invested||amount||100));}else{state.aiLosses++;}
    state.aiTradeLog.unshift({type:'sell',coin:coinId,qty:actualQty,price,proceeds,fee,pnl,time,
      entryRsi:meta.entryRsi||null, hadPattern:meta.hadPattern||false, regime:meta.regime||null});

  }else if(side==='short'){
    if(!amount||amount<10)return;
    if(amount>state.aiCash)amount=state.aiCash;
    const fee=amount*0.001;
    const qty=(amount-fee)/price;
    state.aiCash -= amount; // margin locked
    state.aiShorts[coinId] = {qty, entryPrice:price, margin:amount-fee,
      entryRsi:meta.entryRsi||null, hadPattern:meta.hadPattern||false};
    state.aiTradeLog.unshift({type:'short',coin:coinId,qty,price,amount,fee,pnl:null,time,
      entryRsi:meta.entryRsi||null, hadPattern:meta.hadPattern||false, regime:meta.regime||null});

  }else if(side==='close_short'){
    const sh=state.aiShorts[coinId];
    if(!sh)return;
    const fee=sh.qty*price*0.001;
    const pnl=(sh.entryPrice-price)*sh.qty-fee;
    state.aiCash+=sh.margin+pnl;
    delete state.aiShorts[coinId];
    if(pnl>0){state.aiWins++;addAiPoints(calcPts(pnl, sh.margin||100));}else{state.aiLosses++;}
    state.aiTradeLog.unshift({type:'short_closed',coin:coinId,qty:sh.qty,price,pnl,fee,time,
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
        if(bundle.state)Object.assign(state,bundle.state);
        if(bundle.lifetimePts){lifetimePts.ai=bundle.lifetimePts.ai||0;lifetimePts.user=bundle.lifetimePts.user||0;}
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
    const fee=pos.qty*price*0.001;
    const proceeds=pos.qty*price-fee;
    const pnl=proceeds-pos.invested;
    state.userCash+=proceeds;
    if(pnl>0){state.userWins++;const earnedPts=calcPts(pnl, pos.invested||100);addUserPoints(earnedPts);}else{state.userLosses++;}
    state.userTradeLog.unshift({type:'close_long',coin,qty:pos.qty,price,pnl,fee,time});
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
    const fee=pos.qty*price*0.001;
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
    const amount=Math.min(state.userTradeSize||100, state.userCash);
    if(amount<5){notify('Not enough cash!','loss');return;}
    if(amount>state.userCash){notify('Insufficient cash!','loss');return;}
    const fee=amount*0.001,qty=(amount-fee)/price;
    state.userCash-=amount;
    if(!pos||pos.side!=='long'){
      state.userPositions[coin]={side:'long',qty,avgCost:price,invested:amount-fee};
    }else{
      const p=state.userPositions[coin];
      p.invested+=amount-fee;p.qty+=qty;p.avgCost=p.invested/p.qty;
    }
    state.userTradeLog.unshift({type:'buy_long',coin,qty,price,amount,fee,pnl:null,time});
    notify(`📈 LONG ${qty.toFixed(4)} ${coin} @$${fmtPrice(price)}`,'profit');
  }

  // OPEN / ADD SHORT
  else if(side==='short'){
    const amount=Math.min(state.userTradeSize||100, state.userCash);
    if(amount<5){notify('Not enough cash!','loss');return;}
    if(amount>state.userCash){notify('Insufficient cash!','loss');return;}
    const fee=amount*0.001,qty=(amount-fee)/price;
    state.userCash-=amount;
    if(!pos||pos.side!=='short'){
      state.userPositions[coin]={side:'short',qty,entryPrice:price,margin:amount-fee,invested:amount-fee};
    }else{
      const p=state.userPositions[coin];
      const totalMargin=p.margin+(amount-fee);
      p.entryPrice=(p.entryPrice*p.qty+price*qty)/(p.qty+qty);
      p.qty+=qty;p.margin=totalMargin;p.invested=totalMargin;
    }
    state.userTradeLog.unshift({type:'sell_short',coin,qty,price,amount,fee,pnl:null,time});
    notify(`📉 SHORT ${qty.toFixed(4)} ${coin} @$${fmtPrice(price)}`,'short');
  }

  saveState();updateUI();
}

// ---- UI UPDATE ----
function updateTicker(){
  for(const [id,el1,el2] of [['BTC','tk-btc','tk-btc2'],['ETH','tk-eth','tk-eth2'],['SOL','tk-sol','tk-sol2'],['BNB','tk-bnb','tk-bnb2']]){
    const p=livePrices[id],c=liveChanges[id];
    if(!p)continue;
    const cls=c>=0?'up':'down',sym=c>=0?'▲':'▼';
    const str=`${id}/USDT <span class="${cls}">${sym}$${fmtPrice(p)} (${c>=0?'+':''}${(c||0).toFixed(2)}%)</span>`;
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

  // AI panel
  const aiLongVal=Object.entries(state.aiHoldings).reduce((s,[id,h])=>s+h.qty*(livePrices[id]||h.avgCost),0);
  const aiShortPnl=Object.entries(state.aiShorts||{}).reduce((s,[id,sh])=>s+(sh.entryPrice-(livePrices[id]||sh.entryPrice))*sh.qty,0);
  const aiTotal=state.aiCash+aiLongVal+aiShortPnl+(Object.values(state.aiShorts||{}).reduce((s,sh)=>s+sh.margin,0));
  const aiPnl=aiTotal-1000;
  document.getElementById('ai-cash').textContent='$'+fmtUSD(aiTotal);
  document.getElementById('ai-pnl').textContent=`P&L: ${aiPnl>=0?'+':''}$${fmtUSD(aiPnl)}`;
  document.getElementById('ai-pnl').className=`ai-pnl ${aiPnl>=0?'positive':'negative'}`;

  // AI trade log
  const aiLog=document.getElementById('ai-trade-log');
  let logItems=[];
  // Open LONG positions
  Object.entries(state.aiHoldings).forEach(([id,h])=>{
    if(h.qty>1e-8){const cur=livePrices[id]||h.avgCost;const upnl=(cur-h.avgCost)/h.avgCost*100;logItems.push(`<div class="ai-trade-item" style="border-left-color:var(--cyan)">📈 LONG ${id}: ${h.qty.toFixed(4)} @$${fmtPrice(h.avgCost)} | <span style="color:${upnl>=0?'var(--green)':'var(--red)'}">${upnl>=0?'+':''}${upnl.toFixed(2)}%</span></div>`);}
  });
  // Open SHORT positions
  Object.entries(state.aiShorts||{}).forEach(([id,sh])=>{
    if(sh.qty>1e-8){const cur=livePrices[id]||sh.entryPrice;const upnl=(sh.entryPrice-cur)/sh.entryPrice*100;logItems.push(`<div class="ai-trade-item short">📉 SHORT ${id}: ${sh.qty.toFixed(4)} @$${fmtPrice(sh.entryPrice)} | <span style="color:${upnl>=0?'var(--green)':'var(--red)'}">${upnl>=0?'+':''}${upnl.toFixed(2)}%</span></div>`);}
  });
  logItems=logItems.concat(state.aiTradeLog.slice(0,5).map(t=>{
    const cls=t.type==='short'?'short':t.type==='short_closed'?'short_closed':t.pnl!=null?(t.pnl>0?'profit':'loss'):'';
    const pnlStr=t.pnl!=null?` P&L:${t.pnl>=0?'+':''}$${Math.abs(t.pnl).toFixed(2)}`:'';
    const icon=t.type==='buy'?'🟢':t.type==='sell'?'🔴':t.type==='short'?'📉':'📊';
    return `<div class="ai-trade-item ${t.type} ${cls}">${icon}${t.time} ${t.type.toUpperCase()} ${t.qty.toFixed(4)} ${t.coin} @$${fmtPrice(t.price)}${pnlStr}</div>`;
  }));
  aiLog.innerHTML=logItems.length?logItems.join(''):'<div style="color:var(--text2);font-size:11px;text-align:center;padding:8px">Waiting...</div>';

  // User panel
  const userPosVals=Object.entries(state.userPositions||{}).reduce((s,[id,p])=>{
    const cur=livePrices[id]||p.avgCost||p.entryPrice;
    if(p.side==='long')return s+p.qty*cur;
    else return s+p.margin+(p.entryPrice-cur)*p.qty; // short: margin + unrealized
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
    const pnl=isLong?(p.qty*cur-p.invested):(p.entryPrice-cur)*p.qty;
    const entryPriceStr=isLong?fmtPrice(p.avgCost):fmtPrice(p.entryPrice);
    const pnlPct=isLong?((cur-p.avgCost)/p.avgCost*100):((p.entryPrice-cur)/p.entryPrice*100);
    const color=isLong?'var(--green)':'var(--amber)';
    const closeAction=isLong?'close_long':'close_short';
    // TP button: profit >= 0.3% | CL button: loss >= 1%
    let actionBtn='';
    if(pnlPct>=0.3){
      actionBtn=`<button class="btn-tp" onclick="quickClose('${id}','${closeAction}')">✓ TAKE PROFIT +${pnlPct.toFixed(2)}%</button>`;
    } else if(pnlPct<=-1){
      actionBtn=`<button class="btn-cl" onclick="quickClose('${id}','${closeAction}')">⚠ CUT LOSS ${pnlPct.toFixed(2)}%</button>`;
    }
    return `<div class="holding" style="border-color:${color}">
      <div class="holding-row">
        <div>
          <div class="holding-name" style="color:${color}">${isLong?'📈 LONG':'📉 SHORT'} ${id}</div>
          <div class="holding-qty">${p.qty.toFixed(4)} @$${entryPriceStr}</div>
        </div>
        <div>
          <div class="holding-value" style="color:${color}">$${fmtUSD(isLong?p.qty*cur:p.margin)}</div>
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
    moodEl.textContent=`MOOD: ${aiMemory.mood||'NEUTRAL'} | STREAK: ${streakStr}`;
    const moodColors={CONFIDENT:'var(--green)',REVENGE:'var(--red)',CAUTIOUS:'var(--amber)',NEUTRAL:'var(--text2)'};
    moodEl.style.color=moodColors[aiMemory.mood]||'var(--text2)';
  }
  document.getElementById('ai-points').textContent='$'+fmtUSD(aiPortfolio);
  document.getElementById('user-points').textContent='$'+fmtUSD(userPortfolio);
  document.getElementById('daily-date').textContent=state.dailyDate;
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

// ---- INIT ----
(async function init(){
  await loadAllCandles();
  await refreshAll();
  updateUI();
  setInterval(updateUI,1000);
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
  setInterval(checkAITrade,2000);

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

// ── UPSERT current state to Supabase ──
async function supabaseSave(){
  if(!walletAddress) return false;
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

