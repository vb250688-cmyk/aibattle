// ════════════════════════════════════════════════════════════════
// PORTFOLIO-CALC.JS — AI Battle Trader · Portfolio Value Logic
// ════════════════════════════════════════════════════════════════

/**
 * ★ THE KEY FIX ★
 * Old bug: total = free_cash + (qty * price) for all positions
 *          This is NOTIONAL and multiplies leverage! Wrong!
 * 
 * Correct: For EACH position:
 *   equity = margin_committed + unrealized_pnl
 *   total = free_cash + sum(equity per position)
 * 
 * Example: $100 margin, 10x leverage, BTC goes +1%
 * - Notional = $100 × 10 = $1000 position
 * - Unrealized PnL = $1000 × 1% = +$10
 * - Equity = $100 + $10 = $110 ✅ (not $1100 ❌)
 */

// ── USER PORTFOLIO ──────────────────────────────────────────
function calcUserPortfolio() {
  let openEquity = 0;
  let totalUnrealizedPnl = 0;

  Object.entries(state.userPositions || {}).forEach(([coinId, position]) => {
    if (!position || position.qty < 1e-8) return;

    const currentPrice = livePrices[coinId] || position.avgCost || position.entryPrice || 0;
    const margin = position.margin || position.invested || 0;
    const leverage = position.leverage || 1;

    // Calculate unrealized P&L
    let unrealizedPnl = 0;
    if (position.side === 'long') {
      unrealizedPnl = position.qty * (currentPrice - position.avgCost);
    } else if (position.side === 'short') {
      unrealizedPnl = position.qty * (position.entryPrice - currentPrice);
    }

    // Position equity = margin + unrealized P&L
    const positionEquity = margin + unrealizedPnl;
    openEquity += positionEquity;
    totalUnrealizedPnl += unrealizedPnl;
  });

  return {
    freeCash: state.userCash,
    openEquity: openEquity,
    totalPortfolio: state.userCash + openEquity,
    totalUnrealizedPnl: totalUnrealizedPnl,
    dailyPnl: (state.userCash + openEquity) - GAME_CONFIG.startingCash,
  };
}

// ── AI PORTFOLIO ────────────────────────────────────────────
function calcAiPortfolio() {
  let openEquity = 0;
  let totalUnrealizedPnl = 0;

  // Long positions
  Object.entries(state.aiHoldings || {}).forEach(([coinId, holding]) => {
    if (!holding || holding.qty < 1e-8) return;

    const currentPrice = livePrices[coinId] || holding.avgCost || 0;
    const margin = holding.margin || holding.invested || 0;

    const unrealizedPnl = holding.qty * (currentPrice - holding.avgCost);
    const positionEquity = margin + unrealizedPnl;

    openEquity += positionEquity;
    totalUnrealizedPnl += unrealizedPnl;
  });

  // Short positions
  Object.entries(state.aiShorts || {}).forEach(([coinId, short]) => {
    if (!short || short.qty < 1e-8) return;

    const currentPrice = livePrices[coinId] || short.entryPrice || 0;
    const margin = short.margin || 0;

    const unrealizedPnl = short.qty * (short.entryPrice - currentPrice);
    const positionEquity = margin + unrealizedPnl;

    openEquity += positionEquity;
    totalUnrealizedPnl += unrealizedPnl;
  });

  return {
    freeCash: state.aiCash,
    openEquity: openEquity,
    totalPortfolio: state.aiCash + openEquity,
    totalUnrealizedPnl: totalUnrealizedPnl,
    dailyPnl: (state.aiCash + openEquity) - GAME_CONFIG.startingCash,
  };
}

// ── POSITION DETAILS ────────────────────────────────────────

function getPositionPnL(player = 'user', coinId) {
  const pos = player === 'user'
    ? state.userPositions[coinId]
    : (state.aiHoldings[coinId] || state.aiShorts[coinId]);

  if (!pos || pos.qty < 1e-8) return null;

  const currentPrice = livePrices[coinId] || pos.avgCost || pos.entryPrice || 0;
  const margin = pos.margin || pos.invested || 0;

  let unrealizedPnl = 0;
  if (pos.side === 'long') {
    unrealizedPnl = pos.qty * (currentPrice - pos.avgCost);
  } else {
    unrealizedPnl = pos.qty * (pos.entryPrice - currentPrice);
  }

  const pnlPct = margin > 0 ? (unrealizedPnl / margin) * 100 : 0;
  const notional = pos.qty * currentPrice;

  return {
    unrealizedPnl: unrealizedPnl,
    pnlPercent: pnlPct,
    margin: margin,
    notional: notional,
    leverage: pos.leverage || 1,
    qty: pos.qty,
    entryPrice: pos.side === 'long' ? pos.avgCost : pos.entryPrice,
    currentPrice: currentPrice,
  };
}

// ── LIQUIDATION CHECK ───────────────────────────────────────

function checkLiquidations() {
  const threshold = LEVERAGE_CONFIG.liquidationThreshold; // 0.90 = 90% loss

  // User positions
  Object.entries(state.userPositions || {}).forEach(([coinId, position]) => {
    if (!position || position.qty < 1e-8) return;

    const currentPrice = livePrices[coinId];
    if (!currentPrice) return;

    const margin = position.margin || position.invested || 0;
    const unrealizedPnl = position.side === 'long'
      ? position.qty * (currentPrice - position.avgCost)
      : position.qty * (position.entryPrice - currentPrice);

    // Liquidation: loss >= 90% of margin
    if (unrealizedPnl <= -margin * threshold) {
      const remnant = Math.max(0, margin + unrealizedPnl);
      state.userCash += remnant;
      state.userLosses++;
      state.userTradeLog.unshift({
        type: 'liquidated',
        coin: coinId,
        qty: position.qty,
        price: currentPrice,
        pnl: -(margin - remnant),
        time: new Date().toLocaleTimeString(),
      });
      delete state.userPositions[coinId];
      notify(`⚡ LIQUIDATED! ${coinId} ${position.leverage}x`, 'loss');
      screenFlash('#ff3355');
      saveState();
    }
  });

  // AI positions
  Object.entries(state.aiHoldings || {}).forEach(([coinId, holding]) => {
    if (!holding || holding.qty < 1e-8) return;

    const currentPrice = livePrices[coinId];
    if (!currentPrice) return;

    const margin = holding.margin || holding.invested || 0;
    const unrealizedPnl = holding.qty * (currentPrice - holding.avgCost);

    if (unrealizedPnl <= -margin * threshold) {
      const remnant = Math.max(0, margin + unrealizedPnl);
      state.aiCash += remnant;
      state.aiLosses++;
      state.aiTradeLog.unshift({
        type: 'liquidated',
        coin: coinId,
        qty: holding.qty,
        price: currentPrice,
        pnl: -(margin - remnant),
        time: new Date().toLocaleTimeString(),
      });
      delete state.aiHoldings[coinId];
    }
  });

  Object.entries(state.aiShorts || {}).forEach(([coinId, short]) => {
    if (!short || short.qty < 1e-8) return;

    const currentPrice = livePrices[coinId];
    if (!currentPrice) return;

    const margin = short.margin || 0;
    const unrealizedPnl = short.qty * (short.entryPrice - currentPrice);

    if (unrealizedPnl <= -margin * threshold) {
      const remnant = Math.max(0, margin + unrealizedPnl);
      state.aiCash += remnant;
      state.aiLosses++;
      state.aiTradeLog.unshift({
        type: 'liquidated',
        coin: coinId,
        qty: short.qty,
        price: currentPrice,
        pnl: -(margin - remnant),
        time: new Date().toLocaleTimeString(),
      });
      delete state.aiShorts[coinId];
    }
  });
}

// ── WIN RATE CALCULATIONS ──────────────────────────────────

function calcWinRate(player = 'user') {
  const log = player === 'user' ? state.userTradeLog : state.aiTradeLog;
  const closed = log.filter(t => t.pnl != null && (t.type.includes('close') || t.type === 'sell' || t.type === 'short_closed' || t.type === 'liquidated'));
  if (closed.length === 0) return 0;
  const wins = closed.filter(t => t.pnl > 0).length;
  return Math.round((wins / closed.length) * 100);
}

function calcDrawdown(player = 'user') {
  const log = player === 'user' ? state.userTradeLog : state.aiTradeLog;
  let peak = GAME_CONFIG.startingCash;
  let maxDD = 0;
  let equity = GAME_CONFIG.startingCash;

  log.forEach(trade => {
    if (trade.pnl != null) {
      equity += trade.pnl;
      peak = Math.max(peak, equity);
      const dd = (peak - equity) / peak;
      maxDD = Math.max(maxDD, dd);
    }
  });

  return Math.round(maxDD * 100);
}

// ── LEADERBOARD ─────────────────────────────────────────────

async function fetchLeaderboard(limit = 10) {
  try {
    if (typeof supabase === 'undefined') return [];

    const { data, error } = await supabase
      .from(SUPA_TABLE)
      .select('wallet_addr, state_json')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return [];

    return data
      .map(row => {
        try {
          const st = JSON.parse(row.state_json);
          return {
            addr: row.wallet_addr.slice(0, 6) + '...' + row.wallet_addr.slice(-4),
            pnl: (st.aiCash + Object.values(st.aiHoldings || {}).reduce((s, h) => s + h.margin, 0)) - GAME_CONFIG.startingCash,
            wins: st.aiWins,
            losses: st.aiLosses,
          };
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, limit);
  } catch (e) {
    return [];
  }
}

// ── EXPORT ──────────────────────────────────────────────────
// Make these available globally
window.calcUserPortfolio = calcUserPortfolio;
window.calcAiPortfolio = calcAiPortfolio;
window.getPositionPnL = getPositionPnL;
window.checkLiquidations = checkLiquidations;
window.calcWinRate = calcWinRate;
window.calcDrawdown = calcDrawdown;
window.fetchLeaderboard = fetchLeaderboard;
