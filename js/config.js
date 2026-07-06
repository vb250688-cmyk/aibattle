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

// Sepolia contract for on-chain score saves
const CONTRACT_ADDRESS = '0x4d76311E921FF2528044F4ff17C38dcd981EBd77';

// ══════════════════════════════════════════════════════════════
// PHASE 3 — WEB3: TOKEN + NFT BADGES + STAKING (Sepolia testnet)
// ══════════════════════════════════════════════════════════════
// ⚠️ FILL THESE IN AFTER YOU DEPLOY THE CONTRACTS (see DEPLOY_GUIDE.md).
// Until filled in, the Web3 Hub UI will show "Not deployed yet".
const WEB3_CONFIG = {
  tokenAddress:   '0x0000000000000000000000000000000000000000', // BattleToken.sol
  nftAddress:     '0x0000000000000000000000000000000000000000', // BattleNFT.sol
  stakingAddress: '0x0000000000000000000000000000000000000000', // BattleStaking.sol
};

// Minimal human-readable ABIs (ethers.js v6 format) — only what the frontend calls.
const BATTLE_TOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function claimDaily()',
  'function timeUntilNextClaim(address) view returns (uint256)',
];

const BATTLE_NFT_ABI = [
  'function mintBadge(uint256 badgeType)',
  'function owns(address user, uint256 badgeType) view returns (bool)',
  'function balanceOf(address) view returns (uint256)',
];

const BATTLE_STAKING_ABI = [
  'function stake(uint256 amount)',
  'function unstake(uint256 amount)',
  'function claimReward()',
  'function pendingReward(address user) view returns (uint256)',
  'function stakes(address) view returns (uint256 amount, uint256 rewardCheckpoint)',
  'function aprBasisPoints() view returns (uint256)',
];

// Badge definitions — badgeType id must match what you mint on-chain.
// `check(state)` decides whether the player has unlocked it in-game (client-trusted,
// same model as the existing Sepolia Tier-Unlock system in this project).
const BADGE_DEFS = [
  { id: 0, icon: '🟡', name: 'Momentum Pro',        check: (s) => (s.unlockedTiers || []).includes(1) },
  { id: 1, icon: '🟣', name: 'Pattern Intel',        check: (s) => (s.unlockedTiers || []).includes(2) },
  { id: 2, icon: '🤖', name: 'AI Learning Engine',   check: (s) => (s.unlockedTiers || []).includes(3) },
  { id: 3, icon: '📐', name: 'Kelly Criterion',      check: (s) => (s.unlockedTiers || []).includes(4) },
  { id: 4, icon: '🛡️', name: 'Anti-Revenge',         check: (s) => (s.unlockedTiers || []).includes(5) },
  { id: 5, icon: '🔭', name: 'Multi-TF Master',      check: (s) => (s.unlockedTiers || []).includes(6) },
  { id: 6, icon: '⚔️', name: 'PvP Champion',         check: () => (parseInt(localStorage.getItem('aiBattle_pvpWins') || '0', 10) >= 1) },
  { id: 7, icon: '💯', name: 'Century Trader',       check: (s) => ((s.userTradeLog || []).length >= 100) },
];
