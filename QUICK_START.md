# Quick Start Guide

## 🚀 Running the Full Lifecycle

### 1. Create a Market
```bash
pnpm run create
```
**Save the output**: Copy `MARKET_TX_HASH` to your `.env`

---

### 2. Place Bets
```bash
pnpm run bet
```
**After each bet**: Update `MARKET_TX_HASH` in `.env` with the new transaction hash

You can run this multiple times to place multiple bets (edit [examples/02-place-bet.ts](examples/02-place-bet.ts) to change side and amount)

---

### 3. View Market State
```bash
pnpm exec tsx examples/view-market-simple.ts
```
Shows current pools, odds, and market status

---

### 4. Resolve the Market
```bash
pnpm run resolve
```
Declares the final outcome (YES or NO wins)

**After resolving**: Update `MARKET_TX_HASH` in `.env`

---

### 5. Claim Winnings
```bash
pnpm run claim
```
Winners withdraw their share of the pool

---

## ✨ Automatic .env Updates

**NEW**: The scripts now automatically update your `.env` file after successful transactions!

```
✅ Place bet → Auto-updates MARKET_TX_HASH + POSITION_TX_HASH
✅ Resolve   → Auto-updates MARKET_TX_HASH
✅ Claim     → Auto-updates MARKET_TX_HASH
```

**No more manual `.env` editing!** The latest market OutPoint is saved automatically.

### ⚠️ Troubleshooting Auto-Update

If you see `TransactionFailedToResolve` errors:
1. **Transaction replacement**: CKB occasionally replaces transactions (RBF)
2. **Check explorer**: Visit `https://pudge.explorer.nervos.org/transaction/YOUR_TX_HASH`
3. **Manual update**: If needed, manually set `MARKET_TX_HASH` in `.env`
4. **Wait**: Allow 15-30 seconds between transactions for confirmation

## 📍 Understanding Cell State

**Every transaction that modifies a cell creates a NEW cell at a NEW OutPoint:**

```
Create market    → tx1:0
Place bet 1      → tx2:0  (tx1:0 is now dead)
Place bet 2      → tx3:0  (tx2:0 is now dead)
Resolve market   → tx4:0  (tx3:0 is now dead)
Claim winnings   → tx5:0  (tx4:0 is now dead)
```

The auto-update feature tracks this for you!

---

## 🔧 Testing Different Scenarios

### Scenario 1: YES wins
1. Place 150 CKB bet on YES
2. Place 50 CKB bet on NO
3. Resolve with outcome = `true` (YES wins)
4. YES bettor claims and gets 200 CKB (50 CKB profit)

### Scenario 2: NO wins
1. Place 100 CKB bet on YES
2. Place 200 CKB bet on NO
3. Resolve with outcome = `false` (NO wins)
4. NO bettor claims and gets 300 CKB (100 CKB profit)

---

## 🐛 Troubleshooting

### "Market cell not found or already spent"
- Check that `MARKET_TX_HASH` in `.env` is the **latest** transaction
- After placing a bet, the market moves to the new transaction hash

### Transaction timeouts
- Testnet can be slow - wait 15-30 seconds between transactions
- Check transaction on explorer: `https://pudge.explorer.nervos.org/transaction/TX_HASH`

### Low balance
- Get testnet CKB from: https://faucet.nervos.org/
- You need at least 500 CKB for testing

---

## 📊 Understanding the Output

### Market Summary
```
Total Pool:    150 CKB    ← Total CKB in the market
YES Pool:      150 CKB    ← Amount bet on YES
NO Pool:         0 CKB    ← Amount bet on NO

YES Implied:  100.0%      ← Current odds (YES pool / total)
NO Implied:     0.0%      ← Current odds (NO pool / total)

Total Bets:        1      ← Number of bets placed
Status:       ACTIVE      ← Market is accepting bets
```

### Payout Calculation
```
Winner's payout = (user_bet / winning_pool) × total_pool

Example:
- YES pool: 100 CKB (Alice)
- NO pool: 50 CKB (Bob)
- Outcome: YES wins
- Alice's payout: (100 / 100) × 150 = 150 CKB
- Alice's profit: 150 - 100 = 50 CKB (50% return)
```

---

## 🎯 What's Next?

After completing the full lifecycle:
1. Try placing multiple bets from different accounts
2. Experiment with different bet amounts and sides
3. Check Phase 2 roadmap for type script implementation

**Phase 2 Preview**: Type scripts will enforce rules on-chain so no one can cheat!
