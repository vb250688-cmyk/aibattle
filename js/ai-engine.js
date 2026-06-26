// ════════════════════════════════════════════════════════════════
// AI-ENGINE.JS — AI Battle Trader · AI Trading Logic
// ════════════════════════════════════════════════════════════════

// ── GLOBAL AI STATE ────────────────────────────────────────────
const aiCooldown = {};
const aiTrailingStop = {};
const aiMemory = {};

// ── MARKET ANALYSIS ────────────────────────────────────────────

function analyzeMarket(candles, higherTFCandles = null) {
  if (!candles || candles.length < 30) return null;

  const closes = candles.map(c => c.c);
  const highs = candles.map(c => c.h);
  const lows = candles.map(c => c.l);
  const n = closes.length;
  const price = closes[n - 1];

  // ── EMA (9, 21, 50) ──
  function ema(arr, p) {
    const k = 2 / (p + 1);
    let e = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
    for (let i = p; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
    return e;
  }

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = closes.length >= 50 ? ema(closes, 50) : ema(closes, closes.length);

  // ── RSI(14) ──
  const rsiSlice = closes.slice(-15);
  let rg = 0, rl = 0;
  for (let i = 1; i < rsiSlice.length; i++) {
    const d = rsiSlice[i] - rsiSlice[i - 1];
    if (d > 0) rg += d;
    else rl += Math.abs(d);
  }
  rg /= 14;
  rl = (rl / 14) || 0.001;
  const rsi = 100 - (100 / (1 + rg / rl));

  // ── ADX(14) — trend strength ──
  const adxPeriod = 14;
  let adx = 20; // default neutral
  if (highs.length > adxPeriod) {
    const dmArr = [];
    for (let i = 1; i < Math.min(n, 50); i++) {
      const upMove = highs[i] - highs[i - 1];
      const downMove = lows[i - 1] - lows[i];
      const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
      const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;
      const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
      dmArr.push({ p: plusDM, m: minusDM, tr: tr });
    }
    let smP = dmArr.slice(0, adxPeriod).reduce((s, d) => s + d.p, 0);
    let smM = dmArr.slice(0, adxPeriod).reduce((s, d) => s + d.m, 0);
    let smTR = dmArr.slice(0, adxPeriod).reduce((s, d) => s + d.tr, 0);
    let dxSum = 0, count = 0;
    for (let i = adxPeriod; i < dmArr.length; i++) {
      smP = smP - smP / adxPeriod + dmArr[i].p;
      smM = smM - smM / adxPeriod + dmArr[i].m;
      smTR = smTR - smTR / adxPeriod + dmArr[i].tr;
      const pDI = (smTR > 0 ? smP / smTR : 0) * 100;
      const mDI = (smTR > 0 ? smM / smTR : 0) * 100;
      const dx = (pDI + mDI > 0 ? Math.abs(pDI - mDI) / (pDI + mDI) : 0) * 100;
      dxSum += dx;
      count++;
    }
    adx = count > 0 ? dxSum / count : 20;
  }

  // ── ATR(14) — volatility ──
  let atr = 0;
  for (let i = Math.max(1, n - 14); i < n; i++) {
    atr += Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  atr /= 14;
  const atrPct = (atr / price) * 100;

  // ── MARKET REGIME ──
  let regime = 'NEUTRAL';
  if (adx > 30) {
    if (ema9 > ema21 && ema21 > ema50 && rsi > 55) regime = 'STRONG_BULL';
    else if (ema9 < ema21 && ema21 < ema50 && rsi < 45) regime = 'STRONG_BEAR';
  } else if (adx > 20) {
    if (ema9 > ema21 && rsi > 50) regime = 'BULL';
    else if (ema9 < ema21 && rsi < 50) regime = 'BEAR';
  }

  // ── CHOP DETECTION (volatile, choppy) ──
  // If ATR is very low relative to history OR price bouncing inside range
  const avgATR = highs.slice(-20).reduce((s, _, i) => s + (highs[i] - lows[i]), 0) / 20 / price * 100;
  const isChop = atrPct < 0.5 || (adx < 20 && atrPct < avgATR * 0.7);

  return {
    price: price,
    ema9: ema9,
    ema21: ema21,
    ema50: ema50,
    rsi: rsi,
    adx: adx,
    atr: atr,
    atrPct: atrPct,
    regime: regime,
    isChop: isChop,
    isUptrendEMA: ema9 > ema21,
    isBullRSI: rsi > 55,
    isBearRSI: rsi < 45,
    trend: ema9 > ema21 ? 'bull' : ema9 < ema21 ? 'bear' : 'neutral',
  };
}

// ── AI TRADE EXECUTION ─────────────────────────────────────────

function executeAiTrade(action, amount, coinId, meta = {}) {
  const now = Date.now();
  const coin = COINS.find(c => c.id === coinId);
  if (!coin) return;

  const price = livePrices[coinId];
  if (!price) return;

  const time = new Date().toLocaleTimeString();
  const AI_LEV = LEVERAGE_CONFIG.aiLeverage || 5;

  // ── BUY (OPEN LONG) ──
  if (action === 'buy') {
    if (!amount) amount = Math.floor(Math.random() * 200 + 100);
    if (amount > state.aiCash) amount = state.aiCash;
    if (amount < 10) return;

    const fee = amount * 0.001;
    const margin = amount - fee;
    const notional = margin * AI_LEV;
    const qty = notional / price;

    state.aiCash -= amount;

    if (!state.aiHoldings[coinId]) {
      state.aiHoldings[coinId] = {
        qty: qty,
        avgCost: price,
        invested: margin,
        margin: margin,
        leverage: AI_LEV,
        notional: notional,
        entryTime: Date.now(),
      };
    } else {
      const h = state.aiHoldings[coinId];
      const totalQty = h.qty + qty;
      h.avgCost = (h.avgCost * h.qty + price * qty) / totalQty;
      h.qty = totalQty;
      h.margin += margin;
      h.invested = h.margin;
      h.leverage = AI_LEV;
      h.notional = totalQty * price;
    }

    state.aiTradeLog.unshift({
      type: 'buy',
      coin: coinId,
      qty: qty,
      price: price,
      amount: amount,
      fee: fee,
      pnl: null,
      time: time,
      leverage: AI_LEV,
      regime: meta.regime || null,
    });
  }

  // ── SELL (CLOSE LONG) ──
  else if (action === 'sell') {
    const h = state.aiHoldings[coinId];
    if (!h || h.qty <= 1e-8) return;

    const actualQty = h.qty;
    const exitFee = actualQty * price * 0.001;
    const grossPnl = actualQty * (price - h.avgCost);
    const pnl = grossPnl - exitFee;
    const margin = h.margin || h.invested || 0;

    // ★ KEY FIX: Return margin + pnl (NOT full notional)
    state.aiCash += margin + pnl;

    delete state.aiHoldings[coinId];

    if (pnl > 0) {
      state.aiWins++;
      addAiPoints(calcPts(pnl, margin));
    } else {
      state.aiLosses++;
    }

    state.aiTradeLog.unshift({
      type: 'sell',
      coin: coinId,
      qty: actualQty,
      price: price,
      pnl: pnl,
      fee: exitFee,
      time: time,
      leverage: h.leverage || AI_LEV,
      entryPrice: h.avgCost,
      exitReason: meta.exitReason || null,
    });

    if (aiTrailingStop[coinId]) delete aiTrailingStop[coinId];
  }

  // ── SHORT ──
  else if (action === 'short') {
    if (!amount) amount = Math.floor(Math.random() * 200 + 100);
    if (amount > state.aiCash) amount = state.aiCash;
    if (amount < 10) return;

    const fee = amount * 0.001;
    const margin = amount - fee;
    const notional = margin * AI_LEV;
    const qty = notional / price;

    state.aiCash -= amount;

    state.aiShorts[coinId] = {
      qty: qty,
      entryPrice: price,
      margin: margin,
      leverage: AI_LEV,
      notional: notional,
      entryTime: Date.now(),
    };

    state.aiTradeLog.unshift({
      type: 'short',
      coin: coinId,
      qty: qty,
      price: price,
      amount: amount,
      fee: fee,
      pnl: null,
      time: time,
      leverage: AI_LEV,
      regime: meta.regime || null,
    });
  }

  // ── CLOSE SHORT ──
  else if (action === 'close_short') {
    const sh = state.aiShorts[coinId];
    if (!sh) return;

    const fee = sh.qty * price * 0.001;
    const pnl = (sh.entryPrice - price) * sh.qty - fee;
    state.aiCash += sh.margin + pnl;

    delete state.aiShorts[coinId];

    if (pnl > 0) {
      state.aiWins++;
      addAiPoints(calcPts(pnl, sh.margin || 100));
    } else {
      state.aiLosses++;
    }

    state.aiTradeLog.unshift({
      type: 'short_closed',
      coin: coinId,
      qty: sh.qty,
      price: price,
      pnl: pnl,
      fee: fee,
      time: time,
      leverage: sh.leverage || AI_LEV,
      entryPrice: sh.entryPrice,
      exitReason: meta.exitReason || null,
    });

    if (aiTrailingStop[coinId]) delete aiTrailingStop[coinId];
  }

  if (state.aiTradeLog.length > 100) state.aiTradeLog.length = 100;
  saveState();
}

// ── MAIN AI LOOP ───────────────────────────────────────────────

async function aiTradingLoop() {
  const now = Date.now();

  for (const coin of COINS) {
    const data = candleData[`${coin.id}_${state.tf}`];
    if (!data || data.length < 30) continue;

    const analysis = analyzeMarket(data);
    if (!analysis) continue;

    const holding = state.aiHoldings[coin.id];
    const short = state.aiShorts[coin.id];

    // ── TP/SL CALCULATION (fee-aware) ──
    const MIN_TP = 0.55;
    const MIN_SL = 0.60;
    const tp = Math.max(MIN_TP, analysis.atrPct * (analysis.adx > 25 ? 1.4 : 1.0));
    const sl = Math.max(MIN_SL, analysis.atrPct * 0.55);

    // ── EXIT SHORTS ──
    if (short) {
      const pct = ((short.entryPrice - analysis.price) / short.entryPrice) * 100;
      const holdMs = now - (short.entryTime || now);

      // Trailing stop
      if (pct >= tp * 0.6) {
        const trail = aiTrailingStop[coin.id];
        const newTrail = pct - tp * 0.25;
        if (!trail || newTrail > trail) aiTrailingStop[coin.id] = newTrail;
        if (pct < (aiTrailingStop[coin.id] || 0)) {
          executeAiTrade('close_short', null, coin.id, { exitReason: 'trailing_stop' });
          aiCooldown[coin.id] = now;
          continue;
        }
      }

      const exitShort = pct >= tp || pct <= -sl || holdMs > 480000; // 8 min
      if (exitShort) {
        executeAiTrade('close_short', null, coin.id, { exitReason: 'tp_sl' });
        aiCooldown[coin.id] = now;
        continue;
      }
    }

    // ── EXIT LONGS ──
    if (holding) {
      const pct = ((analysis.price - holding.avgCost) / holding.avgCost) * 100;
      const holdMs = now - (holding.entryTime || now);

      if (pct >= tp * 0.6) {
        const trail = aiTrailingStop[coin.id];
        const newTrail = pct - tp * 0.25;
        if (!trail || newTrail > trail) aiTrailingStop[coin.id] = newTrail;
        if (pct < (aiTrailingStop[coin.id] || 0)) {
          executeAiTrade('sell', null, coin.id, { exitReason: 'trailing_stop' });
          aiCooldown[coin.id] = now;
          continue;
        }
      }

      const exitLong = pct >= tp || pct <= -sl || holdMs > 480000;
      if (exitLong) {
        executeAiTrade('sell', null, coin.id, { exitReason: 'tp_sl' });
        aiCooldown[coin.id] = now;
        continue;
      }
    }

    // ── SKIP IF ON COOLDOWN ──
    const cooldown = analysis.isChop ? AI_CONFIG.cooldownChop : AI_CONFIG.cooldownNormal;
    if (aiCooldown[coin.id] && now - aiCooldown[coin.id] < cooldown) continue;

    // ── SKIP CHOP MARKETS ──
    if (analysis.isChop) {
      // Reduce AI overtrading in sideways markets
      continue;
    }

    // ── ENTRY SIGNALS ──
    const hasRoomLong = Object.keys(state.aiHoldings).length < AI_CONFIG.maxOpenPositions;
    const hasRoomShort = Object.keys(state.aiShorts).length < AI_CONFIG.maxOpenPositions;

    // BUY signals
    if (
      hasRoomLong &&
      !holding &&
      !short &&
      analysis.regime !== 'STRONG_BEAR' &&
      analysis.regime !== 'BEAR' &&
      analysis.rsi < 70 &&
      analysis.ema9 > analysis.ema21 &&
      analysis.atrPct >= AI_CONFIG.minAtrPctForEntry
    ) {
      executeAiTrade('buy', Math.floor(Math.random() * 150 + 100), coin.id, { regime: analysis.regime });
      aiCooldown[coin.id] = now;
    }

    // SHORT signals
    if (
      hasRoomShort &&
      !holding &&
      !short &&
      analysis.regime !== 'STRONG_BULL' &&
      analysis.regime !== 'BULL' &&
      analysis.rsi > 30 &&
      analysis.ema9 < analysis.ema21 &&
      analysis.atrPct >= AI_CONFIG.minAtrPctForEntry
    ) {
      executeAiTrade('short', Math.floor(Math.random() * 150 + 100), coin.id, { regime: analysis.regime });
      aiCooldown[coin.id] = now;
    }
  }

  checkLiquidations();
}

// ── EXPORT ──────────────────────────────────────────────────
window.analyzeMarket = analyzeMarket;
window.executeAiTrade = executeAiTrade;
window.aiTradingLoop = aiTradingLoop;
