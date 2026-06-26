// ════════════════════════════════════════════════════════════════
// CONFIG.JS — AI Battle Trader · Complete Configuration
// ════════════════════════════════════════════════════════════════

// ── SUPABASE (Points & Leaderboard) ──────────────────────────
const SUPA_URL   = 'https://wkuthrdejvrrwfzsdwwn.supabase.co';
const SUPA_KEY   = 'sb_publishable_pboV4Wslc2PaDtOMEAcjDw__-ELtO6l';
const SUPA_TABLE = 'battle_states';

// ── GAME SETTINGS ─────────────────────────────────────────────
const GAME_CONFIG = {
  startingCash      : 1000,
  defaultTradeSize  : 100,
  resetHourIST      : 5,
  ptsVersionKey     : 'aiBattle_pts_v3',
  autoSaveInterval  : 2000,  // debounce save every 2s
};

// ── LEVERAGE TRADING CONFIG ───────────────────────────────────
const LEVERAGE_CONFIG = {
  maxLeverage            : 20,
  defaultLeverage        : 10,   // user default
  aiLeverage             : 5,    // AI starts at 5x (safer)
  aiMaxLeverage          : 10,   // AI can boost to 10x in strong trends
  liquidationThreshold   : 0.90, // 90% loss = liquidation
  maintenanceMargin      : 0.005, // 0.5% maintenance margin
  fundingRate            : 0.0001, // 0.01% per 8h
  allowedLeverages       : [1, 2, 5, 10, 20, 50],
};

// ── TRADEABLE COINS ──────────────────────────────────────────
const COINS = [
  { id:'BTC',       symbol:'BTCUSDT',       name:'Bitcoin',   icon:'₿',  color:'#f7931a' },
  { id:'ETH',       symbol:'ETHUSDT',       name:'Ethereum',  icon:'Ξ',  color:'#627eea' },
  { id:'SOL',       symbol:'SOLUSDT',       name:'Solana',    icon:'◎',  color:'#9945ff' },
  { id:'BNB',       symbol:'BNBUSDT',       name:'BNB',       icon:'⬡',  color:'#f3ba2f' },
  { id:'ANTHROPIC', symbol:'ANTHROPICUSDT', name:'Anthropic', icon:'🤖', color:'#cc785c', perp:true },
];

// ── AI TRADING PARAMETERS ────────────────────────────────────
const AI_CONFIG = {
  // Entry signals
  minAtrPctForEntry    : 0.50,  // ATR < 0.5% = chop, skip entry
  rsiEntryThreshold    : 70,    // RSI > 70 = overbought (short), < 30 = oversold (long)
  
  // TP/SL based on ATR (0.1% min)
  minTPPct             : 0.55,  // minimum 0.55% TP
  minSLPct             : 0.60,  // minimum 0.60% SL
  tpMultiplierTrend    : 1.6,   // trend: TP = ATR × 1.6
  tpMultiplierChop     : 1.1,   // chop: TP = ATR × 1.1
  slMultiplier         : 0.55,  // SL = ATR × 0.55 (always narrower than TP)
  
  // Risk management
  rrRatioMin           : 2.0,   // Risk:Reward must be >= 2:1
  maxOpenPositions     : 3,     // AI max 3 open positions
  maxCashPerTrade      : 300,   // max $300 per trade (avoid blowing up)
  
  // Cooldown to reduce overtrading
  cooldownNormal       : 60000,  // 60s between trades in trending
  cooldownChop         : 90000,  // 90s between trades in chop (less signals)
  
  // Time-based exits
  maxHoldTimeMinutes   : 8,     // force exit after 8 mins if not covering fees
  minHoldTimeSeconds   : 15,    // don't close within 15s (noise)
  
  // Trailing stop
  trailActivateAtTP    : 0.6,   // activate when profit >= 60% of TP
  trailDistance        : 0.25,  // trail by 25% of TP distance
  
  // Mood/streak system
  revengeThreshold     : 3,     // 3 losses in a row = revenge mood (trade bigger)
  consecutiveWinCap    : 5,     // cap wins streak at 5 for confidence
};

// ── NETWORK ───────────────────────────────────────────────────
const NETWORK_CONFIG = {
  chainId   : 11155111,
  chainName : 'Sepolia Testnet',
  rpcUrl    : 'https://sepolia.drpc.org',
  explorer  : 'https://sepolia.etherscan.io',
};

// ── MARKET REGIMES (for AI decision-making) ──────────────────
const MARKET_REGIMES = {
  STRONG_BULL: 1,   // ADX > 30 & +DI > -DI → No shorts allowed
  BULL:       2,    // RSI > 55 & price above EMA20 → Shorts blocked
  NEUTRAL:    3,    // No clear trend
  BEAR:       4,    // RSI < 45 & price below EMA20 → Longs blocked
  STRONG_BEAR:5,    // ADX > 30 & -DI > +DI → No longs allowed
};

// ── VISUAL/UI CONSTANTS ──────────────────────────────────────
const UI_CONFIG = {
  candleCount         : 100,    // display 100 candles on chart
  chartUpdateMs       : 500,    // redraw chart every 500ms
  notificationTimeoutMs : 3000, // notification fades after 3s
  animationSpeedMs    : 300,    // CSS animation duration
};

// ── FEE STRUCTURE ────────────────────────────────────────────
const FEES_CONFIG = {
  makerFee            : 0.0001, // 0.01% maker
  takerFee            : 0.0005, // 0.05% taker
  withdrawalFee       : 0.0001, // 0.01% on withdrawal
};
