# 🎮 AI Battle Trader

**AI vs User crypto trading game** — Live Binance prices, Sepolia testnet points, daily leaderboard.

---

## 📁 Folder Structure

```
aibattle/
├── index.html              ← HTML only — layout & DOM structure
├── css/
│   └── style.css           ← All styles, animations, design tokens
├── js/
│   ├── config.js           ← ⚙️  All constants (edit this to configure)
│   └── app.js              ← Game logic, AI engine, chart, WebSocket
├── contracts/
│   └── AIBattleScore_v2.sol ← Sepolia smart contract (Solidity)
└── README.md
```

---

## ⚙️ Configuration (`js/config.js`)

| Variable | Purpose |
|---|---|
| `SUPA_URL` / `SUPA_KEY` | Supabase project credentials |
| `SUPA_TABLE` | Table name for leaderboard |
| `GAME_CONFIG.startingCash` | Starting USD per side |
| `GAME_CONFIG.resetHourIST` | Daily reset hour (IST) |
| `COINS` | Add/remove tradeable coins here |
| `NETWORK_CONFIG` | Switch between Sepolia / Mainnet |

---

## 🚀 Local Run

```bash
# Any static server works — open index.html directly OR:
npx serve .
# then visit http://localhost:3000
```

## 🌐 Deploy (Railway / Render / Vercel)

Just upload the folder. No build step needed — pure HTML/CSS/JS.

---

## 📝 Update Guide

| Want to change | Edit file |
|---|---|
| Colors, fonts, layout | `css/style.css` |
| Game settings, coins | `js/config.js` |
| AI logic, trading engine | `js/app.js` |
| Page structure (HTML) | `index.html` |
| Smart contract | `contracts/AIBattleScore_v2.sol` |

