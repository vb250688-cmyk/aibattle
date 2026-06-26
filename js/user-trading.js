// ════════════════════════════════════════════════════════════════
// USER-TRADING.JS — AI Battle Trader · User Trade Logic
// ════════════════════════════════════════════════════════════════

// ── LEVERAGE SELECTOR ──────────────────────────────────────────
function setLeverage(lev) {
  state.currentLeverage = lev;
  
  // Update button UI
  document.querySelectorAll('.lev-btn').forEach(b => {
    const btnLev = parseInt(b.textContent);
    b.classList.toggle('active', btnLev === lev);
  });

  const dispEl = document.getElementById('leverage-display');
  if (dispEl) dispEl.textContent = lev + 'x';

  // Update position size display
  updatePosSizeDisplay();
  saveState();
  notify(`⚡ Leverage set to ${lev}x`, 'reward');
}

function updatePosSizeDisplay() {
  const lev = state.currentLeverage || LEVERAGE_CONFIG.defaultLeverage;
  const size = state.userTradeSize || GAME_CONFIG.defaultTradeSize;
  const pos = Math.floor(size * lev);
  const el = document.getElementById('position-size-display');
  if (el) el.textContent = `Position: $${pos.toLocaleString()} (${lev}x)`;
}

// ── SIZE SELECTOR ──────────────────────────────────────────────
function setUserSize(amount) {
  const actual = amount === 0 ? Math.floor(state.userCash * 0.8) : amount; // 80% of cash for MAX
  state.userTradeSize = actual;
  state._sizeKey = amount;

  // Update button classes
  document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
  const idMap = { 50: 'size-50', 100: 'size-100', 250: 'size-250', 0: 'size-max' };
  const el = document.getElementById(idMap[amount]);
  if (el) el.classList.add('active');

  // Update display
  const disp = document.getElementById('size-display');
  if (disp) disp.textContent = amount === 0 ? `$${actual} (MAX)` : `$${actual}`;

  updatePosSizeDisplay();
  saveState();
}

// ── PLACE TRADE (LONG/SHORT WITH LEVERAGE) ─────────────────────
function placeUserFuturesTrade(direction, evt) {
  const coin = state.selectedCoin;
  const pos = state.userPositions[coin];
  const price = livePrices[coin];

  if (!price) {
    notify('No price data', 'loss');
    return;
  }

  const lev = state.currentLeverage || LEVERAGE_CONFIG.defaultLeverage;
  const amount = Math.min(state.userTradeSize || GAME_CONFIG.defaultTradeSize, state.userCash);

  if (amount < 5) {
    notify('Minimum $5 required', 'loss');
    return;
  }

  if (amount > state.userCash) {
    notify('Insufficient cash!', 'loss');
    return;
  }

  const time = new Date().toLocaleTimeString();

  // ════════════════════════════════════════════════════════════
  // OPEN / ADD LONG
  // ════════════════════════════════════════════════════════════
  if (direction === 'long') {
    const entryFee = amount * 0.001; // 0.1% entry fee
    const margin = amount - entryFee;
    const notional = margin * lev;
    const qty = notional / price; // leveraged quantity

    state.userCash -= amount;

    if (!pos || pos.side !== 'long') {
      // New position
      state.userPositions[coin] = {
        side: 'long',
        qty: qty,
        avgCost: price,
        invested: margin,
        margin: margin,
        leverage: lev,
        notional: notional,
        entryTime: Date.now(),
      };
    } else {
      // Average into existing long
      const p = state.userPositions[coin];
      const totalQty = p.qty + qty;
      p.avgCost = (p.avgCost * p.qty + price * qty) / totalQty;
      p.qty = totalQty;
      p.margin += margin;
      p.invested = p.margin;
      p.notional = totalQty * price;
    }

    state.userTradeLog.unshift({
      type: 'buy_long',
      coin: coin,
      qty: qty,
      price: price,
      amount: amount,
      fee: entryFee,
      pnl: null,
      time: time,
      leverage: lev,
    });

    notify(`📈 LONG ${qty.toFixed(4)} ${coin} @$${price.toFixed(2)} (${lev}x)`, 'profit');
    if (evt) floatPnl(`+$${(margin * 0.01).toFixed(2)}`, '#00ff88', evt.clientX, evt.clientY);
  }

  // ════════════════════════════════════════════════════════════
  // OPEN / ADD SHORT
  // ════════════════════════════════════════════════════════════
  else if (direction === 'short') {
    const entryFee = amount * 0.001;
    const margin = amount - entryFee;
    const notional = margin * lev;
    const qty = notional / price;

    state.userCash -= amount;

    if (!pos || pos.side !== 'short') {
      state.userPositions[coin] = {
        side: 'short',
        qty: qty,
        entryPrice: price,
        invested: margin,
        margin: margin,
        leverage: lev,
        notional: notional,
        entryTime: Date.now(),
      };
    } else {
      const p = state.userPositions[coin];
      const totalQty = p.qty + qty;
      p.entryPrice = (p.entryPrice * p.qty + price * qty) / totalQty;
      p.qty = totalQty;
      p.margin += margin;
      p.invested = p.margin;
      p.notional = totalQty * price;
    }

    state.userTradeLog.unshift({
      type: 'sell_short',
      coin: coin,
      qty: qty,
      price: price,
      amount: amount,
      fee: entryFee,
      pnl: null,
      time: time,
      leverage: lev,
    });

    notify(`📉 SHORT ${qty.toFixed(4)} ${coin} @$${price.toFixed(2)} (${lev}x)`, 'short');
    if (evt) floatPnl(`+$${(margin * 0.01).toFixed(2)}`, '#ffaa55', evt.clientX, evt.clientY);
  }

  // ════════════════════════════════════════════════════════════
  // CLOSE LONG
  // ════════════════════════════════════════════════════════════
  else if (direction === 'close_long') {
    if (!pos || pos.side !== 'long' || pos.qty < 1e-8) {
      notify('No LONG to close!', 'loss');
      return;
    }

    const exitFee = pos.qty * price * 0.001;
    const grossPnl = pos.qty * (price - pos.avgCost); // leveraged gain
    const pnl = grossPnl - exitFee;
    const margin = pos.margin || pos.invested || 0;

    // ★ KEY FIX: Return margin + pnl (NOT full notional)
    state.userCash += margin + pnl;

    if (pnl > 0) {
      state.userWins++;
      const earnedPts = calcPts(pnl, margin);
      addUserPoints(earnedPts);
    } else {
      state.userLosses++;
    }

    state.userTradeLog.unshift({
      type: 'close_long',
      coin: coin,
      qty: pos.qty,
      price: price,
      pnl: pnl,
      fee: exitFee,
      time: time,
    });

    delete state.userPositions[coin];

    const msgL = pnl >= 0 ? `✅ LONG closed +$${pnl.toFixed(2)}` : `❌ LONG loss -$${Math.abs(pnl).toFixed(2)}`;
    notify(msgL, pnl >= 0 ? 'profit' : 'loss', evt);

    if (evt) floatPnl((pnl >= 0 ? '+' : '') + `$${pnl.toFixed(2)}`, pnl >= 0 ? '#00ff88' : '#ff3355', evt.clientX, evt.clientY);
    if (pnl >= 0) spawnParticles(window.innerWidth / 2, window.innerHeight / 2, '#00ff88', 30);
    else {
      const el = document.getElementById('user-panel');
      if (el) el.style.animation = 'shake 0.4s ease';
    }
  }

  // ════════════════════════════════════════════════════════════
  // CLOSE SHORT
  // ════════════════════════════════════════════════════════════
  else if (direction === 'close_short') {
    if (!pos || pos.side !== 'short' || pos.qty < 1e-8) {
      notify('No SHORT to close!', 'loss');
      return;
    }

    const exitFee = pos.qty * price * 0.001;
    const grossPnl = pos.qty * (pos.entryPrice - price); // short gains when price drops
    const pnl = grossPnl - exitFee;
    const margin = pos.margin || pos.invested || 0;

    state.userCash += margin + pnl;

    if (pnl > 0) {
      state.userWins++;
      const earnedPts = calcPts(pnl, margin);
      addUserPoints(earnedPts);
    } else {
      state.userLosses++;
    }

    state.userTradeLog.unshift({
      type: 'close_short',
      coin: coin,
      qty: pos.qty,
      price: price,
      pnl: pnl,
      fee: exitFee,
      time: time,
    });

    delete state.userPositions[coin];

    const msgS = pnl >= 0 ? `✅ SHORT closed +$${pnl.toFixed(2)}` : `❌ SHORT loss -$${Math.abs(pnl).toFixed(2)}`;
    notify(msgS, pnl >= 0 ? 'profit' : 'loss', evt);

    if (evt) floatPnl((pnl >= 0 ? '+' : '') + `$${pnl.toFixed(2)}`, pnl >= 0 ? '#00ff88' : '#ff3355', evt.clientX, evt.clientY);
    if (pnl >= 0) spawnParticles(window.innerWidth / 2, window.innerHeight / 2, '#00ff88', 30);
    else {
      const el = document.getElementById('user-panel');
      if (el) el.style.animation = 'shake 0.4s ease';
    }
  }

  saveState();
  updateUI();
}

// ── QUICK CLOSE (1-CLICK TP/SL) ────────────────────────────────
function quickClose(coinId, action) {
  placeUserFuturesTrade(action, null);
}

// ── EXPORT ──────────────────────────────────────────────────
window.setLeverage = setLeverage;
window.setUserSize = setUserSize;
window.updatePosSizeDisplay = updatePosSizeDisplay;
window.placeUserFuturesTrade = placeUserFuturesTrade;
window.quickClose = quickClose;
