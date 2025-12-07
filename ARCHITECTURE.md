# Prediction Market Architecture

## 🎯 Core Design: Escrow + Receipt Pattern

### The Correct CKB Flow

When a user bets **200 CKB**:

```
USER PAYS: 200 CKB (bet) + 61 CKB (receipt cell) = 261 CKB total

Transaction:
├─ INPUTS:
│  ├─ Market cell: 500 CKB
│  └─ User's wallet: 261 CKB
│
└─ OUTPUTS:
   ├─ Market cell: 700 CKB (500 + 200) ← BET GOES HERE (ESCROW)
   ├─ Position cell: 61 CKB             ← RECEIPT (minimal capacity)
   └─ Change: leftover

MARKET CELL = ESCROW holding all bets
POSITION CELL = RECEIPT proving you bet
```

### Why This Design?

**Market Cell acts as ESCROW:**
- Holds ALL CKB from all bets
- Capacity = initial + sum of all bets
- Acts as the prize pool

**Position Cell acts as RECEIPT:**
- Proves you placed a bet
- Contains bet metadata (side, amount, timestamp)
- Uses minimal capacity (61 CKB)
- Can be burned to claim winnings

### Complete Lifecycle Example

#### 1. Create Market
```
Input:  User wallet: 300 CKB
Output: Market cell: 200 CKB (initial escrow)
        Change: 100 CKB

Market: capacity=200, yesPool=0, noPool=0
```

#### 2. Alice Bets 150 CKB on YES
```
Inputs:  Market: 200 CKB
         Alice wallet: 211 CKB (150 + 61)

Outputs: Market: 350 CKB (200 + 150)
         Position: 61 CKB (receipt, owned by Alice)
         Change: leftover

Market: capacity=350, yesPool=150, noPool=0
Alice has receipt: side=YES, amount=150
```

#### 3. Bob Bets 100 CKB on NO
```
Inputs:  Market: 350 CKB
         Bob wallet: 161 CKB (100 + 61)

Outputs: Market: 450 CKB (350 + 100)
         Position: 61 CKB (receipt, owned by Bob)
         Change: leftover

Market: capacity=450, yesPool=150, noPool=100
Bob has receipt: side=NO, amount=100
```

#### 4. Resolve: YES Wins
```
Inputs:  Market: 450 CKB
Outputs: Market: 450 CKB (capacity unchanged)

Market: capacity=450, yesPool=150, noPool=100, resolved=true, outcome=YES
```

#### 5. Alice Claims
```
Calculation:
  totalPool = 150 + 100 = 250 CKB
  winningPool = 150 CKB (YES pool)
  Alice's bet = 150 CKB
  Alice's payout = (150 / 150) × 250 = 250 CKB

Inputs:  Market: 450 CKB
         Alice's receipt: 61 CKB

Outputs: Market: 200 CKB (450 - 250, back to initial!)
         Alice payout: 250 CKB
         (Receipt is consumed/burned)

Alice gets: 250 CKB
Alice's profit: 250 - 150 = 100 CKB (66.7% return!)
```

### What Happens to Losers?

**Bob's Position Cell:**
- Still exists (61 CKB capacity)
- Cannot be claimed (wrong side)
- Effectively worthless

**Bob's Options:**
- Do nothing (61 CKB locked forever)
- OR (Phase 2): Burn receipt to recover the 61 CKB cell capacity

**The 61 CKB Issue:**
This is a limitation of Phase 1. In Phase 2, we should allow losers to burn their receipts to recover the cell capacity (not the bet, just the 61 CKB overhead).

### CKB Accounting

**Total CKB Locked:**
```
Market escrow: 450 CKB
Position cells: 2 × 61 = 122 CKB
Total: 572 CKB
```

**After Alice Claims:**
```
Market escrow: 200 CKB (back to initial)
Remaining position: 1 × 61 = 61 CKB (Bob's worthless receipt)
Alice received: 250 CKB + 61 CKB (from burning her receipt) = 311 CKB
```

**Net Effect:**
- Alice paid: 211 CKB (150 bet + 61 receipt)
- Alice received: 311 CKB (250 payout + 61 from receipt burn)
- Alice profit: 100 CKB ✅

- Bob paid: 161 CKB (100 bet + 61 receipt)
- Bob received: 0 CKB
- Bob lost: 100 CKB (bet) + 61 CKB (locked receipt) = 161 CKB ❌

### Phase 2 Improvements

1. **Collect losing receipts during resolution**
   - Burns all losing position cells
   - Returns the 61 CKB from each to market escrow
   - Prevents garbage cells

2. **Or: Allow losers to burn receipts**
   ```
   Input: Bob's receipt (61 CKB)
   Output: Bob receives 61 CKB back
   ```
   This way losers only lose their bet, not the cell overhead.

3. **Type script validation**
   - Enforce that market capacity = sum of bets
   - Prevent cheating by manually crafted transactions
   - Validate payout calculations on-chain

---

## Summary

✅ **Bet amount** → Market cell capacity (ESCROW)
✅ **Position cell** → Receipt with minimal 61 CKB
✅ **Winners** → Burn receipt + claim from escrow
⚠️ **Losers** → Receipt becomes worthless (61 CKB locked)

This design is economically sound but has the 61 CKB overhead waste issue in Phase 1.
