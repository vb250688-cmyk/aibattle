/* ═══════════════════════════════════════════════════════════════════════════════
   AI TRADING BATTLE GAME - COMPLETE APPLICATION v2.0
   Multiplayer + TradingView + 50+ Coins + Advanced AI
   ═══════════════════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════════════════════════════════════════════
const state = {
  userCash: 1000,
  aiCash: 1000,
  userPositions: {},
  aiPositions: {},
  userHoldings: {},
  aiHoldings: {},
  userTradeLog: [],
  aiTradeLog: [],
  prices: {},
  candles: {},
  futuresPrices: {},
  aiWins: 0,
  aiLosses: 0,
  userWins: 0,
  userLosses: 0,
  dailyPoints: { ai: 0, user: 0 },
  lifetimePoints: { ai: 0, user: 0 },
  lastReset: null,
  tier: 0,
  gameActive: true,
  currentCoin: 'BTCUSDT',
  selectedLeverage: 1,
  orderSide: 'long',
  wsSpot: null,
  wsFutures: null,
  isSpotConnected: false,
  isFuturesConnected: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: 5
};

const mpState = {
  roomId: null,
  isHost: false,
  isSpectator: false,
  opponent: null,
  syncInterval: null,
  channel: null
};

let walletAddress = null;
let supabase = null;
let _eth = null;

const aiMemory = {
  lastPrices: {},
  priceHistory: {},
  volatility: {},
  trend: {},
  mood: 'NEUTRAL',
  moodCount: 0,
  lastTradeTime: 0,
  consecutiveLosses: 0,
  revengeTarget: null
};

let tvWidget = null;
let lwChart = null;
let candleSeries = null;
let volumeSeries = null;

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG (Inline since config.js might not load properly)
// ═══════════════════════════════════════════════════════════════════════════════
const GAME_CONFIG = {
  startingCash: 1000,
  aiStartingCash: 1000,
  maxLeverage: 50,
  maintenanceMargin: 0.05,
  liquidationFee: 0.01,
  fundingRate: 0.0001,
  maxOpenPositions: 3,
  dailyResetHour: 5,
  timezone: 'Asia/Kolkata'
};

const AI_CONFIG = {
  tradeInterval: 2000,
  minConfidence: 0.6,
  maxOpenPositions: 2,
  riskPerTrade: 0.1,
  stopLoss: 0.02,
  takeProfit: 0.05,
  moodSwingThreshold: 3,
  revengeModeMultiplier: 1.5,
  fearModeMultiplier: 0.5
};

const COINS = [
  { symbol: 'BTCUSDT', name: 'Bitcoin', icon: '₿', category: 'major', leverage: 125, color: '#F7931A' },
  { symbol: 'ETHUSDT', name: 'Ethereum', icon: 'Ξ', category: 'major', leverage: 100, color: '#627EEA' },
  { symbol: 'BNBUSDT', name: 'BNB', icon: 'B', category: 'major', leverage: 50, color: '#F3BA2F' },
  { symbol: 'SOLUSDT', name: 'Solana', icon: '◎', category: 'major', leverage: 50, color: '#00FFA3' },
  { symbol: 'AVAXUSDT', name: 'Avalanche', icon: '🔺', category: 'l1', leverage: 50, color: '#E84142' },
  { symbol: 'MATICUSDT', name: 'Polygon', icon: '⬡', category: 'l1', leverage: 50, color: '#8247E5' },
  { symbol: 'FTMUSDT', name: 'Fantom', icon: '👻', category: 'l1', leverage: 50, color: '#1969FF' },
  { symbol: 'NEARUSDT', name: 'NEAR', icon: '⬢', category: 'l1', leverage: 50, color: '#00C08B' },
  { symbol: 'ATOMUSDT', name: 'Cosmos', icon: '⚛', category: 'l1', leverage: 50, color: '#2E3148' },
  { symbol: 'ADAUSDT', name: 'Cardano', icon: '₳', category: 'l1', leverage: 50, color: '#0033AD' },
  { symbol: 'DOTUSDT', name: 'Polkadot', icon: '●', category: 'l1', leverage: 50, color: '#E6007A' },
  { symbol: 'ALGOUSDT', name: 'Algorand', icon: 'A', category: 'l1', leverage: 50, color: '#00B2D6' },
  { symbol: 'UNIUSDT', name: 'Uniswap', icon: '🦄', category: 'defi', leverage: 50, color: '#FF007A' },
  { symbol: 'AAVEUSDT', name: 'Aave', icon: '👻', category: 'defi', leverage: 50, color: '#B6509E' },
  { symbol: 'MKRUSDT', name: 'Maker', icon: '🏦', category: 'defi', leverage: 50, color: '#1AAB9B' },
  { symbol: 'COMPUSDT', name: 'Compound', icon: '💰', category: 'defi', leverage: 50, color: '#00D395' },
  { symbol: 'CRVUSDT', name: 'Curve', icon: '📈', category: 'defi', leverage: 50, color: '#FF8C00' },
  { symbol: 'SNXUSDT', name: 'Synthetix', icon: '⚗️', category: 'defi', leverage: 50, color: '#00D1FF' },
  { symbol: 'YFIUSDT', name: 'Yearn', icon: '💎', category: 'defi', leverage: 50, color: '#0657D9' },
  { symbol: 'SUSHIUSDT', name: 'SushiSwap', icon: '🍣', category: 'defi', leverage: 50, color: '#FA52A0' },
  { symbol: '1INCHUSDT', name: '1inch', icon: '⚡', category: 'defi', leverage: 50, color: '#1C324F' },
  { symbol: 'DOGEUSDT', name: 'Dogecoin', icon: '🐕', category: 'meme', leverage: 50, color: '#C2A633' },
  { symbol: 'SHIBUSDT', name: 'Shiba Inu', icon: '🐕', category: 'meme', leverage: 50, color: '#E8B923' },
  { symbol: 'PEPEUSDT', name: 'Pepe', icon: '🐸', category: 'meme', leverage: 50, color: '#4CA64C' },
  { symbol: 'FLOKIUSDT', name: 'Floki', icon: '⚔️', category: 'meme', leverage: 50, color: '#FCCF00' },
  { symbol: 'BONKUSDT', name: 'Bonk', icon: '🔨', category: 'meme', leverage: 50, color: '#FF6B00' },
  { symbol: 'WIFUSDT', name: 'DogWifHat', icon: '🎩', category: 'meme', leverage: 50, color: '#9945FF' },
  { symbol: 'BOMEUSDT', name: 'Book of Meme', icon: '📖', category: 'meme', leverage: 25, color: '#00FF88' },
  { symbol: 'RNDRUSDT', name: 'Render', icon: '🎨', category: 'ai', leverage: 50, color: '#FF6B35' },
  { symbol: 'FETUSDT', name: 'Fetch.ai', icon: '🤖', category: 'ai', leverage: 50, color: '#0F0F0F' },
  { symbol: 'AGIXUSDT', name: 'SingularityNET', icon: '🧠', category: 'ai', leverage: 50, color: '#6916FF' },
  { symbol: 'WLDUSDT', name: 'Worldcoin', icon: '👁️', category: 'ai', leverage: 50, color: '#00D4FF' },
  { symbol: 'ARKMUSDT', name: 'Arkham', icon: '🔍', category: 'ai', leverage: 50, color: '#FF4D4D' },
  { symbol: 'TAOUSDT', name: 'Bittensor', icon: '⛓️', category: 'ai', leverage: 50, color: '#00FFA3' },
  { symbol: 'LPTUSDT', name: 'Livepeer', icon: '📺', category: 'ai', leverage: 50, color: '#00FF88' },
  { symbol: 'SANDUSDT', name: 'Sandbox', icon: '⏹️', category: 'gaming', leverage: 50, color: '#00B4D8' },
  { symbol: 'MANAUSDT', name: 'Decentraland', icon: '🏝️', category: 'gaming', leverage: 50, color: '#FF2D55' },
  { symbol: 'AXSUSDT', name: 'Axie Infinity', icon: '🎮', category: 'gaming', leverage: 50, color: '#0055FF' },
  { symbol: 'GALAUSDT', name: 'Gala', icon: '🎲', category: 'gaming', leverage: 50, color: '#00FF88' },
  { symbol: 'ENJUSDT', name: 'Enjin', icon: '⚔️', category: 'gaming', leverage: 50, color: '#624DBF' },
  { symbol: 'ILVUSDT', name: 'Illuvium', icon: '👾', category: 'gaming', leverage: 50, color: '#00D1FF' },
  { symbol: 'IMXUSDT', name: 'Immutable X', icon: '⚡', category: 'gaming', leverage: 50, color: '#0D5FFF' },
  { symbol: 'LINKUSDT', name: 'Chainlink', icon: '🔗', category: 'infra', leverage: 50, color: '#375BD2' },
  { symbol: 'LDOUSDT', name: 'Lido', icon: '💧', category: 'infra', leverage: 50, color: '#00A3FF' },
  { symbol: 'OPUSDT', name: 'Optimism', icon: '☀️', category: 'infra', leverage: 50, color: '#FF0420' },
  { symbol: 'ARBUSDT', name: 'Arbitrum', icon: '🔷', category: 'infra', leverage: 50, color: '#28A0F0' },
  { symbol: 'GRTUSDT', name: 'The Graph', icon: '📊', category: 'infra', leverage: 50, color: '#6747ED' },
  { symbol: 'PENDLEUSDT', name: 'Pendle', icon: '🔄', category: 'infra', leverage: 50, color: '#00FFA3' },
  { symbol: 'SEIUSDT', name: 'Sei', icon: '⚡', category: 'new', leverage: 25, color: '#00FF88' },
  { symbol: 'SUIUSDT', name: 'Sui', icon: '💧', category: 'new', leverage: 25, color: '#4DA2FF' },
  { symbol: 'TIAUSDT', name: 'Celestia', icon: '✨', category: 'new', leverage: 25, color: '#7B2D8E' },
  { symbol: 'STRKUSDT', name: 'Starknet', icon: '⭐', category: 'new', leverage: 25, color: '#FF6B00' },
  { symbol: 'MANTAUSDT', name: 'Manta', icon: '🌊', category: 'new', leverage: 25, color: '#00D1FF' }
];

const CATEGORY_META = {
  major: { label: 'Major', color: '#FFD700' },
  l1: { label: 'Layer 1', color: '#00CED1' },
  defi: { label: 'DeFi', color: '#9B59B6' },
  meme: { label: 'Meme', color: '#FF6B6B' },
  ai: { label: 'AI', color: '#3498DB' },
  gaming: { label: 'Gaming', color: '#E74C3C' },
  infra: { label: 'Infra', color: '#2ECC71' },
  new: { label: 'New', color: '#F39C12' }
};

const TIERS = [
  { id: 0, name: 'Rookie', min: 0, color: '#95a5a6', icon: '🌱' },
  { id: 1, name: 'Trader', min: 1000, color: '#3498db', icon: '📈' },
  { id: 2, name: 'Pro', min: 5000, color: '#9b59b6', icon: '🚀' },
  { id: 3, name: 'Whale', min: 20000, color: '#f39c12', icon: '🐋' },
  { id: 4, name: 'Legend', min: 100000, color: '#e74c3c', icon: '👑' }
];

const SOUNDS = {
  trade: 'https://assets.mixkit.co/active_storage/sfx/2003/2003-preview.mp3',
  win: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3',
  loss: 'https://assets.mixkit.co/active_storage/sfx/1440/1440-preview.mp3',
  liquidation: 'https://assets.mixkit.co/active_storage/sfx/2006/2006-preview.mp3',
  levelUp: 'https://assets.mixkit.co/active_storage/sfx/1439/1439-preview.mp3',
  alert: 'https://assets.mixkit.co/active_storage/sfx/2007/2007-preview.mp3'
};

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 AI Trading Battle v2.0 Initializing...');
  
  initSupabase();
  initCoinList();
  initCharts();
  initEventListeners();
  startPriceFeeds();
  await loadGameData();
  startGameLoops();
  initDailyReset();
  
  console.log('✅ Game initialized successfully');
});

function initSupabase() {
  if (typeof supabaseJs !== 'undefined') {
    supabase = supabaseJs.createClient('https://your-project.supabase.co', 'your-anon-key');
  }
}

function initEventListeners() {
  const slider = document.getElementById('leverage-slider');
  if (slider) slider.addEventListener('input', (e) => updateLeverage(e.target.value));
  
  const amountInput = document.getElementById('order-amount');
  if (amountInput) amountInput.addEventListener('input', updateOrderSummary);
  
  window.addEventListener('resize', () => {
    if (lwChart) lwChart.applyOptions({ width: document.getElementById('lightweight-chart')?.clientWidth || 800 });
  });
}

function startGameLoops() {
  setInterval(updateUI, 1000);
  setInterval(checkLiquidations, 500);
  setInterval(checkAITrade, AI_CONFIG.tradeInterval);
  setInterval(emergencyAudit, 5000);
  setInterval(refreshCandlesIfStale, 20000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// COIN MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════
function initCoinList() {
  const container = document.getElementById('coin-list');
  if (!container) return;
  
  let html = '';
  COINS.forEach(coin => {
    html += `
      <div class="coin-item" data-symbol="${coin.symbol}" onclick="selectCoin('${coin.symbol}')">
        <div class="coin-icon-small" style="color: ${coin.color}">${coin.icon}</div>
        <div class="coin-details">
          <div class="coin-name-small">${coin.name}</div>
          <div class="coin-symbol-small">${coin.symbol.replace('USDT', '')}</div>
        </div>
        <div class="coin-price-small">
          <div class="coin-price-val" id="price-${coin.symbol}">--</div>
          <div class="coin-change-val" id="change-${coin.symbol}">--</div>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

function selectCoin(symbol) {
  state.currentCoin = symbol;
  
  document.querySelectorAll('.coin-item').forEach(item => {
    item.classList.toggle('active', item.dataset.symbol === symbol);
  });
  
  const coin = COINS.find(c => c.symbol === symbol);
  if (coin) {
    const selectedEl = document.getElementById('selected-coin');
    if (selectedEl) selectedEl.textContent = symbol.replace('USDT', '');
    
    const chartSymbolEl = document.getElementById('chart-symbol');
    if (chartSymbolEl) chartSymbolEl.textContent = symbol;
    
    const slider = document.getElementById('leverage-slider');
    if (slider) {
      slider.max = coin.leverage;
      updateLeverage(Math.min(state.selectedLeverage, coin.leverage));
    }
    
    loadChartData(symbol);
  }
  
  showNotification(`Selected ${symbol}`, 'info');
}

function filterCoinCategory(category) {
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === category);
  });
  
  document.querySelectorAll('.coin-item').forEach(item => {
    const coin = COINS.find(c => c.symbol === item.dataset.symbol);
    item.style.display = (category === 'all' || coin?.category === category) ? 'flex' : 'none';
  });
}

function searchCoins() {
  const query = document.getElementById('coin-search')?.value.toLowerCase() || '';
  
  document.querySelectorAll('.coin-item').forEach(item => {
    const symbol = item.dataset.symbol.toLowerCase();
    const name = item.querySelector('.coin-name-small')?.textContent.toLowerCase() || '';
    item.style.display = (symbol.includes(query) || name.includes(query)) ? 'flex' : 'none';
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET PRICE FEEDS
// ═══════════════════════════════════════════════════════════════════════════════
function startPriceFeeds() {
  connectSpotWebSocket();
  connectFuturesWebSocket();
}

function connectSpotWebSocket() {
  if (state.wsSpot) state.wsSpot.close();
  
  const streams = COINS.map(c => `${c.symbol.toLowerCase()}@ticker`).join('/');
  state.wsSpot = new WebSocket(`wss://stream.binance.com:9443/ws/${streams}`);
  
  state.wsSpot.onopen = () => {
    state.isSpotConnected = true;
    state.reconnectAttempts = 0;
  };
  
  state.wsSpot.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.c && data.s) updatePrice(data.s, parseFloat(data.c), parseFloat(data.P));
  };
  
  state.wsSpot.onclose = () => {
    state.isSpotConnected = false;
    attemptReconnect();
  };
}

function connectFuturesWebSocket() {
  if (state.wsFutures) state.wsFutures.close();
  
  const streams = COINS.map(c => `${c.symbol.toLowerCase()}@ticker`).join('/');
  state.wsFutures = new WebSocket(`wss://fstream.binance.com/ws/${streams}`);
  
  state.wsFutures.onopen = () => { state.isFuturesConnected = true; };
  
  state.wsFutures.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.c && data.s) state.futuresPrices[data.s] = parseFloat(data.c);
  };
}

function attemptReconnect() {
  if (state.reconnectAttempts >= state.maxReconnectAttempts) return;
  state.reconnectAttempts++;
  setTimeout(connectSpotWebSocket, 3000 * state.reconnectAttempts);
}

function updatePrice(symbol, price, change24h) {
  state.prices[symbol] = price;
  
  const priceEl = document.getElementById(`price-${symbol}`);
  const changeEl = document.getElementById(`change-${symbol}`);
  
  if (priceEl) {
    priceEl.textContent = '$' + price.toLocaleString('en-US', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: price > 1000 ? 2 : 4 
    });
  }
  
  if (changeEl) {
    changeEl.textContent = (change24h > 0 ? '+' : '') + change24h.toFixed(2) + '%';
    changeEl.className = 'coin-change-val ' + (change24h >= 0 ? 'positive' : 'negative');
  }
  
  if (symbol === state.currentCoin) {
    const priceBadge = document.getElementById('chart-price');
    const changeBadge = document.getElementById('chart-change');
    if (priceBadge) priceBadge.textContent = '$' + price.toLocaleString();
    if (changeBadge) {
      changeBadge.textContent = (change24h > 0 ? '+' : '') + change24h.toFixed(2) + '%';
      changeBadge.className = 'change-badge ' + (change24h >= 0 ? 'positive' : 'negative');
    }
  }
  
  if (!aiMemory.priceHistory[symbol]) aiMemory.priceHistory[symbol] = [];
  aiMemory.priceHistory[symbol].push({ price, time: Date.now() });
  if (aiMemory.priceHistory[symbol].length > 100) aiMemory.priceHistory[symbol].shift();
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHARTING
// ═══════════════════════════════════════════════════════════════════════════════
function initCharts() {
  initLightweightChart();
}

function initLightweightChart() {
  const container = document.getElementById('lightweight-chart');
  if (!container || typeof LightweightCharts === 'undefined') return;
  
  lwChart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight || 400,
    layout: { background: { color: '#1a1a2e' }, textColor: '#d1d4dc' },
    grid: { vertLines: { color: '#2a2a3e' }, horzLines: { color: '#2a2a3e' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#485c7b' },
    timeScale: { borderColor: '#485c7b', timeVisible: true, secondsVisible: false }
  });
  
  candleSeries = lwChart.addCandlestickSeries({
    upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
    wickUpColor: '#26a69a', wickDownColor: '#ef5350'
  });
  
  volumeSeries = lwChart.addHistogramSeries({
    color: '#26a69a', priceFormat: { type: 'volume' }, priceScaleId: '', scaleMargins: { top: 0.8, bottom: 0 }
  });
  
  loadChartData('BTCUSDT');
  
  lwChart.subscribeClick((param) => {
    if (!param.time || !param.point || !candleSeries) return;
    const price = candleSeries.coordinateToPrice(param.point.y);
    const limitInput = document.getElementById('limit-price');
    if (limitInput) limitInput.value = price.toFixed(2);
  });
}

async function loadChartData(symbol) {
  try {
    const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=500`);
    const data = await response.json();
    
    const candles = data.map(d => ({
      time: d[0] / 1000, open: parseFloat(d[1]), high: parseFloat(d[2]),
      low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5])
    }));
    
    if (candleSeries) {
      candleSeries.setData(candles);
      if (volumeSeries) {
        volumeSeries.setData(candles.map(c => ({
          time: c.time, value: c.volume, color: c.close > c.open ? '#26a69a' : '#ef5350'
        })));
      }
    }
    
    state.candles[symbol] = candles;
  } catch (error) {
    console.error('Failed to load chart data:', error);
  }
}

function switchChart(type) {
  document.querySelectorAll('.chart-container').forEach(c => c.classList.add('hidden'));
  document.querySelectorAll('.chart-btn').forEach(b => b.classList.remove('active'));
  
  const container = document.getElementById(`${type}-container`);
  const btn = event?.target;
  if (container) container.classList.remove('hidden');
  if (btn) btn.classList.add('active');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRADING
// ═══════════════════════════════════════════════════════════════════════════════
function setOrderSide(side) {
  state.orderSide = side;
  document.querySelectorAll('.order-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.side === side);
  });
  
  const btn = document.getElementById('place-order-btn');
  if (btn) {
    btn.textContent = `Place ${side.charAt(0).toUpperCase() + side.slice(1)} Order`;
    btn.className = side === 'long' ? 'btn-long' : 'btn-short';
  }
  
  updateOrderSummary();
}

function updateLeverage(value) {
  state.selectedLeverage = parseInt(value);
  const leverageVal = document.getElementById('leverage-val');
  if (leverageVal) leverageVal.textContent = value;
  updateOrderSummary();
}

function setAmount(percent) {
  const maxAmount = state.userCash * (percent / 100);
  const amountInput = document.getElementById('order-amount');
  if (amountInput) amountInput.value = maxAmount.toFixed(2);
  updateOrderSummary();
}

function updateOrderSummary() {
  const amount = parseFloat(document.getElementById('order-amount')?.value) || 0;
  const leverage = state.selectedLeverage;
  const margin = amount / leverage;
  
  const marginReq = document.getElementById('margin-required');
  const orderFee = document.getElementById('order-fee');
  
  if (marginReq) marginReq.textContent = '$' + margin.toFixed(2);
  if (orderFee) orderFee.textContent = '$' + (amount * 0.001).toFixed(2);
  
  const price = state.prices[state.currentCoin] || 0;
  if (price > 0) {
    const liqPrice = state.orderSide === 'long' 
      ? price * (1 - 0.9 / leverage)
      : price * (1 + 0.9 / leverage);
    const liqWarning = document.getElementById('liq-warning');
    const liqPriceEl = document.getElementById('liq-price');
    if (liqPriceEl) liqPriceEl.textContent = '$' + liqPrice.toFixed(2);
    if (liqWarning) liqWarning.style.display = leverage > 10 ? 'block' : 'none';
  }
}

async function placeOrder() {
  const amount = parseFloat(document.getElementById('order-amount')?.value);
  const orderType = document.getElementById('order-type')?.value || 'market';
  
  if (!amount || amount <= 0) { showNotification('Please enter a valid amount', 'error'); return; }
  if (amount > state.userCash) { showNotification('Insufficient funds', 'error'); return; }
  
  const price = orderType === 'market' 
    ? state.prices[state.currentCoin]
    : parseFloat(document.getElementById('limit-price')?.value);
    
  if (!price || price <= 0) { showNotification('Invalid price', 'error'); return; }
  
  const leverage = state.selectedLeverage;
  const margin = amount / leverage;
  const qty = amount / price;
  
  const position = {
    symbol: state.currentCoin, side: state.orderSide, entryPrice: price,
    qty: qty, margin: margin, leverage: leverage, openTime: Date.now(),
    liqPrice: state.orderSide === 'long' ? price * (1 - 0.9 / leverage) : price * (1 + 0.9 / leverage)
  };
  
  state.userCash -= margin;
  
  if (!state.userPositions[state.currentCoin]) state.userPositions[state.currentCoin] = [];
  state.userPositions[state.currentCoin].push(position);
  
  updateUserHoldings();
  
  state.userTradeLog.push({
    type: 'OPEN', symbol: state.currentCoin, side: state.orderSide,
    price: price, qty: qty, leverage: leverage, margin: margin, time: Date.now()
  });
  
  updatePositionsList();
  updateUI();
  playSound('trade');
  showNotification(`${state.orderSide.toUpperCase()} position opened at $${price.toFixed(2)}`, 'success');
}

function updateUserHoldings() {
  state.userHoldings = {};
  Object.entries(state.userPositions).forEach(([symbol, positions]) => {
    let totalQty = 0, totalMargin = 0, totalValue = 0;
    
    positions.forEach(pos => {
      totalQty += pos.qty;
      totalMargin += pos.margin;
      totalValue += pos.qty * pos.entryPrice;
    });
    
    if (totalQty > 0) {
      const currentPrice = state.prices[symbol] || 0;
      const avgEntry = totalValue / totalQty;
      const side = positions[0].side;
      const pnl = totalQty * (currentPrice - avgEntry) * (side === 'long' ? 1 : -1);
      
      state.userHoldings[symbol] = { qty: totalQty, margin: totalMargin, pnl, side, avgEntry };
    }
  });
}

function updatePositionsList() {
  const container = document.getElementById('positions-list');
  if (!container) return;
  
  let html = '', hasPositions = false;
  
  Object.entries(state.userPositions).forEach(([symbol, positions]) => {
    positions.forEach((pos, idx) => {
      hasPositions = true;
      const currentPrice = state.prices[symbol] || pos.entryPrice;
      const pnl = pos.side === 'long'
        ? (currentPrice - pos.entryPrice) * pos.qty
        : (pos.entryPrice - currentPrice) * pos.qty;
      const pnlPercent = (pnl / pos.margin) * 100;
      
      html += `
        <div class="position-item ${pos.side}">
          <div class="position-header">
            <span class="position-symbol">${symbol.replace('USDT', '')} ${pos.side.toUpperCase()}</span>
            <span class="position-leverage">${pos.leverage}x</span>
          </div>
          <div class="position-details">
            <div>Entry: $${pos.entryPrice.toFixed(2)}</div>
            <div>Current: $${currentPrice.toFixed(2)}</div>
            <div>Qty: ${pos.qty.toFixed(4)}</div>
            <div class="position-pnl ${pnl >= 0 ? 'positive' : 'negative'}">
              ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)
            </div>
          </div>
          <button onclick="closePosition('${symbol}', ${idx})" class="btn-ghost" style="width: 100%; margin-top: 8px;">
            Close Position
          </button>
        </div>
      `;
    });
  });
  
  container.innerHTML = hasPositions ? html : '<div class="empty-state">No open positions</div>';
}

function closePosition(symbol, idx) {
  const positions = state.userPositions[symbol];
  if (!positions || !positions[idx]) return;
  
  const pos = positions[idx];
  const currentPrice = state.prices[symbol] || pos.entryPrice;
  
  const pnl = pos.side === 'long'
    ? (currentPrice - pos.entryPrice) * pos.qty
    : (pos.entryPrice - currentPrice) * pos.qty;
  
  state.userCash += pos.margin + pnl;
  
  state.userTradeLog.push({
    type: 'CLOSE', symbol: symbol, side: pos.side,
    entryPrice: pos.entryPrice, exitPrice: currentPrice,
    qty: pos.qty, pnl: pnl, time: Date.now()
  });
  
  positions.splice(idx, 1);
  if (positions.length === 0) delete state.userPositions[symbol];
  
  updateUserHoldings();
  updatePositionsList();
  updateUI();
  
  if (pnl > 0) {
    state.userWins++;
    state.dailyPoints.user += Math.floor(pnl);
    state.lifetimePoints.user += Math.floor(pnl);
    showNotification(`Position closed! Profit: $${pnl.toFixed(2)}`, 'success');
    playSound('win');
    triggerCelebration();
  } else {
    state.userLosses++;
    showNotification(`Position closed! Loss: $${Math.abs(pnl).toFixed(2)}`, 'warning');
    playSound('loss');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIQUIDATION
// ═══════════════════════════════════════════════════════════════════════════════
function checkLiquidations() {
  Object.entries(state.userPositions).forEach(([symbol, positions]) => {
    const currentPrice = state.prices[symbol];
    if (!currentPrice) return;
    
    for (let i = positions.length - 1; i >= 0; i--) {
      const pos = positions[i];
      const isLiquidated = pos.side === 'long' ? currentPrice <= pos.liqPrice : currentPrice >= pos.liqPrice;
      
      if (isLiquidated) {
        positions.splice(i, 1);
        state.userTradeLog.push({
          type: 'LIQUIDATION', symbol: symbol, side: pos.side,
          liqPrice: currentPrice, qty: pos.qty, marginLost: pos.margin, time: Date.now()
        });
        state.userLosses++;
        showNotification(`💥 LIQUIDATED! ${symbol} ${pos.side.toUpperCase()} position`, 'error');
        playSound('liquidation');
        document.body.classList.add('shake');
        setTimeout(() => document.body.classList.remove('shake'), 500);
      }
    }
    if (positions.length === 0) delete state.userPositions[symbol];
  });
  
  Object.entries(state.aiPositions).forEach(([symbol, positions]) => {
    const currentPrice = state.prices[symbol];
    if (!currentPrice) return;
    
    for (let i = positions.length - 1; i >= 0; i--) {
      const pos = positions[i];
      const isLiquidated = pos.side === 'long' ? currentPrice <= pos.liqPrice : currentPrice >= pos.liqPrice;
      
      if (isLiquidated) {
        positions.splice(i, 1);
        state.aiLosses++;
        addToBattleLog('ai', `💥 LIQUIDATED on ${symbol}!`);
      }
    }
    if (positions.length === 0) delete state.aiPositions[symbol];
  });
  
  updateUserHoldings();
  updatePositionsList();
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI TRADING
// ═══════════════════════════════════════════════════════════════════════════════
async function checkAITrade() {
  if (!state.gameActive) return;
  
  const now = Date.now();
  if (now - aiMemory.lastTradeTime < AI_CONFIG.tradeInterval) return;
  
  const _netStreak = (state.aiWins || 0) - (state.aiLosses || 0);
  const canTradeNow = !walletAddress && aiMemory.mood !== 'REVENGE' && !(_netStreak < -5 && aiMemory.mood === 'NEUTRAL');
  
  if (!canTradeNow) return;
  
  const aiPositionCount = Object.values(state.aiPositions).reduce((sum, arr) => sum + arr.length, 0);
  if (aiPositionCount >= AI_CONFIG.maxOpenPositions) return;
  
  for (const coin of COINS) {
    const symbol = coin.symbol;
    const price = state.prices[symbol];
    if (!price) continue;
    
    const history = aiMemory.priceHistory[symbol] || [];
    if (history.length < 20) continue;
    
    const prices = history.map(h => h.price);
    const sma20 = calculateSMA(prices, 20);
    const rsi = calculateRSI(prices, 14);
    
    let signal = null, confidence = 0;
    const moodMultiplier = { 'AGGRESSIVE': 1.3, 'REVENGE': 1.5, 'FEAR': 0.7, 'NEUTRAL': 1.0, 'CONFIDENT': 1.2 }[aiMemory.mood] || 1.0;
    
    if (rsi < 30 && price > sma20) { signal = 'long'; confidence = (70 - rsi) / 100 * moodMultiplier; }
    else if (rsi > 70 && price < sma20) { signal = 'short'; confidence = (rsi - 70) / 100 * moodMultiplier; }
    
    if (signal && confidence >= AI_CONFIG.minConfidence) {
      const riskAmount = state.aiCash * AI_CONFIG.riskPerTrade * moodMultiplier;
      const leverage = Math.min(coin.leverage, Math.floor(5 + confidence * 10));
      const margin = riskAmount / leverage;
      const qty = riskAmount / price;
      
      if (margin > 10 && state.aiCash >= margin) {
        executeAITrade(symbol, signal, price, qty, margin, leverage, { rsi, sma20, mood: aiMemory.mood });
        aiMemory.lastTradeTime = now;
        break;
      }
    }
  }
}

function executeAITrade(symbol, side, price, qty, margin, leverage, meta) {
  state.aiCash -= margin;
  
  const position = {
    symbol: symbol, side: side, entryPrice: price, qty: qty,
    margin: margin, leverage: leverage, openTime: Date.now(),
    liqPrice: side === 'long' ? price * (1 - 0.9 / leverage) : price * (1 + 0.9 / leverage),
    meta: meta
  };
  
  if (!state.aiPositions[symbol]) state.aiPositions[symbol] = [];
  state.aiPositions[symbol].push(position);
  
  updateAIHoldings();
  
  state.aiTradeLog.push({
    type: 'OPEN', symbol: symbol, side: side, price: price,
    qty: qty, leverage: leverage, margin: margin, meta: meta, time: Date.now()
  });
  
  const emoji = side === 'long' ? '📈' : '📉';
  const moodEmoji = { 'AGGRESSIVE': '🔥', 'REVENGE': '⚡', 'FEAR': '😰', 'NEUTRAL': '😐', 'CONFIDENT': '😎' }[aiMemory.mood] || '';
  
  addToBattleLog('ai', `${moodEmoji} Opened ${side.toUpperCase()} ${symbol.replace('USDT', '')} at $${price.toFixed(2)} ${emoji} (${leverage}x)`);
  
  setTimeout(() => checkAIClosePosition(symbol), 5000);
}

function checkAIClosePosition(symbol) {
  const positions = state.aiPositions[symbol];
  if (!positions || positions.length === 0) return;
  
  const price = state.prices[symbol];
  if (!price) return;
  
  positions.forEach((pos, idx) => {
    const pnl = pos.side === 'long' ? (price - pos.entryPrice) * pos.qty : (pos.entryPrice - price) * pos.qty;
    const pnlPercent = (pnl / pos.margin) * 100;
    
    const shouldClose = pnlPercent >= AI_CONFIG.takeProfit * 100 || pnlPercent <= -AI_CONFIG.stopLoss * 100;
    
    if (shouldClose) {
      state.aiCash += pos.margin + pnl;
      positions.splice(idx, 1);
      
      state.aiTradeLog.push({ type: 'CLOSE', symbol: symbol, side: pos.side, pnl: pnl, time: Date.now() });
      
      if (pnl > 0) {
        state.aiWins++;
        state.dailyPoints.ai += Math.floor(pnl);
        aiMemory.mood = 'CONFIDENT';
        addToBattleLog('ai', `✅ Closed ${symbol.replace('USDT', '')} with $${pnl.toFixed(2)} profit!`);
      } else {
        state.aiLosses++;
        aiMemory.consecutiveLosses++;
        if (aiMemory.consecutiveLosses >= 3) { aiMemory.mood = 'REVENGE'; aiMemory.revengeTarget = symbol; }
        else if (aiMemory.consecutiveLosses >= 2) aiMemory.mood = 'AGGRESSIVE';
        else aiMemory.mood = 'FEAR';
        addToBattleLog('ai', `❌ Closed ${symbol.replace('USDT', '')} with $${Math.abs(pnl).toFixed(2)} loss`);
      }
    }
  });
  
  if (positions.length === 0) delete state.aiPositions[symbol];
  updateAIHoldings();
}

function updateAIHoldings() {
  state.aiHoldings = {};
  Object.entries(state.aiPositions).forEach(([symbol, positions]) => {
    let totalQty = 0, totalMargin = 0;
    positions.forEach(pos => { totalQty += pos.qty; totalMargin += pos.margin; });
    
    if (totalQty > 0) {
      const currentPrice = state.prices[symbol] || 0;
      const avgEntry = positions.reduce((sum, p) => sum + p.entryPrice * p.qty, 0) / totalQty;
      const side = positions[0].side;
      const pnl = totalQty * (currentPrice - avgEntry) * (side === 'long' ? 1 : -1);
      state.aiHoldings[symbol] = { qty: totalQty, margin: totalMargin, pnl, side };
    }
  });
}

function addToBattleLog(who, message) {
  const log = document.getElementById('battle-log');
  if (!log) return;
  
  const entry = document.createElement('div');
  entry.className = `log-entry ${who}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
  
  while (log.children.length > 50) log.removeChild(log.firstChild);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MULTIPLAYER
// ═══════════════════════════════════════════════════════════════════════════════
function showMultiplayerMenu() {
  const panel = document.getElementById('multiplayer-panel');
  if (panel) panel.classList.remove('hidden');
  loadActiveRooms();
}

function hideMultiplayerPanel() {
  const panel = document.getElementById('multiplayer-panel');
  if (panel) panel.classList.add('hidden');
}

function switchMpTab(tab) {
  document.querySelectorAll('.mp-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.mp-section').forEach(s => s.classList.add('hidden'));
  
  if (event && event.target) event.target.classList.add('active');
  const section = document.getElementById(`mp-${tab}`);
  if (section) section.classList.remove('hidden');
}

async function createMultiplayerRoom() {
  const startingCash = parseInt(document.getElementById('mp-starting-cash')?.value) || 1000;
  const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  
  mpState.roomId = roomId;
  mpState.isHost = true;
  state.userCash = startingCash;
  state.aiCash = startingCash;
  
  const roomCodeEl = document.getElementById('mp-room-code');
  const generatedCodeEl = document.getElementById('generated-room-code');
  if (generatedCodeEl) generatedCodeEl.textContent = roomId;
  if (roomCodeEl) roomCodeEl.classList.remove('hidden');
  
  showNotification(`Room created! Code: ${roomId}`, 'success');
}

async function joinMultiplayerRoom() {
  const roomId = document.getElementById('room-code-input')?.value.toUpperCase();
  if (!roomId || roomId.length !== 6) {
    showNotification('Please enter a valid 6-digit room code', 'error');
    return;
  }
  
  mpState.roomId = roomId;
  mpState.isHost = false;
  showNotification(`Joined room ${roomId}!`, 'success');
  hideMultiplayerPanel();
}

function loadActiveRooms() {
  const roomsList = document.getElementById('rooms-list');
  if (!roomsList) return;
  roomsList.innerHTML = '<div class="room-item"><div>No active rooms</div></div>';
}

function copyRoomCode() {
  const code = document.getElementById('generated-room-code')?.textContent;
  if (code) {
    navigator.clipboard.writeText(code);
    showNotification('Room code copied!', 'success');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WALLET
// ═══════════════════════════════════════════════════════════════════════════════
async function connectWallet() {
  if (typeof window.ethereum === 'undefined') {
    document.getElementById('metamask-modal')?.classList.remove('hidden');
    document.getElementById('modal-overlay')?.classList.remove('hidden');
    return;
  }
  
  try {
    _eth = window.ethereum;
    const accounts = await _eth.request({ method: 'eth_requestAccounts' });
    walletAddress = accounts[0];
    
    const walletAddrEl = document.getElementById('wallet-address');
    const walletBtn = document.getElementById('wallet-btn');
    const walletBadge = document.getElementById('wallet-badge');
    
    if (walletAddrEl) walletAddrEl.textContent = walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4);
    if (walletBtn) walletBtn.classList.add('hidden');
    if (walletBadge) walletBadge.classList.remove('hidden');
    
    if (!window._walletListening) {
      _eth.on('accountsChanged', (accounts) => { if (accounts.length === 0) disconnectWallet(); else walletAddress = accounts[0]; });
      _eth.on('chainChanged', () => window.location.reload());
      window._walletListening = true;
    }
    
    showNotification('Wallet connected!', 'success');
  } catch (error) {
    showNotification('Failed to connect wallet', 'error');
  }
}

function disconnectWallet() {
  walletAddress = null;
  const walletBtn = document.getElementById('wallet-btn');
  const walletBadge = document.getElementById('wallet-badge');
  if (walletBtn) walletBtn.classList.remove('hidden');
  if (walletBadge) walletBadge.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI UPDATES
// ═══════════════════════════════════════════════════════════════════════════════
function updateUI() {
  let userPortfolio = state.userCash;
  let aiPortfolio = state.aiCash;
  
  Object.entries(state.userHoldings).forEach(([symbol, holding]) => { userPortfolio += holding.margin + holding.pnl; });
  Object.entries(state.aiHoldings).forEach(([symbol, holding]) => { aiPortfolio += holding.margin + holding.pnl; });
  
  const userCashEl = document.getElementById('user-cash');
  const aiCashEl = document.getElementById('ai-cash');
  const userPortEl = document.getElementById('user-portfolio');
  const aiPortEl = document.getElementById('ai-portfolio');
  
  if (userCashEl) userCashEl.textContent = '$' + state.userCash.toLocaleString();
  if (aiCashEl) aiCashEl.textContent = '$' + state.aiCash.toLocaleString();
  if (userPortEl) userPortEl.textContent = '$' + Math.max(0, userPortfolio).toLocaleString();
  if (aiPortEl) aiPortEl.textContent = '$' + Math.max(0, aiPortfolio).toLocaleString();
  
  const startingValue = GAME_CONFIG.startingCash;
  const userHp = Math.min(100, Math.max(0, (userPortfolio / startingValue) * 100));
  const aiHp = Math.min(100, Math.max(0, (aiPortfolio / startingValue) * 100));
  
  const userHpBar = document.getElementById('user-hp');
  const aiHpBar = document.getElementById('ai-hp');
  const userHpText = document.getElementById('user-hp-text');
  const aiHpText = document.getElementById('ai-hp-text');
  
  if (userHpBar) userHpBar.style.width = userHp + '%';
  if (aiHpBar) aiHpBar.style.width = aiHp + '%';
  if (userHpText) userHpText.textContent = Math.floor(userPortfolio) + ' HP';
  if (aiHpText) aiHpText.textContent = Math.floor(aiPortfolio) + ' HP';
  
  const userPtsEl = document.getElementById('user-pts-display');
  const aiPtsEl = document.getElementById('ai-pts-display');
  const userLifeEl = document.getElementById('user-lifetime-display');
  const aiLifeEl = document.getElementById('ai-lifetime-display');
  
  if (userPtsEl) userPtsEl.textContent = (state.dailyPoints.user || 0).toLocaleString();
  if (aiPtsEl) aiPtsEl.textContent = (state.dailyPoints.ai || 0).toLocaleString();
  if (userLifeEl) userLifeEl.textContent = (state.lifetimePoints.user || 0).toLocaleString();
  if (aiLifeEl) aiLifeEl.textContent = (state.lifetimePoints.ai || 0).toLocaleString();
  
  updateTierBadges(userPortfolio, aiPortfolio);
  
  const dailyDateEl = document.getElementById('daily-date');
  if (dailyDateEl) dailyDateEl.textContent = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function updateTierBadges(userPortfolio, aiPortfolio) {
  const userTierEl = document.getElementById('user-tier');
  const aiTierEl = document.getElementById('ai-tier');
  
  const userTier = TIERS.slice().reverse().find(t => userPortfolio >= t.min) || TIERS[0];
  const aiTier = TIERS.slice().reverse().find(t => aiPortfolio >= t.min) || TIERS[0];
  
  if (userTierEl) { userTierEl.textContent = userTier.icon + ' ' + userTier.name; userTierEl.style.color = userTier.color; }
  if (aiTierEl) { aiTierEl.textContent = aiTier.icon + ' ' + aiTier.name; aiTierEl.style.color = aiTier.color; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════
function calculateSMA(prices, period) {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change; else losses -= change;
  }
  
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function escHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════
function showNotification(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${escHtml(message)}</span>`;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

function playSound(type) {
  const url = SOUNDS[type];
  if (!url) return;
  const audio = new Audio(url);
  audio.volume = 0.3;
  audio.play().catch(() => {});
}

// ═══════════════════════════════════════════════════════════════════════════════
// CELEBRATION
// ═══════════════════════════════════════════════════════════════════════════════
function triggerCelebration() {
  for (let i = 0; i < 10; i++) setTimeout(() => createFirecracker(), i * 200);
}

function createFirecracker() {
  const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
  const el = document.createElement('div');
  el.style.cssText = `position: fixed; width: 10px; height: 10px; background: ${colors[Math.floor(Math.random() * colors.length)]}; border-radius: 50%; pointer-events: none; z-index: 9999; left: ${Math.random() * 100}vw; top: ${Math.random() * 100}vh; animation: explode 1s ease-out forwards;`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SAVE/LOAD
// ═══════════════════════════════════════════════════════════════════════════════
function exportSave() {
  const saveData = {
    state: { ...state, userTradeLog: state.userTradeLog.slice(-1000), aiTradeLog: state.aiTradeLog.slice(-1000) },
    exportedAt: Date.now()
  };
  
  const blob = new Blob([JSON.stringify(saveData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `trading_battle_save_${Date.now()}.json`; a.click();
  URL.revokeObjectURL(url);
  showNotification('Game saved!', 'success');
}

function importSave() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const text = await file.text();
      const saveData = JSON.parse(text);
      if (saveData.state) {
        Object.assign(state, saveData.state);
        updateUserHoldings(); updateAIHoldings(); updatePositionsList(); updateUI();
        showNotification('Game loaded!', 'success');
      }
    } catch (error) { showNotification('Failed to load save file', 'error'); }
  };
  input.click();
}

function resetGame() {
  if (!confirm('Reset all progress? This cannot be undone!')) return;
  
  Object.assign(state, {
    userCash: GAME_CONFIG.startingCash, aiCash: GAME_CONFIG.aiStartingCash,
    userPositions: {}, aiPositions: {}, userHoldings: {}, aiHoldings: {},
    userTradeLog: [], aiTradeLog: [], userWins: 0, userLosses: 0, aiWins: 0, aiLosses: 0,
    dailyPoints: { ai: 0, user: 0 }
  });
  
  updateUI(); updatePositionsList();
  showNotification('Game reset!', 'info');
}

function loadGameData() { return Promise.resolve(); }

// ═══════════════════════════════════════════════════════════════════════════════
// DAILY RESET
// ═══════════════════════════════════════════════════════════════════════════════
function initDailyReset() {
  checkDailyReset();
  setInterval(checkDailyReset, 60000);
}

function checkDailyReset() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);
  const lastReset = state.lastReset ? new Date(state.lastReset) : null;
  
  if (istTime.getHours() >= 5 && (!lastReset || lastReset.getDate() !== istTime.getDate())) {
    performDailyReset();
  }
}

function performDailyReset() {
  state.lifetimePoints.ai += state.dailyPoints.ai;
  state.lifetimePoints.user += state.dailyPoints.user;
  state.dailyPoints = { ai: 0, user: 0 };
  state.lastReset = new Date().toISOString();
  showNotification('🌅 Daily reset complete!', 'info');
  updateUI();
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════════════════════════
function closeModal() {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  document.getElementById('modal-overlay')?.classList.add('hidden');
}

function showModal(content) {
  const modalContent = document.getElementById('modal-content');
  if (modalContent) modalContent.innerHTML = content;
  document.getElementById('generic-modal')?.classList.remove('hidden');
  document.getElementById('modal-overlay')?.classList.remove('hidden');
}

// ═══════════════════════════════════════════════════════════════════════════════
// OTHER
// ═══════════════════════════════════════════════════════════════════════════════
function emergencyAudit() {
  if (state.userCash < 0) state.userCash = 0;
  if (state.aiCash < 0) state.aiCash = 0;
  updateUserHoldings(); updateAIHoldings();
}

async function refreshCandlesIfStale() {
  const symbol = state.currentCoin;
  if (!symbol || !state.candles[symbol]) return;
  const lastCandle = state.candles[symbol][state.candles[symbol].length - 1];
  if (lastCandle.time * 1000 < Date.now() - 5 * 60 * 1000) await loadChartData(symbol);
}

// Add explosion animation
const style = document.createElement('style');
style.textContent = `@keyframes explode { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(20); opacity: 0; } } @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-10px); } 75% { transform: translateX(10px); } }`;
document.head.appendChild(style);

console.log('📊 AI Trading Battle v2.0 - All systems operational');