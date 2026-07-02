// ═══════════════════════════════════════════════════════════════════
// AI BATTLE TRADER — Background AI Trading Tick (Supabase Edge Function)
// ═══════════════════════════════════════════════════════════════════
// Runs on a cron schedule (every 1-2 min) via pg_cron + pg_net.
// For every wallet row in battle_states, this:
//   1. Fetches fresh 1m candles from Binance for BTC/ETH/SOL/BNB
//   2. Calculates indicators (RSI/MACD/ADX/EMA/StochRSI)
//   3. Checks exits on open AI positions (TP/SL/time-stop/regime-flip)
//   4. Checks new entries (same gating logic as the frontend: momentum
//      gate, CHOP/ADX filter, mood/streak pause, fee-aware TP/SL)
//   5. Writes the updated row back to Supabase
//
// This makes the AI a true 24/7 trader — it keeps working even if
// every browser tab and phone is closed.
//
// NOTE: ANTHROPIC is a simulated (non-real) coin generated client-side
// only, so it is intentionally skipped here — the AI only trades real
// Binance pairs (BTC, ETH, SOL, BNB) in the background.
// ═══════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPA_URL   = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SERVICE_ROLE_KEY')!; // service role — bypasses RLS, needed for cron writes
const SUPA_TABLE = 'battle_states';

const COINS = ['BTC', 'ETH', 'SOL', 'BNB'];
const SYMBOL_MAP: Record<string, string> = { BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT', BNB: 'BNBUSDT' };

// ── EMA helper ──
function ema(arr: number[], p: number): number {
  const k = 2 / (p + 1);
  let e = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
  return e;
}

interface Candle { o: number; h: number; l: number; c: number; }

// ── Fetch 1m klines from Binance REST (last 60 candles) ──
async function fetchCandles(symbol: string): Promise<Candle[] | null> {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=60`);
    if (!r.ok) return null;
    const raw = await r.json();
    return raw.map((k: any[]) => ({ o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
  } catch { return null; }
}

// ── Port of calcAdvancedIndicators (streamlined — core signals only) ──
function calcIndicators(candles: Candle[]) {
  if (!candles || candles.length < 30) return null;
  const closes = candles.map(c => c.c);
  const highs = candles.map(c => c.h);
  const lows = candles.map(c => c.l);
  const n = closes.length;
  const price = closes[n - 1];

  const ema9 = ema(closes, 9), ema21 = ema(closes, 21);
  const ema50 = closes.length >= 50 ? ema(closes, 50) : ema(closes, closes.length);

  // RSI(14) Wilder
  const rsiSlice = closes.slice(-15);
  let rg = 0, rl = 0;
  for (let i = 1; i < rsiSlice.length; i++) { const d = rsiSlice[i] - rsiSlice[i - 1]; if (d > 0) rg += d; else rl += Math.abs(d); }
  rg /= 14; rl = (rl / 14) || 0.001;
  const rsi = 100 - (100 / (1 + rg / rl));

  // MACD
  const macdLine = ema(closes, 12) - ema(closes, 26);
  const sigLine = ema(closes.slice(-9).map((_, i) => ema(closes.slice(0, n - 8 + i), 12) - ema(closes.slice(0, n - 8 + i), 26)), 9);
  const macdCross = macdLine > sigLine;

  // ADX(14) Wilder
  const adxPeriod = 14;
  const dmArr: { p: number; m: number; tr: number }[] = [];
  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1], downMove = lows[i - 1] - lows[i];
    const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    dmArr.push({ p: plusDM, m: minusDM, tr });
  }
  const seed = dmArr.slice(0, adxPeriod);
  let smP = seed.reduce((s, d) => s + d.p, 0), smM = seed.reduce((s, d) => s + d.m, 0), smTR = seed.reduce((s, d) => s + d.tr, 0);
  const dxArr: number[] = [];
  for (let i = adxPeriod; i < dmArr.length; i++) {
    smP = smP - smP / adxPeriod + dmArr[i].p;
    smM = smM - smM / adxPeriod + dmArr[i].m;
    smTR = smTR - smTR / adxPeriod + dmArr[i].tr;
    const pDI = (smTR > 0 ? smP / smTR : 0) * 100, mDI = (smTR > 0 ? smM / smTR : 0) * 100;
    dxArr.push((pDI + mDI > 0 ? Math.abs(pDI - mDI) / (pDI + mDI) : 0) * 100);
  }
  let adx = dxArr.length > 0 ? dxArr.slice(0, Math.min(adxPeriod, dxArr.length)).reduce((s, d) => s + d, 0) / Math.min(adxPeriod, dxArr.length) : 20;
  for (let i = adxPeriod; i < dxArr.length; i++) adx = (adx * (adxPeriod - 1) + dxArr[i]) / adxPeriod;
  const trendingMarket = adx > 22;

  // ATR
  let atr = 0;
  for (let i = Math.max(1, n - 14); i < n; i++) atr += Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  atr /= 14;
  const atrPct = (atr / price) * 100;

  // StochRSI
  const rsiArr: number[] = [];
  for (let i = n - 14; i < n; i++) {
    const sl = closes.slice(Math.max(0, i - 13), i + 1);
    let g = 0, l = 0;
    for (let j = 1; j < sl.length; j++) { const d = sl[j] - sl[j - 1]; if (d > 0) g += d; else l += Math.abs(d); }
    g /= 14; l = (l / 14) || 0.001;
    rsiArr.push(100 - (100 / (1 + g / l)));
  }
  const rsiMax = Math.max(...rsiArr), rsiMin = Math.min(...rsiArr);
  const stochRSI = (rsi - rsiMin) / (rsiMax - rsiMin + 0.001) * 100;

  // Patterns
  const prev = candles[n - 2], last = candles[n - 1];
  const lastBody = Math.abs(last.c - last.o), prevBody = Math.abs(prev.c - prev.o);
  const bullEngulf = last.c > last.o && last.c > prev.o && last.o < prev.c && lastBody > prevBody * 1.1;
  const lowerWick = Math.min(last.o, last.c) - last.l, upperWick = last.h - Math.max(last.o, last.c);
  const hammer = lowerWick > lastBody * 2 && upperWick < lastBody * 0.5 && last.c > last.o;

  const bullTrend = price > ema9 && ema9 > ema21 && ema21 > ema50;
  const bearTrend = price < ema9 && ema9 < ema21 && ema21 < ema50;
  const weakBull = price > ema21 && ema9 > ema21;
  const weakBear = price < ema21 && ema9 < ema21;
  const roc10 = n >= 11 ? ((price - closes[n - 11]) / closes[n - 11]) * 100 : 0;
  const stochOversold = stochRSI < 20, stochOverbought = stochRSI > 80;

  let bull = 0;
  if (bullTrend) bull += 4; else if (weakBull) bull += 2;
  if (trendingMarket) bull += 2;
  if (rsi < 35) bull += 2; else if (rsi < 45) bull += 1;
  if (macdCross) bull += 2;
  if (stochOversold) bull += 2;
  if (bullEngulf) bull += 2; if (hammer) bull += 2;
  if (roc10 > 0.3) bull += 1;

  let bear = 0;
  if (bearTrend) bear += 4; else if (weakBear) bear += 2;
  if (trendingMarket) bear += 2;
  if (rsi > 65) bear += 2; else if (rsi > 55) bear += 1;
  if (!macdCross) bear += 2;
  if (stochOverbought) bear += 2;
  if (roc10 < -0.3) bear += 1;

  let trend_signal = 'NEUTRAL';
  if (bull >= 8) trend_signal = 'STRONG_BUY';
  else if (bull >= 5) trend_signal = 'BUY';
  else if (bear >= 8) trend_signal = 'STRONG_SELL';
  else if (bear >= 5) trend_signal = 'SELL';

  return { rsi, adx, trendingMarket, atrPct, stochOversold, stochOverbought, bullTrend, bearTrend, bullEngulf, hammer, roc10, trend_signal, bull, bear, price };
}

// ── Regime classification (mirrors frontend getMarketRegime, candle-based) ──
function classifyRegime(ind: any) {
  let regime = 'CHOP';
  if (ind.bull >= 8) regime = 'STRONG_BULL';
  else if (ind.bull >= 5) regime = 'BULL';
  else if (ind.bear >= 8) regime = 'STRONG_BEAR';
  else if (ind.bear >= 5) regime = 'BEAR';
  return { regime, isChop: regime === 'CHOP' };
}

// ── Main per-wallet tick ──
async function processWallet(supabase: any, row: any, priceData: Record<string, { ind: any; price: number }>) {
  const positions = row.positions || {};
  const aiHoldings: Record<string, any> = positions.aiHoldings || {};
  const aiShorts: Record<string, any> = positions.aiShorts || {};
  const unlockedTiers: number[] = positions.unlockedTiers || [];
  const aiMemoryState = positions.aiMemory || { mood: 'NEUTRAL', winRateLong: 0.5, winRateShort: 0.5 };
  const aiTradeLog: any[] = (row.trade_log?.ai || []).slice();

  let aiCash = row.ai_cash ?? 1000;
  let aiWins = row.ai_wins || 0;
  let aiLosses = positions.aiLosses || 0;
  const now = Date.now();
  const FEE_RT = 0.20, MIN_TP = 0.75, MIN_SL = 0.50;

  const netStreak = aiWins - aiLosses;
  const isTierUnlocked = (id: number) => unlockedTiers.includes(id);
  const canTradeNow = aiMemoryState.mood !== 'REVENGE' && !(netStreak < -5 && aiMemoryState.mood === 'NEUTRAL');

  let changed = false;

  for (const coin of COINS) {
    const pd = priceData[coin];
    if (!pd || !pd.ind) continue;
    const { ind, price } = pd;
    const mkt = classifyRegime(ind);
    const hardBlockShort = mkt.regime === 'STRONG_BULL' || mkt.regime === 'BULL';
    const hardBlockLong = mkt.regime === 'STRONG_BEAR';

    const atrTP = Math.max(MIN_TP, ind.atrPct * (ind.adx > 30 ? 1.6 : 1.1));
    const atrSL = Math.max(MIN_SL, ind.atrPct * 0.55);
    const tp = Math.max(atrTP, atrSL * 2.0);
    const sl = atrSL;

    // ── EXIT: SHORT ──
    const short = aiShorts[coin];
    if (short && short.qty > 1e-8) {
      const pct = (short.entryPrice - price) / short.entryPrice * 100;
      const holdSec = (now - (short.entryTs || now)) / 1000;
      const exitShort =
        pct >= tp || pct <= -sl ||
        (hardBlockShort && pct > -(FEE_RT * 0.3)) ||
        (ind.trend_signal === 'STRONG_BUY' && pct > 0) ||
        (holdSec > 360 && pct < -(FEE_RT * 0.5)) ||
        (holdSec > 720 && pct <= 0);
      if (exitShort) {
        const margin = short.margin || 0;
        const fee = margin * 0.001;
        const pnl = short.qty * (short.entryPrice - price) - fee;
        aiCash += margin + pnl;
        if (pnl > 0) { aiWins++; } else { aiLosses++; }
        aiTradeLog.unshift({ type: 'short_closed', coin, qty: short.qty, price, pnl, fee, time: new Date().toLocaleTimeString(), leverage: short.leverage || 5, margin, entryPrice: short.entryPrice, regime: mkt.regime });
        delete aiShorts[coin];
        changed = true;
        continue;
      }
    }

    // ── EXIT: LONG ──
    const holding = aiHoldings[coin];
    if (holding && holding.qty > 1e-8) {
      const pct = (price - holding.avgCost) / holding.avgCost * 100;
      const holdSec = (now - (holding.entryTs || now)) / 1000;
      const exitLong =
        pct >= tp || pct <= -sl ||
        (hardBlockLong && pct > -(FEE_RT * 0.5)) ||
        (ind.trend_signal === 'STRONG_SELL' && pct > 0) ||
        (holdSec > 360 && pct < -(FEE_RT * 0.5)) ||
        (holdSec > 720 && pct <= 0);
      if (exitLong) {
        const margin = holding.margin || 0;
        const fee = margin * 0.001;
        const pnl = holding.qty * (price - holding.avgCost) - fee;
        aiCash += margin + pnl;
        if (pnl > 0) { aiWins++; } else { aiLosses++; }
        aiTradeLog.unshift({ type: 'sell', coin, qty: holding.qty, price, pnl, fee, time: new Date().toLocaleTimeString(), leverage: holding.leverage || 5, margin, entryPrice: holding.avgCost, regime: mkt.regime });
        delete aiHoldings[coin];
        changed = true;
        continue;
      }
    }

    // Skip new entries if already holding this coin either direction
    if ((holding && holding.qty > 1e-8) || (short && short.qty > 1e-8)) continue;
    if (!canTradeNow) continue;

    // Block trading in flat/dead chop
    if (mkt.isChop && ind.adx < 16) continue;

    // ── ENTRY: SHORT ──
    if (!hardBlockShort) {
      const canShort = (mkt.regime === 'BEAR' || mkt.regime === 'STRONG_BEAR' || mkt.isChop);
      if (canShort && aiMemoryState.winRateShort >= 0.25) {
        const entryThreshBase = mkt.isChop ? 13 : 11;
        const shortThresh = ind.trendingMarket ? Math.max(entryThreshBase + 3, 10) : Math.max(entryThreshBase + 5, 15);
        const shortMomOk = ind.roc10 <= 0.15;
        const shortOk = ind.bear >= shortThresh && (ind.trend_signal === 'STRONG_SELL' || ind.trend_signal === 'SELL' || ind.bear >= shortThresh + 4) && ind.rsi > 20 && shortMomOk;
        if (shortOk) {
          const lev = mkt.regime === 'STRONG_BEAR' ? 8 : mkt.regime === 'BEAR' ? 6 : 5;
          const margin = Math.max(150, Math.min(420, aiCash * 0.58));
          const qty = (margin * lev) / price;
          aiShorts[coin] = { qty, entryPrice: price, leverage: lev, margin, entryTs: now };
          aiCash -= margin;
          aiTradeLog.unshift({ type: 'short', coin, qty, price, amount: margin, fee: margin * 0.001, pnl: null, time: new Date().toLocaleTimeString(), leverage: lev, regime: mkt.regime });
          changed = true;
          continue;
        }
      }
    }

    // ── ENTRY: LONG ──
    if (!hardBlockLong) {
      const canLong = (mkt.regime === 'BULL' || mkt.regime === 'STRONG_BULL' || mkt.isChop) && !(mkt.isChop && ind.adx < 16);
      if (canLong) {
        const entryThreshBase = mkt.isChop ? 13 : 11;
        const pullbackOk = mkt.regime === 'STRONG_BULL' ? (ind.rsi < 76 || ind.stochOversold || ind.bullEngulf || ind.hammer) : true;
        const longMomOk = ind.roc10 >= -0.15;
        const longOk = ind.bull >= entryThreshBase && (ind.trend_signal === 'STRONG_BUY' || ind.trend_signal === 'BUY' || ind.bull >= entryThreshBase + 5) && pullbackOk && ind.rsi > 5 && ind.rsi < 86 && longMomOk;
        if (longOk && aiMemoryState.winRateLong >= 0.25) {
          const lev = mkt.regime === 'STRONG_BULL' ? 8 : mkt.regime === 'BULL' ? 6 : 5;
          const margin = Math.max(150, Math.min(420, aiCash * 0.68));
          const qty = (margin * lev) / price;
          aiHoldings[coin] = { qty, avgCost: price, leverage: lev, margin, entryTs: now };
          aiCash -= margin;
          aiTradeLog.unshift({ type: 'buy', coin, qty, price, amount: margin, fee: margin * 0.001, pnl: null, time: new Date().toLocaleTimeString(), leverage: lev, regime: mkt.regime });
          changed = true;
        }
      }
    }
  }

  if (!changed) return; // nothing to write — save a DB call

  // ── Update mood based on recent trade log ──
  const closedLog = aiTradeLog.filter(t => t.pnl != null);
  const recent5 = closedLog.slice(0, 5);
  const recentLoss = recent5.filter(t => t.pnl < 0).length;
  const recentWins = recent5.filter(t => t.pnl > 0).length;
  const newNetStreak = aiWins - aiLosses;
  const longs = closedLog.filter(t => t.type === 'sell');
  const shorts = closedLog.filter(t => t.type === 'short_closed');
  const winRateLong = longs.length ? longs.filter(t => t.pnl > 0).length / longs.length : 0.5;
  const winRateShort = shorts.length ? shorts.filter(t => t.pnl > 0).length / shorts.length : 0.5;

  let mood = 'NEUTRAL';
  if (newNetStreak <= -6) mood = 'REVENGE';
  else if (recentWins >= 4) mood = 'CONFIDENT';
  else if (recentLoss >= 3) mood = 'REVENGE';
  else if (winRateLong < 0.35 && winRateShort < 0.35) mood = 'CAUTIOUS';

  const newPositions = { ...positions, aiHoldings, aiShorts, aiLosses, aiMemory: { mood, winRateLong, winRateShort } };

  await supabase.from(SUPA_TABLE).update({
    ai_cash: aiCash,
    ai_wins: aiWins,
    positions: newPositions,
    trade_log: { user: row.trade_log?.user || [], ai: aiTradeLog.slice(0, 100) },
    updated_at: new Date().toISOString(),
  }).eq('wallet_address', row.wallet_address);
}

Deno.serve(async (_req) => {
  const supabase = createClient(SUPA_URL, SUPA_KEY);

  // Fetch fresh candles + indicators once, reused across all wallets this tick
  const priceData: Record<string, { ind: any; price: number }> = {};
  for (const coin of COINS) {
    const candles = await fetchCandles(SYMBOL_MAP[coin]);
    const ind = candles ? calcIndicators(candles) : null;
    if (ind) priceData[coin] = { ind, price: ind.price };
  }

  const { data: rows, error } = await supabase.from(SUPA_TABLE).select('*');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let processed = 0;
  for (const row of rows || []) {
    try {
      await processWallet(supabase, row, priceData);
      processed++;
    } catch (e) {
      console.error(`Error processing wallet ${row.wallet_address}:`, e);
    }
  }

  return new Response(JSON.stringify({ ok: true, walletsProcessed: processed, coinsChecked: Object.keys(priceData) }), {
    headers: { 'Content-Type': 'application/json' },
  });
});