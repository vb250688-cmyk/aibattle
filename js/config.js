/* ═══════════════════════════════════════════════════════════════════════════════
   CONFIGURATION FILE
   Multiplayer Trading Battle Game - Complete Configuration
   ═══════════════════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════════════════════════
// GAME CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const GAME_CONFIG = {
  startingCash: 1000,
  aiStartingCash: 1000,
  maxLeverage: 50,
  maintenanceMargin: 0.05, // 5%
  liquidationFee: 0.01, // 1%
  fundingRate: 0.0001, // 0.01% per hour
  maxOpenPositions: 3,
  dailyResetHour: 5, // 5 AM IST
  timezone: 'Asia/Kolkata'
};

// ═══════════════════════════════════════════════════════════════════════════════
// AI CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const AI_CONFIG = {
  tradeInterval: 2000, // 2 seconds
  minConfidence: 0.6,
  maxOpenPositions: 2,
  riskPerTrade: 0.1, // 10% of cash
  stopLoss: 0.02, // 2%
  takeProfit: 0.05, // 5%
  moodSwingThreshold: 3, // trades before mood change
  revengeModeMultiplier: 1.5,
  fearModeMultiplier: 0.5
};

// ═══════════════════════════════════════════════════════════════════════════════
// 50+ CRYPTOCURRENCIES (Extended List)
// ═══════════════════════════════════════════════════════════════════════════════

const COINS = [
  // ═══ MAJOR COINS (High Liquidity) ═══
  { 
    symbol: 'BTCUSDT', 
    name: 'Bitcoin', 
    icon: '₿', 
    category: 'major', 
    leverage: 125,
    color: '#F7931A',
    volatility: 'medium'
  },
  { 
    symbol: 'ETHUSDT', 
    name: 'Ethereum', 
    icon: 'Ξ', 
    category: 'major', 
    leverage: 100,
    color: '#627EEA',
    volatility: 'medium'
  },
  { 
    symbol: 'BNBUSDT', 
    name: 'BNB', 
    icon: 'B', 
    category: 'major', 
    leverage: 50,
    color: '#F3BA2F',
    volatility: 'medium'
  },
  { 
    symbol: 'SOLUSDT', 
    name: 'Solana', 
    icon: '◎', 
    category: 'major', 
    leverage: 50,
    color: '#00FFA3',
    volatility: 'high'
  },
  
  // ═══ LAYER 1 BLOCKCHAINS ═══
  { 
    symbol: 'AVAXUSDT', 
    name: 'Avalanche', 
    icon: '🔺', 
    category: 'l1', 
    leverage: 50,
    color: '#E84142',
    volatility: 'high'
  },
  { 
    symbol: 'MATICUSDT', 
    name: 'Polygon', 
    icon: '⬡', 
    category: 'l1', 
    leverage: 50,
    color: '#8247E5',
    volatility: 'medium'
  },
  { 
    symbol: 'FTMUSDT', 
    name: 'Fantom', 
    icon: '👻', 
    category: 'l1', 
    leverage: 50,
    color: '#1969FF',
    volatility: 'high'
  },
  { 
    symbol: 'NEARUSDT', 
    name: 'NEAR', 
    icon: '⬢', 
    category: 'l1', 
    leverage: 50,
    color: '#00C08B',
    volatility: 'high'
  },
  { 
    symbol: 'ATOMUSDT', 
    name: 'Cosmos', 
    icon: '⚛', 
    category: 'l1', 
    leverage: 50,
    color: '#2E3148',
    volatility: 'medium'
  },
  { 
    symbol: 'ADAUSDT', 
    name: 'Cardano', 
    icon: '₳', 
    category: 'l1', 
    leverage: 50,
    color: '#0033AD',
    volatility: 'low'
  },
  { 
    symbol: 'DOTUSDT', 
    name: 'Polkadot', 
    icon: '●', 
    category: 'l1', 
    leverage: 50,
    color: '#E6007A',
    volatility: 'medium'
  },
  { 
    symbol: 'ALGOUSDT', 
    name: 'Algorand', 
    icon: 'A', 
    category: 'l1', 
    leverage: 50,
    color: '#00B2D6',
    volatility: 'medium'
  },
  
  // ═══ DEFI BLUE CHIPS ═══
  { 
    symbol: 'UNIUSDT', 
    name: 'Uniswap', 
    icon: '🦄', 
    category: 'defi', 
    leverage: 50,
    color: '#FF007A',
    volatility: 'high'
  },
  { 
    symbol: 'AAVEUSDT', 
    name: 'Aave', 
    icon: '👻', 
    category: 'defi', 
    leverage: 50,
    color: '#B6509E',
    volatility: 'medium'
  },
  { 
    symbol: 'MKRUSDT', 
    name: 'Maker', 
    icon: '🏦', 
    category: 'defi', 
    leverage: 50,
    color: '#1AAB9B',
    volatility: 'medium'
  },
  { 
    symbol: 'COMPUSDT', 
    name: 'Compound', 
    icon: '💰', 
    category: 'defi', 
    leverage: 50,
    color: '#00D395',
    volatility: 'medium'
  },
  { 
    symbol: 'CRVUSDT', 
    name: 'Curve', 
    icon: '📈', 
    category: 'defi', 
    leverage: 50,
    color: '#FF8C00',
    volatility: 'high'
  },
  { 
    symbol: 'SNXUSDT', 
    name: 'Synthetix', 
    icon: '⚗️', 
    category: 'defi', 
    leverage: 50,
    color: '#00D1FF',
    volatility: 'high'
  },
  { 
    symbol: 'YFIUSDT', 
    name: 'Yearn', 
    icon: '💎', 
    category: 'defi', 
    leverage: 50,
    color: '#0657D9',
    volatility: 'extreme'
  },
  { 
    symbol: 'SUSHIUSDT', 
    name: 'SushiSwap', 
    icon: '🍣', 
    category: 'defi', 
    leverage: 50,
    color: '#FA52A0',
    volatility: 'high'
  },
  { 
    symbol: '1INCHUSDT', 
    name: '1inch', 
    icon: '⚡', 
    category: 'defi', 
    leverage: 50,
    color: '#1C324F',
    volatility: 'high'
  },
  
  // ═══ MEME COINS (High Volatility) ═══
  { 
    symbol: 'DOGEUSDT', 
    name: 'Dogecoin', 
    icon: '🐕', 
    category: 'meme', 
    leverage: 50,
    color: '#C2A633',
    volatility: 'extreme'
  },
  { 
    symbol: 'SHIBUSDT', 
    name: 'Shiba Inu', 
    icon: '🐕', 
    category: 'meme', 
    leverage: 50,
    color: '#E8B923',
    volatility: 'extreme'
  },
  { 
    symbol: 'PEPEUSDT', 
    name: 'Pepe', 
    icon: '🐸', 
    category: 'meme', 
    leverage: 50,
    color: '#4CA64C',
    volatility: 'extreme'
  },
  { 
    symbol: 'FLOKIUSDT', 
    name: 'Floki', 
    icon: '⚔️', 
    category: 'meme', 
    leverage: 50,
    color: '#FCCF00',
    volatility: 'extreme'
  },
  { 
    symbol: 'BONKUSDT', 
    name: 'Bonk', 
    icon: '🔨', 
    category: 'meme', 
    leverage: 50,
    color: '#FF6B00',
    volatility: 'extreme'
  },
  { 
    symbol: 'WIFUSDT', 
    name: 'DogWifHat', 
    icon: '🎩', 
    category: 'meme', 
    leverage: 50,
    color: '#9945FF',
    volatility: 'extreme'
  },
  { 
    symbol: 'BOMEUSDT', 
    name: 'Book of Meme', 
    icon: '📖', 
    category: 'meme', 
    leverage: 25,
    color: '#00FF88',
    volatility: 'extreme'
  },
  
  // ═══ AI TOKENS (Trending) ═══
  { 
    symbol: 'RNDRUSDT', 
    name: 'Render', 
    icon: '🎨', 
    category: 'ai', 
    leverage: 50,
    color: '#FF6B35',
    volatility: 'high'
  },
  { 
    symbol: 'FETUSDT', 
    name: 'Fetch.ai', 
    icon: '🤖', 
    category: 'ai', 
    leverage: 50,
    color: '#0F0F0F',
    volatility: 'high'
  },
  { 
    symbol: 'AGIXUSDT', 
    name: 'SingularityNET', 
    icon: '🧠', 
    category: 'ai', 
    leverage: 50,
    color: '#6916FF',
    volatility: 'high'
  },
  { 
    symbol: 'WLDUSDT', 
    name: 'Worldcoin', 
    icon: '👁️', 
    category: 'ai', 
    leverage: 50,
    color: '#00D4FF',
    volatility: 'high'
  },
  { 
    symbol: 'ARKMUSDT', 
    name: 'Arkham', 
    icon: '🔍', 
    category: 'ai', 
    leverage: 50,
    color: '#FF4D4D',
    volatility: 'high'
  },
  { 
    symbol: 'TAOUSDT', 
    name: 'Bittensor', 
    icon: '⛓️', 
    category: 'ai', 
    leverage: 50,
    color: '#00FFA3',
    volatility: 'high'
  },
  { 
    symbol: 'LPTUSDT', 
    name: 'Livepeer', 
    icon: '📺', 
    category: 'ai', 
    leverage: 50,
    color: '#00FF88',
    volatility: 'medium'
  },
  
  // ═══ GAMING/METAVERSE ═══
  { 
    symbol: 'SANDUSDT', 
    name: 'Sandbox', 
    icon: '⏹️', 
    category: 'gaming', 
    leverage: 50,
    color: '#00B4D8',
    volatility: 'high'
  },
  { 
    symbol: 'MANAUSDT', 
    name: 'Decentraland', 
    icon: '🏝️', 
    category: 'gaming', 
    leverage: 50,
    color: '#FF2D55',
    volatility: 'high'
  },
  { 
    symbol: 'AXSUSDT', 
    name: 'Axie Infinity', 
    icon: '🎮', 
    category: 'gaming', 
    leverage: 50,
    color: '#0055FF',
    volatility: 'high'
  },
  { 
    symbol: 'GALAUSDT', 
    name: 'Gala', 
    icon: '🎲', 
    category: 'gaming', 
    leverage: 50,
    color: '#00FF88',
    volatility: 'high'
  },
  { 
    symbol: 'ENJUSDT', 
    name: 'Enjin', 
    icon: '⚔️', 
    category: 'gaming', 
    leverage: 50,
    color: '#624DBF',
    volatility: 'medium'
  },
  { 
    symbol: 'ILVUSDT', 
    name: 'Illuvium', 
    icon: '👾', 
    category: 'gaming', 
    leverage: 50,
    color: '#00D1FF',
    volatility: 'high'
  },
  { 
    symbol: 'IMXUSDT', 
    name: 'Immutable X', 
    icon: '⚡', 
    category: 'gaming', 
    leverage: 50,
    color: '#0D5FFF',
    volatility: 'medium'
  },
  
  // ═══ INFRASTRUCTURE ═══
  { 
    symbol: 'LINKUSDT', 
    name: 'Chainlink', 
    icon: '🔗', 
    category: 'infra', 
    leverage: 50,
    color: '#375BD2',
    volatility: 'medium'
  },
  { 
    symbol: 'LDOUSDT', 
    name: 'Lido', 
    icon: '💧', 
    category: 'infra', 
    leverage: 50,
    color: '#00A3FF',
    volatility: 'medium'
  },
  { 
    symbol: 'OPUSDT', 
    name: 'Optimism', 
    icon: '☀️', 
    category: 'infra', 
    leverage: 50,
    color: '#FF0420',
    volatility: 'high'
  },
  { 
    symbol: 'ARBUSDT', 
    name: 'Arbitrum', 
    icon: '🔷', 
    category: 'infra', 
    leverage: 50,
    color: '#28A0F0',
    volatility: 'high'
  },
  { 
    symbol: 'GRTUSDT', 
    name: 'The Graph', 
    icon: '📊', 
    category: 'infra', 
    leverage: 50,
    color: '#6747ED',
    volatility: 'medium'
  },
  { 
    symbol: 'PENDLEUSDT', 
    name: 'Pendle', 
    icon: '🔄', 
    category: 'infra', 
    leverage: 50,
    color: '#00FFA3',
    volatility: 'high'
  },
  
  // ═══ NEW/EMERGING (Lower Liquidity) ═══
  { 
    symbol: 'SEIUSDT', 
    name: 'Sei', 
    icon: '⚡', 
    category: 'new', 
    leverage: 25,
    color: '#00FF88',
    volatility: 'extreme'
  },
  { 
    symbol: 'SUIUSDT', 
    name: 'Sui', 
    icon: '💧', 
    category: 'new', 
    leverage: 25,
    color: '#4DA2FF',
    volatility: 'extreme'
  },
  { 
    symbol: 'TIAUSDT', 
    name: 'Celestia', 
    icon: '✨', 
    category: 'new', 
    leverage: 25,
    color: '#7B2D8E',
    volatility: 'extreme'
  },
  { 
    symbol: 'STRKUSDT', 
    name: 'Starknet', 
    icon: '⭐', 
    category: 'new', 
    leverage: 25,
    color: '#FF6B00',
    volatility: 'extreme'
  },
  { 
    symbol: 'MANTAUSDT', 
    name: 'Manta', 
    icon: '🌊', 
    category: 'new', 
    leverage: 25,
    color: '#00D1FF',
    volatility: 'extreme'
  }
];

// Category metadata
const CATEGORY_META = {
  major: { label: 'Major', color: '#FFD700', desc: 'High liquidity, stable' },
  l1: { label: 'Layer 1', color: '#00CED1', desc: 'Blockchain platforms' },
  defi: { label: 'DeFi', color: '#9B59B6', desc: 'Decentralized finance' },
  meme: { label: 'Meme', color: '#FF6B6B', desc: 'High volatility' },
  ai: { label: 'AI', color: '#3498DB', desc: 'Artificial Intelligence' },
  gaming: { label: 'Gaming', color: '#E74C3C', desc: 'GameFi & Metaverse' },
  infra: { label: 'Infra', color: '#2ECC71', desc: 'Infrastructure' },
  new: { label: 'New', color: '#F39C12', desc: 'Emerging tokens' }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MULTIPLAYER CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const MULTIPLAYER_CONFIG = {
  enabled: true,
  syncInterval: 1000, // 1 second
  maxRooms: 100,
  roomTimeout: 3600000, // 1 hour
  maxPlayersPerRoom: 2,
  spectatorSlots: 10,
  regions: ['us-east', 'eu-west', 'asia-singapore']
};

// ═══════════════════════════════════════════════════════════════════════════════
// TRADINGVIEW CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const TRADINGVIEW_CONFIG = {
  enabled: true,
  libraryPath: 'https://s3.tradingview.com/tv.js',
  defaultSymbol: 'BINANCE:BTCUSDT',
  defaultInterval: '1',
  theme: 'dark',
  timezone: 'Asia/Kolkata',
  studies: ['RSI@tv-basicstudies', 'MACD@tv-basicstudies', 'MASimple@tv-basicstudies'],
  enabledFeatures: ['show_popup_button', 'allow_symbol_change'],
  disabledFeatures: ['header_compare', 'header_saveload']
};

// ═══════════════════════════════════════════════════════════════════════════════
// SOUND EFFECTS
// ═══════════════════════════════════════════════════════════════════════════════

const SOUNDS = {
  trade: 'https://assets.mixkit.co/active_storage/sfx/2003/2003-preview.mp3',
  win: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3',
  loss: 'https://assets.mixkit.co/active_storage/sfx/1440/1440-preview.mp3',
  liquidation: 'https://assets.mixkit.co/active_storage/sfx/2006/2006-preview.mp3',
  levelUp: 'https://assets.mixkit.co/active_storage/sfx/1439/1439-preview.mp3',
  alert: 'https://assets.mixkit.co/active_storage/sfx/2007/2007-preview.mp3'
};

// ═══════════════════════════════════════════════════════════════════════════════
// TIER SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

const TIERS = [
  { id: 0, name: 'Rookie', min: 0, color: '#95a5a6', icon: '🌱' },
  { id: 1, name: 'Trader', min: 1000, color: '#3498db', icon: '📈' },
  { id: 2, name: 'Pro', min: 5000, color: '#9b59b6', icon: '🚀' },
  { id: 3, name: 'Whale', min: 20000, color: '#f39c12', icon: '🐋' },
  { id: 4, name: 'Legend', min: 100000, color: '#e74c3c', icon: '👑' }
];

// ═══════════════════════════════════════════════════════════════════════════════
// SUPABASE CONFIGURATION (Replace with your own)
// ═══════════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_KEY = 'your-anon-key';

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GAME_CONFIG, AI_CONFIG, COINS, CATEGORY_META, MULTIPLAYER_CONFIG, TRADINGVIEW_CONFIG, SOUNDS, TIERS, SUPABASE_URL, SUPABASE_KEY };
}