# Phase 3 — Web3 Deploy Guide (Sepolia Testnet)

3 contracts deploy karne hain, sabke liye **Remix IDE** use karo (browser mein chalta hai, koi install nahi chahiye). Order **important hai** — pehle Token, phir NFT, phir Staking (Staking ko Token address chahiye).

## Prerequisites
- MetaMask installed, Sepolia network selected
- Sepolia testnet ETH (free faucet: https://sepoliafaucet.com or https://www.alchemy.com/faucets/ethereum-sepolia)

---

## Step 1 — Remix kholo
1. https://remix.ethereum.org kholo
2. Left sidebar → File Explorer → naya folder `contracts` banao
3. Is repo ke `contracts/BattleToken.sol`, `BattleNFT.sol`, `BattleStaking.sol` — teeno files ko copy-paste karke Remix mein same naam se banao

## Step 2 — Compile
1. Left sidebar → "Solidity Compiler" tab
2. Compiler version: `0.8.24` ya upar select karo
3. "Advanced Configurations" open karo → EVM Version: **Cancun** select karo (zaroori hai — OpenZeppelin ke newer utils `mcopy` opcode use karte hain jo sirf Cancun+ mein hai; agar EVM version "Paris" ya purana hai to compile error aayega)
4. Har file open karke "Compile" click karo (Remix automatically OpenZeppelin imports GitHub se fetch kar lega — internet chahiye)

✅ Maine ye 3 contracts locally solc 0.8.24 + OpenZeppelin v5 + EVM "Cancun" ke against compile karke verify kiye hain — clean compile, koi error nahi.

## Step 3 — Deploy BattleToken.sol
1. Left sidebar → "Deploy & Run Transactions" tab
2. Environment: **"Injected Provider - MetaMask"** select karo (MetaMask popup aayega, connect karo)
3. Network Sepolia confirm karo (top pe dikhega)
4. Contract dropdown mein `BattleToken` select karo
5. "Deploy" click karo → MetaMask mein confirm karo (gas fee lagegi, testnet ETH se)
6. Deploy hone ke baad, deployed contract address copy karo (Remix ke "Deployed Contracts" section mein dikhega, copy icon se)
7. **Ye address save karo** → `js/config.js` mein `WEB3_CONFIG.tokenAddress` mein paste karna hai

## Step 4 — Deploy BattleNFT.sol
1. Contract dropdown mein `BattleNFT` select karo
2. "Deploy" click karo, confirm karo
3. Deployed address copy karo → `WEB3_CONFIG.nftAddress` mein paste

### Badge metadata set karo (zaroori hai, warna mint fail hoga)
Har badge type (0 se 7 tak) ke liye `setBadgeURI` call karna padega:
1. Deployed `BattleNFT` contract expand karo (Remix mein)
2. `setBadgeURI` function dhoondo (orange = write function)
3. `badgeType` = 0, `uri` = koi bhi JSON metadata URL (simplest: apna GitHub Pages repo mein ek `metadata/0.json` file bana ke uska raw URL do, format neeche hai)
4. Ye repeat karo badgeType 0 se 7 tak (8 baar)

**Simple metadata JSON format** (`metadata/0.json` jaisi file banao har badge ke liye):
```json
{
  "name": "Momentum Pro Badge",
  "description": "Unlocked StochRSI confirmation tier in AI Battle Trader",
  "image": "https://your-repo.github.io/aibattle/badges/0.png"
}
```
(Image optional hai shuru mein — placeholder bhi chal jayega, baad mein add kar sakte ho.)

## Step 5 — Deploy BattleStaking.sol
1. Contract dropdown mein `BattleStaking` select karo
2. Constructor parameter `_battleToken` mein **Step 3 wala Token address** paste karo
3. "Deploy" click karo, confirm karo
4. Deployed address copy karo → `WEB3_CONFIG.stakingAddress` mein paste

### Staking pool ko fund karo (warna users reward claim nahi kar payenge)
1. Pehle `BattleToken` contract mein `approve` call karo: `spender` = Staking address, `amount` = jitna fund karna hai (e.g. `100000000000000000000000` = 100,000 BATTLE, 18 decimals)
2. Phir `BattleStaking` contract mein `fundRewards` call karo: `amount` = same value

---

## Step 6 — Config update karo
`js/config.js` mein top pe `WEB3_CONFIG` object hai — teeno addresses paste karo:
```js
const WEB3_CONFIG = {
  tokenAddress:   '0xYOUR_TOKEN_ADDRESS',
  nftAddress:     '0xYOUR_NFT_ADDRESS',
  stakingAddress: '0xYOUR_STAKING_ADDRESS',
};
```
Save karke GitHub Pages pe push kar do — Web3 Hub button (🪙 WEB3 HUB, top-right wallet bar mein) kaam karna shuru ho jayega.

---

## Testing checklist
- [ ] "🪙 WEB3 HUB" button khulta hai
- [ ] "CLAIM DAILY" 100 BATTLE deta hai (24h cooldown hai, dubara turant claim nahi hoga)
- [ ] Koi tier unlock karo (Sepolia gas tx) → uska badge "✨ MINT" button dikhna chahiye → mint karo → NFT wallet mein aa jayega (MetaMask → NFTs tab mein dikhega, thoda time lag sakta hai)
- [ ] Stake karo kuch BATTLE → "Staked" amount update hona chahiye
- [ ] Thodi der baad "Pending" reward > 0 dikhna chahiye
- [ ] "CLAIM STAKING REWARD" balance mein add karta hai

## Important honest notes
- **Ye testnet demo-grade hai, production-grade nahi.** Badge minting client-side trust pe based hai (jaisa tumhara existing Tier-Unlock system already karta hai) — koi backend/oracle verify nahi karta ki achievement genuine hai. Kisi motivated user ke liye frontend code edit karke fake-unlock dikhana technically possible hai (low stakes hai kyunki testnet tokens/NFTs ki koi real value nahi).
- Staking rewards sirf tab tak chalenge jab tak `fundRewards` se pool mein tokens hain — agar pool khaali ho gaya to `claimReward`/`unstake` fail honge jab tak fund na karo.
- `ownerMint` (BattleToken) sirf tumhare deployer wallet se call ho sakta hai — leaderboard winners ko manually reward dene ke liye Remix/Etherscan se call kar sakte ho.
