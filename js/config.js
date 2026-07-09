// ════════════════════════════════════════════════════════════════
// CONFIG.JS — AI Battle Trader · Complete Configuration
// UPDATED: Top 20 Altcoins + Market Context
// ════════════════════════════════════════════════════════════════

// ── SUPABASE (Points & Leaderboard) ──────────────────────────
const SUPA_URL   = 'https://wkuthrdejvrrwfzsdwwn.supabase.co';
const SUPA_KEY   = 'sb_publishable_pboV4Wslc2PaDtOMEAcjDw__-ELtO6l';
const SUPA_TABLE = 'battle_states';

// ── 24/7 SERVER-SIDE AI ───────────────────────────────────────
// false (default): AI runs locally in this browser tab, exactly as before —
//   nothing changes until you flip this.
// true: AI runs on the Supabase Edge Function (ai-tick) 24/7. This browser
//   becomes read-only for the AI side (just displays server progress) and
//   only saves the USER's own trades. Flip this to true only AFTER you've
//   deployed supabase/functions/ai-tick and set up the cron trigger — see
//   DEPLOY_24_7.md.
const SERVER_AI_MODE = true;

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

// ── TRADEABLE COINS (TOP 20 ALTCOINS BY MARKET CAP) ───────────
// Symbols match Binance USDT perpetuals (e.g., BTCUSDT)
// Icons: Unicode symbols for visual distinction
// Colors: Brand colors for each ecosystem
const COINS = [
  // Tier 1 - Megacaps
  { id:'BTC',       symbol:'BTCUSDT',       name:'Bitcoin',       icon:'₿',  color:'#f7931a' },
  { id:'ETH',       symbol:'ETHUSDT',       name:'Ethereum',      icon:'Ξ',  color:'#627eea' },
  
  // Tier 2 - Major Chains
  { id:'BNB',       symbol:'BNBUSDT',       name:'BNB Chain',     icon:'⬡',  color:'#f3ba2f' },
  { id:'SOL',       symbol:'SOLUSDT',       name:'Solana',        icon:'◎',  color:'#9945ff' },
  { id:'XRP',       symbol:'XRPUSDT',       name:'Ripple',        icon:'✕',  color:'#23292f' },
  
  // Tier 3 - Smart Contracts & Infrastructure
  { id:'ADA',       symbol:'ADAUSDT',       name:'Cardano',       icon:'₳',  color:'#0033a0' },
  { id:'DOGE',      symbol:'DOGEUSDT',      name:'Dogecoin',      icon:'Ð',  color:'#ba9f33' },
  { id:'AVAX',      symbol:'AVAXUSDT',      name:'Avalanche',     icon:'⛰️',  color:'#e84142' },
  { id:'LINK',      symbol:'LINKUSDT',      name:'Chainlink',     icon:'⚙️',  color:'#2f56d2' },
  { id:'TRX',       symbol:'TRXUSDT',       name:'Tron',          icon:'☵',  color:'#eb0029' },
  
  // Tier 4 - Layer 2 & DeFi
  { id:'LTC',       symbol:'LTCUSDT',       name:'Litecoin',      icon:'Ł',  color:'#345d9d' },
  { id:'DOT',       symbol:'DOTUSDT',       name:'Polkadot',      icon:'◉',  color:'#e6007a' },
  { id:'UNI',       symbol:'UNIUSDT',       name:'Uniswap',       icon:'🦄', color:'#ff007a' },
  { id:'ARB',       symbol:'ARBUSDT',       name:'Arbitrum',      icon:'◆',  color:'#28a0f0' },
  { id:'OP',        symbol:'OPUSDT',        name:'Optimism',      icon:'◻️',  color:'#ff0420' },
  
  // Tier 5 - Emerging Ecosystems
  { id:'ATOM',      symbol:'ATOMUSDT',      name:'Cosmos',        icon:'★',  color:'#16192b' },
  { id:'NEAR',      symbol:'NEARUSDT',      name:'Near',          icon:'⬤',  color:'#000000' },
  { id:'SUI',       symbol:'SUIUSDT',       name:'Sui',           icon:'◈',  color:'#6fbcf0' },
  { id:'APT',       symbol:'APTUSDT',       name:'Aptos',         icon:'△',  color:'#000000' },
  { id:'FTM',       symbol:'FTMUSDT',       name:'Fantom',        icon:'◇',  color:'#13B0F5' },
  
  // Synthetic (no Binance feed)
  { id:'ANTHROPIC', symbol:'ANTHROPICUSDT', name:'Anthropic',     icon:'🤖', color:'#cc785c', perp:true },
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

// ── TIER UNLOCK SYSTEM (Sepolia gas-based) ────────────────────
const TIER_DEFS = [
  {
    id: 1, icon: '🟡', name: 'Momentum Pro',
    desc: 'StochRSI overbought/oversold confirmation — filters false breakouts with precision entry.',
    color: '#f7931a',
  },
  {
    id: 2, icon: '🟣', name: 'Pattern Intel',
    desc: 'Bollinger Band exit + Morning/Evening Star 3-candle reversals on chart.',
    color: '#9945ff',
  },
  {
    id: 3, icon: '🤖', name: 'AI Learning Engine',
    desc: 'Adapts every 20 trades — learns which indicators worked best. RSI/MACD/Pattern weights adjust dynamically. Gets smarter over time.',
    color: '#cc44ff',
  },
  {
    id: 4, icon: '📐', name: 'Kelly Criterion Sizing',
    desc: 'Position size calculated using Kelly formula (win rate × avg win / avg loss). Auto-scales — bigger bets when win rate is high, smaller when losing. Ported from NEXUS bot.',
    color: '#00d4ff',
  },
  {
    id: 5, icon: '🛡️', name: 'Anti-Revenge Overdrive',
    desc: 'When losing streak >3, forces CAUTIOUS mode — entry threshold +5, size cut to 30%, max 1 trade/5m. Breaks the revenge-trading spiral that causes -20 loss streaks.',
    color: '#00ff88',
  },
  {
    id: 6, icon: '🔭', name: 'Multi-TF Confirmation',
    desc: 'AI only enters when 1m + 15m + 1h timeframes ALL agree on direction. Filters noise — fewer trades but much higher quality. Win rate over trade count.',
    color: '#ffd700',
  },
];

// Tier-unlock "gas burn" contract (Sepolia testnet).
// ⚠️ UPDATE THIS after deploying TierUnlock.sol — see DEPLOY_TIER_UNLOCK.md.
// The old address's contract had no matching function for the unlock calls
// the app was sending (always reverted on-chain, gas spent for nothing).
const CONTRACT_ADDRESS = '0x788a8035D7118528eD6E96ed2D09402DC3fC8F9a'; // ← replace with your new deployed address
