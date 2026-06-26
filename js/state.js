// ════════════════════════════════════════════════════════════════
// STATE.JS — AI Battle Trader · Game State Management
// ════════════════════════════════════════════════════════════════

// ── GLOBAL STATE (single source of truth) ──────────────────────
let state = {
  // === USER PORTFOLIO ===
  userCash        : GAME_CONFIG.startingCash,
  userPositions   : {},        // { BTC: {side, qty, avgCost, margin, leverage}, ... }
  userTradeLog    : [],        // all trade history
  userWins        : 0,
  userLosses      : 0,
  
  // === AI PORTFOLIO ===
  aiCash          : GAME_CONFIG.startingCash,
  aiHoldings      : {},        // long positions
  aiShorts        : {},        // short positions
  aiTradeLog      : [],
  aiWins          : 0,
  aiLosses        : 0,
  aiMemory        : {          // self-learning model
    winStreak     : 0,
    lossStreak    : 0,
    lastMood      : 'neutral',
  },
  
  // === SESSION META ===
  selectedCoin    : 'BTC',
  tf              : '1m',      // timeframe: '1m', '5m', '15m', '1h'
  userTradeSize   : GAME_CONFIG.defaultTradeSize,
  _sizeKey        : GAME_CONFIG.defaultTradeSize, // track active button
  _bestValue      : GAME_CONFIG.startingCash,    // track peak balance
  currentLeverage : LEVERAGE_CONFIG.defaultLeverage,
  
  // === TIMING ===
  dailyDate       : new Date().toISOString().split('T')[0],
  battleActive    : true,
  sessionStart    : Date.now(),
};

// ── LIFETIME POINTS (never resets, survives daily reset) ──────
let lifetimePts = { user: 0, ai: 0, version: GAME_CONFIG.ptsVersionKey };

// ── SAVE/LOAD FUNCTIONS ────────────────────────────────────────

async function saveState() {
  const toSave = {
    userCash        : state.userCash,
    userPositions   : state.userPositions,
    userTradeLog    : (state.userTradeLog || []).slice(0, 100),
    userWins        : state.userWins,
    userLosses      : state.userLosses,
    
    aiCash          : state.aiCash,
    aiHoldings      : state.aiHoldings,
    aiShorts        : state.aiShorts,
    aiTradeLog      : (state.aiTradeLog || []).slice(0, 100),
    aiWins          : state.aiWins,
    aiLosses        : state.aiLosses,
    aiMemory        : state.aiMemory,
    
    selectedCoin    : state.selectedCoin,
    userTradeSize   : state.userTradeSize,
    _sizeKey        : state._sizeKey,
    _bestValue      : state._bestValue,
    currentLeverage : state.currentLeverage || LEVERAGE_CONFIG.defaultLeverage,
    
    dailyDate       : state.dailyDate,
    battleActive    : state.battleActive,
    ts              : Date.now(),
  };

  // Save to localStorage (instant)
  try {
    localStorage.setItem('aiBattle_state', JSON.stringify(toSave));
  } catch (e) {
    console.warn('localStorage full, continuing', e);
  }

  // Save to Supabase (async, debounced)
  const wallet = localStorage.getItem('aiBattle_wallet');
  if (wallet && typeof supabase !== 'undefined') {
    try {
      const { data, error } = await supabase
        .from(SUPA_TABLE)
        .upsert({ wallet_addr: wallet, state_json: JSON.stringify(toSave), updated_at: new Date() }, 
                  { onConflict: 'wallet_addr' });
      if (!error) {
        document.getElementById('supabase-sync-badge').style.display = 'inline';
        setTimeout(() => document.getElementById('supabase-sync-badge').style.display = 'none', 1000);
      }
    } catch (e) {
      console.warn('Supabase sync failed', e);
    }
  }
}

async function loadState() {
  // Try localStorage first
  const saved = localStorage.getItem('aiBattle_state');
  if (saved) {
    try {
      const loaded = JSON.parse(saved);
      Object.assign(state, loaded);
    } catch (e) {
      console.error('Parse error:', e);
    }
  }

  // Try Supabase
  const wallet = localStorage.getItem('aiBattle_wallet');
  if (wallet && typeof supabase !== 'undefined') {
    try {
      const { data, error } = await supabase
        .from(SUPA_TABLE)
        .select('state_json')
        .eq('wallet_addr', wallet)
        .single();
      if (!error && data?.state_json) {
        const cloudState = JSON.parse(data.state_json);
        Object.assign(state, cloudState);
      }
    } catch (e) {
      // Not found or error - ok, use localStorage
    }
  }

  // Reset if new day
  const today = new Date().toISOString().split('T')[0];
  if (state.dailyDate !== today) {
    resetBattle();
  }
}

async function syncFromCloud() {
  const wallet = localStorage.getItem('aiBattle_wallet');
  if (!wallet) {
    notify('Not connected', 'loss');
    return;
  }
  try {
    const { data, error } = await supabase
      .from(SUPA_TABLE)
      .select('state_json')
      .eq('wallet_addr', wallet)
      .single();
    if (!error && data?.state_json) {
      const cloudState = JSON.parse(data.state_json);
      Object.assign(state, cloudState);
      saveState();
      updateUI();
      notify('✅ Synced from cloud', 'profit');
    }
  } catch (e) {
    notify('Cloud sync failed', 'loss');
  }
}

function resetBattle() {
  const today = new Date().toISOString().split('T')[0];
  state.userCash      = GAME_CONFIG.startingCash;
  state.userPositions = {};
  state.userTradeLog  = [];
  state.userWins      = 0;
  state.userLosses    = 0;
  state.currentLeverage = LEVERAGE_CONFIG.defaultLeverage;

  state.aiCash        = GAME_CONFIG.startingCash;
  state.aiHoldings    = {};
  state.aiShorts      = {};
  state.aiTradeLog    = [];
  state.aiWins        = 0;
  state.aiLosses      = 0;
  state.aiMemory      = { winStreak: 0, lossStreak: 0, lastMood: 'neutral' };

  state.dailyDate     = today;
  state.battleActive  = true;
  state.selectedCoin  = 'BTC';
  state.tf            = '1m';

  saveState();
  notify('⚔️ Battle reset for new day', 'reward');
}

function exportSave() {
  const bundle = { state, lifetimePts, v: 2, ts: Date.now() };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `aibattle-save-${state.dailyDate}.json`;
  a.click();
  notify('📥 Save exported', 'profit');
}

function importSave(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const bundle = JSON.parse(e.target.result);
      Object.assign(state, bundle.state || {});
      Object.assign(lifetimePts, bundle.lifetimePts || {});
      saveState();
      updateUI();
      notify('✅ Save imported', 'profit');
    } catch (err) {
      notify('❌ Import failed', 'loss');
    }
  };
  reader.readAsText(file);
}

// ── STATE HELPERS ──────────────────────────────────────────────

function getPortfolioValue(player = 'user') {
  if (player === 'user') {
    const posVal = Object.entries(state.userPositions || {}).reduce((s, [id, p]) => {
      const cur = livePrices[id] || p.avgCost || p.entryPrice || 0;
      const margin = p.margin || p.invested || 0;
      const unrealizedPnl = p.side === 'long'
        ? p.qty * (cur - p.avgCost)
        : p.qty * (p.entryPrice - cur);
      return s + margin + unrealizedPnl;
    }, 0);
    return state.userCash + posVal;
  } else {
    const longVal = Object.entries(state.aiHoldings || {}).reduce((s, [id, h]) => {
      const cur = livePrices[id] || h.avgCost || 0;
      const margin = h.margin || h.invested || 0;
      const unrealizedPnl = h.qty * (cur - h.avgCost);
      return s + margin + unrealizedPnl;
    }, 0);
    const shortVal = Object.entries(state.aiShorts || {}).reduce((s, [id, sh]) => {
      const cur = livePrices[id] || sh.entryPrice || 0;
      const margin = sh.margin || 0;
      const unrealizedPnl = sh.qty * (sh.entryPrice - cur);
      return s + margin + unrealizedPnl;
    }, 0);
    return state.aiCash + longVal + shortVal;
  }
}

function addUserPoints(pts) {
  lifetimePts.user += pts;
  localStorage.setItem(GAME_CONFIG.ptsVersionKey, JSON.stringify(lifetimePts));
}

function addAiPoints(pts) {
  lifetimePts.ai += pts;
  localStorage.setItem(GAME_CONFIG.ptsVersionKey, JSON.stringify(lifetimePts));
}

function calcPts(pnl, margin) {
  const roiPct = (pnl / Math.max(margin, 10)) * 100;
  return Math.round(Math.max(1, roiPct * 0.5));
}

// ── INIT ─────────────────────────────────────────────────────
function initState() {
  // Load lifetime pts
  try {
    const saved = localStorage.getItem(GAME_CONFIG.ptsVersionKey);
    if (saved) lifetimePts = JSON.parse(saved);
  } catch (e) {}

  // Debounced auto-save
  let saveTimer;
  window.addEventListener('beforeunload', saveState);
  setInterval(() => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, GAME_CONFIG.autoSaveInterval);
  }, 500);
}
