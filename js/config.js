// ════════════════════════════════════════════════════════════════
//  config.js — AI Battle Trader · App Configuration
//  ⚠️  Yahan hi sare constants change karo — baaki files mat chhuo
// ════════════════════════════════════════════════════════════════

// ── Supabase (Points & Leaderboard) ──────────────────────────
const SUPA_URL   = 'https://wkuthrdejvrrwfzsdwwn.supabase.co';
const SUPA_KEY   = 'sb_publishable_pboV4Wslc2PaDtOMEAcjDw__-ELtO6l';
const SUPA_TABLE = 'battle_states';

// ── Game Settings ─────────────────────────────────────────────
const GAME_CONFIG = {
  startingCash      : 1000,       // Each side starts with this (USD)
  defaultTradeSize  : 100,        // Default order size (USD)
  resetHourIST      : 5,          // Daily reset hour in IST (5 AM)
  ptsVersionKey     : 'aiBattle_pts_v3', // Bump to wipe all pts
};

// ── Tradeable Coins ───────────────────────────────────────────
const COINS = [
  { id:'BTC',       symbol:'BTCUSDT',       name:'Bitcoin',   icon:'₿',  color:'#f7931a' },
  { id:'ETH',       symbol:'ETHUSDT',       name:'Ethereum',  icon:'Ξ',  color:'#627eea' },
  { id:'SOL',       symbol:'SOLUSDT',       name:'Solana',    icon:'◎',  color:'#9945ff' },
  { id:'BNB',       symbol:'BNBUSDT',       name:'BNB',       icon:'⬡',  color:'#f3ba2f' },
  { id:'ANTHROPIC', symbol:'ANTHROPICUSDT', name:'Anthropic', icon:'🤖', color:'#cc785c', perp:true },
];

// ── Network ───────────────────────────────────────────────────
const NETWORK_CONFIG = {
  chainId   : 11155111,            // Sepolia testnet
  chainName : 'Sepolia Testnet',
  rpcUrl    : 'https://sepolia.drpc.org',
  explorer  : 'https://sepolia.etherscan.io',
};
