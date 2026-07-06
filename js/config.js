// ============================================
// AI BATTLE TRADER - CONFIGURATION FILE
// ============================================

// WEB3 CONTRACT ADDRESSES (Sepolia Testnet)
// Inhe deploy ke baad update karna hai
const WEB3_CONFIG = {
  tokenAddress:   '0x0000000000000000000000000000000000000000', // BattleToken.sol
  nftAddress:     '0x0000000000000000000000000000000000000000', // BattleNFT.sol
  stakingAddress: '0x0000000000000000000000000000000000000000', // BattleStaking.sol
};

// SUPABASE CONFIGURATION (Cloud Sync ke liye)
// Apna project URL aur anon key daalo
const SUPA_URL = 'https://your-project.supabase.co';
const SUPA_KEY = 'your-anon-key';
const SUPA_TABLE = 'battle_states';

// GAME CONFIGURATION
const GAME_CONFIG = {
  startingCash: 1000,
  defaultTradeSize: 100,
  resetHourUTC: 23.5, // 5 AM IST
  battleDurationHours: 24,
  maxHistory: 50,
  aiIntervalSec: 3,
  priceUpdateSec: 5
};

// LEVERAGE SETTINGS
const LEVERAGE_CONFIG = {
  defaultLeverage: 10,
  aiLeverage: 5,
  aiMaxLeverage: 10,
  liquidationThreshold: 0.90,
  maxLeverage: 100
};

// SUPPORTED COINS
const COINS = [
  { id: 'BTC', symbol: 'BTCUSDT', icon: '₿', color: '#f7931a', name: 'Bitcoin' },
  { id: 'ETH', symbol: 'ETHUSDT', icon: 'Ξ', color: '#627eea', name: 'Ethereum' },
  { id: 'SOL', symbol: 'SOLUSDT', icon: '◎', color: '#00ffa3', name: 'Solana' },
  { id: 'BNB', symbol: 'BNBUSDT', icon: '⬡', color: '#f3ba2f', name: 'Binance Coin' },
  { id: 'ANTHROPIC', symbol: 'ANTHROPIC', icon: '🤖', color: '#d4a5a5', name: 'AI Index' }
];

// AI TIER DEFINITIONS
const TIER_DEFS = [
  { 
    id: 1, 
    name: 'StochRSI Momentum', 
    desc: 'StochRSI oversold/overbought detection', 
    color: '#00d8ff', 
    icon: '⚡',
    strategy: 'momentum'
  },
  { 
    id: 2, 
    name: 'Pattern Master', 
    desc: 'Candlestick pattern recognition', 
    color: '#9945ff', 
    icon: '📊',
    strategy: 'pattern'
  },
  { 
    id: 3, 
    name: 'AI Learning', 
    desc: 'Self-learning with trade history', 
    color: '#00ff88', 
    icon: '🧠',
    strategy: 'learning'
  },
  { 
    id: 4, 
    name: 'Kelly Criterion', 
    desc: 'Optimal position sizing', 
    color: '#f5a623', 
    icon: '📈',
    strategy: 'kelly'
  },
  { 
    id: 5, 
    name: 'Anti-Revenge', 
    desc: 'Prevents emotional trading', 
    color: '#ff3355', 
    icon: '🛡️',
    strategy: 'safe'
  },
  { 
    id: 6, 
    name: 'Multi-TF', 
    desc: 'Higher timeframe confirmation', 
    color: '#ffd700', 
    icon: '🔭',
    strategy: 'multitf'
  }
];

// BADGE DEFINITIONS
const BADGE_DEFS = [
  { id: 0, name: 'First Blood', icon: '🩸', desc: 'Win your first battle' },
  { id: 1, name: 'Day Trader', icon: '📅', desc: 'Place 10+ trades' },
  { id: 2, name: 'Leverage King', icon: '⚡', desc: 'Use 20x leverage' },
  { id: 3, name: 'Win Streak', icon: '🔥', desc: 'Win 5 battles' },
  { id: 4, name: 'Liquidation Survivor', icon: '💀', desc: 'Get liquidated once' },
  { id: 5, name: 'Portfolio Pro', icon: '💰', desc: 'Reach $2000' },
  { id: 6, name: 'PvP Champion', icon: '🏆', desc: 'Win 3 PvP battles' },
  { id: 7, name: 'Copy Trader', icon: '📋', desc: 'Enable copy trading' }
];

// CONTRACT ABIs (Simplified - Full ABI deploy ke baad update karna)
const BATTLE_TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function claimDaily()",
  "function ownerMint(address to, uint256 amount)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)"
];

const BATTLE_NFT_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function mintBadge(uint256 badgeId)",
  "function owns(address user, uint256 badgeId) view returns (bool)",
  "function setBadgeURI(uint256 badgeId, string memory uri)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerMint(address to, uint256 tokenId)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
];

const BATTLE_STAKING_ABI = [
  "function stake(uint256 amount)",
  "function unstake(uint256 amount)",
  "function claimReward()",
  "function pendingReward(address user) view returns (uint256)",
  "function stakes(address user) view returns (uint256 amount, uint256 rewardDebt, uint256 lastUpdate)",
  "function aprBasisPoints() view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function rewardPerToken() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "event Staked(address indexed user, uint256 amount)",
  "event Unstaked(address indexed user, uint256 amount)",
  "event RewardClaimed(address indexed user, uint256 amount)"
];

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WEB3_CONFIG,
    SUPA_URL,
    SUPA_KEY,
    SUPA_TABLE,
    GAME_CONFIG,
    LEVERAGE_CONFIG,
    COINS,
    TIER_DEFS,
    BADGE_DEFS,
    BATTLE_TOKEN_ABI,
    BATTLE_NFT_ABI,
    BATTLE_STAKING_ABI
  };
}
