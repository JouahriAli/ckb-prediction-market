# Prediction Market Design - Complete Set Mechanism

## Overview

This prediction market uses a **complete set mechanism** with **xUDT tokens** (YES/NO). Users mint complete sets by depositing CKB, then trade tokens on a secondary market for price discovery.

**Key Properties:**
- ✅ Simple minting: 1 CKB = 1 YES + 1 NO token
- ✅ Arbitrage-bounded prices: YES + NO ≤ 1 CKB
- ✅ Clean accounting: CKB pool = total minted sets
- ✅ Proven pattern: Used by Polymarket, Augur, etc.
- ✅ Separation of concerns: Minting vs trading markets

## Core Mechanics

### 1. Minting Complete Sets

Users deposit CKB to mint equal amounts of YES and NO tokens.

```
User deposits: N CKB
Market mints: N YES tokens + N NO tokens
CKB pool: +N CKB
```

**Example:**
```
Alice deposits 100 CKB
→ Receives 100 YES + 100 NO tokens
→ Market pool: 100 CKB
```

**Transaction:**
```
INPUTS:
  - Market cell (current state)
  - User's CKB cells (N CKB)

OUTPUTS:
  - Market cell (pool + N CKB, supply tracking updated)
  - User's YES xUDT cell (N tokens)
  - User's NO xUDT cell (N tokens)
  - Change
```

### 2. Burning Complete Sets (Before Resolution)

Users can redeem complete sets for CKB before resolution. This enables arbitrage and keeps prices bounded.

```
User burns: N YES + N NO tokens
Market returns: N CKB
CKB pool: -N CKB
```

**Why This Matters:**

If market prices are:
- YES trading at 0.6 CKB
- NO trading at 0.5 CKB
- Total: 1.1 CKB

An arbitrageur can:
1. Mint 1 complete set for 1 CKB
2. Sell YES for 0.6 CKB
3. Sell NO for 0.5 CKB
4. Profit: 0.1 CKB

This drives prices to satisfy: **YES_price + NO_price ≤ 1 CKB**

**Transaction:**
```
INPUTS:
  - Market cell (current pool)
  - User's YES xUDT cell (N tokens)
  - User's NO xUDT cell (N tokens)

OUTPUTS:
  - Market cell (pool - N CKB, supply tracking updated)
  - User's CKB payout (N CKB - fees)
  - Change
```

### 3. Resolution & Payouts

After the market resolves, winners burn their tokens for a proportional share of the CKB pool.

```
CKB pool: Total CKB in market (after structural minimum)
Winning supply: Total YES or NO tokens (based on outcome)
User payout: (user_tokens / winning_supply) × CKB_pool
```

**Example:**
```
Market resolves: YES wins
CKB pool: 500 CKB (after subtracting structural minimum)
Total YES supply: 300 tokens
Total NO supply: 200 tokens

Alice owns: 100 YES tokens
Alice's payout: (100 / 300) × 500 = 166.67 CKB

Bob owns: 200 NO tokens
Bob's payout: 0 CKB (losing side)
```

**Transaction:**
```
INPUTS:
  - Market cell (CKB pool)
  - User's winning xUDT cell (M tokens)

OUTPUTS:
  - Market cell (pool - payout, supply tracking updated)
  - User's CKB payout
  - Tokens BURNED (not in outputs)
```

## Market Data Structure

```typescript
interface MarketData {
  yesSupply: bigint;           // Total YES tokens minted
  noSupply: bigint;            // Total NO tokens minted
  ckbPool: bigint;             // Total CKB in escrow
  resolved: boolean;
  outcome: boolean | null;     // true = YES, false = NO, null = unresolved
  deadline: bigint;
  yesTokenTypeHash: string;    // xUDT type hash for YES tokens
  noTokenTypeHash: string;     // xUDT type hash for NO tokens
}
```

**Invariant (before resolution):**
```
ckbPool = (yesSupply + noSupply) / 2
```

This holds because:
- Minting 1 set costs 1 CKB, creates 1 YES + 1 NO
- Burning 1 set returns 1 CKB, destroys 1 YES + 1 NO

## Implementation Formulas

### Minting

```typescript
function mintCompleteSet(ckbAmount: bigint) {
  const tokensToMint = ckbAmount;  // 1:1 ratio

  return {
    yesTokens: tokensToMint,
    noTokens: tokensToMint,
    newPool: currentPool + ckbAmount,
    newYesSupply: currentYesSupply + tokensToMint,
    newNoSupply: currentNoSupply + tokensToMint,
  };
}
```

### Burning (Before Resolution)

```typescript
function burnCompleteSet(setCount: bigint) {
  // Requires equal YES and NO tokens
  const ckbReturned = setCount;  // 1:1 ratio

  return {
    ckbPayout: ckbReturned,
    newPool: currentPool - ckbReturned,
    newYesSupply: currentYesSupply - setCount,
    newNoSupply: currentNoSupply - setCount,
  };
}
```

### Claiming (After Resolution)

```typescript
function claimPayout(
  userTokens: bigint,
  winningSide: 'yes' | 'no'
) {
  const winningSupply = winningSide === 'yes'
    ? marketData.yesSupply
    : marketData.noSupply;

  // Proportional payout
  const userPayout = (userTokens * marketData.ckbPool) / winningSupply;

  return {
    ckbPayout: userPayout,
    newPool: marketData.ckbPool - userPayout,
    // Supply tracking stays same (for accounting)
  };
}
```

## Price Discovery (Secondary Market)

The complete set mechanism doesn't provide price discovery - that happens on a **secondary market** (to be implemented later).

Possible trading mechanisms:
1. **Order Book** (CLOB): Traditional limit orders
2. **AMM** (Uniswap-style): Automated liquidity pools
3. **CSMM/LMSR**: Specialized prediction market AMMs
4. **Hybrid**: Combine multiple approaches

**Price Bounds:**

No matter what trading mechanism is used, arbitrage ensures:
```
0 ≤ YES_price ≤ 1
0 ≤ NO_price ≤ 1
YES_price + NO_price ≤ 1
```

Because if the sum exceeds 1, someone mints a set for 1 CKB and sells both tokens for profit.

## xUDT Token Configuration

```typescript
// For MVP: Use user's lock hash as UDT args
const userLock = (await signer.getRecommendedAddressObj()).script;

const yesTokenType = await ccc.Script.fromKnownScript(
  client,
  ccc.KnownScript.XUdt,
  userLock.hash()  // Market owner can mint
);

const noTokenType = await ccc.Script.fromKnownScript(
  client,
  ccc.KnownScript.XUdt,
  userLock.hash()  // Market owner can mint
);
```

**Trust Assumption (MVP):** Market owner controls minting. Users trust the owner won't mint extra tokens outside the complete set mechanism.

**Phase 2:** Add type script validation to enforce minting rules on-chain.

## Market Creation

Creating a market is simple:

```typescript
const marketData: MarketData = {
  yesSupply: 0n,
  noSupply: 0n,
  ckbPool: 0n,
  resolved: false,
  outcome: null,
  deadline: config.deadline,
  yesTokenTypeHash: yesTokenType.hash(),
  noTokenTypeHash: noTokenType.hash(),
};

// Create market cell with initial capacity
// 1 transaction, no seal cells needed
```

## Example Walkthrough

### Setup
```
Market: "Will BTC hit $100k by EOY?"
Initial state: 0 CKB pool, 0 tokens
```

### Step 1: Alice mints complete sets
```
Alice deposits: 100 CKB
Alice receives: 100 YES + 100 NO
Market state:
  - Pool: 100 CKB
  - YES supply: 100
  - NO supply: 100
```

### Step 2: Alice sells NO tokens (on secondary market - not implemented yet)
```
Alice keeps: 100 YES
Alice sells: 100 NO for 40 CKB (to Bob)
(This happens off-chain or on a separate trading contract)
```

### Step 3: Bob mints complete sets
```
Bob deposits: 50 CKB
Bob receives: 50 YES + 50 NO
Market state:
  - Pool: 150 CKB
  - YES supply: 150
  - NO supply: 150
```

### Step 4: Market resolves - YES wins
```
Resolution: YES wins
Final pool: 150 CKB
YES supply: 150 tokens

Alice claims: 100 YES tokens
Alice payout: (100 / 150) × 150 = 100 CKB

Bob claims: 50 YES tokens (he bought Alice's NO for 40, but also minted 50 YES)
Bob payout: (50 / 150) × 150 = 50 CKB

Bob's net: Spent 50 CKB minting + 40 CKB buying = 90 CKB, received 50 CKB = -40 CKB loss
Alice's net: Spent 100 CKB minting, received 40 CKB selling + 100 CKB claiming = +40 CKB profit
```

## Advantages of Complete Set Mechanism

| Aspect | Complete Sets | CSMM with Virtual Liquidity |
|--------|--------------|---------------------------|
| Minting formula | `1 CKB = 1 YES + 1 NO` | Complex CSMM pricing |
| Price discovery | Secondary market | Built-in AMM |
| Arbitrage bounds | Natural (YES + NO ≤ 1) | Requires complex math |
| Escrow accounting | Simple: pool = sets minted | Complex: virtual liquidity |
| Implementation | ~100 lines | ~900 lines |
| Auditability | Trivial to verify | Complex formulas |
| Flexibility | Plug in any trading system | Locked to CSMM |
| Industry standard | ✅ Polymarket, Augur | Experimental |

## Security Considerations

### Phase 1 (MVP - Current)
- Market owner controls minting via xUDT owner lock
- **Trust assumption**: Owner won't mint tokens outside the complete set mechanism
- Users can verify total supply on-chain
- Simple logic = easier to audit

### Phase 2 (Production)
- Type script validates all minting operations
- Enforces 1:1 ratio (YES minted = NO minted)
- Enforces burning rules (complete sets only before resolution)
- Enforces payout formula after resolution

### Type Script Validation (Phase 2)

```rust
match operation {
  MintCompleteSet => {
    verify(yes_minted == no_minted);
    verify(ckb_deposited == yes_minted);
    verify(pool_increased_correctly);
    verify(!resolved);
  },

  BurnCompleteSet => {
    verify(yes_burned == no_burned);
    verify(ckb_returned == yes_burned);
    verify(pool_decreased_correctly);
    verify(!resolved);
  },

  Resolution => {
    verify(current_time >= deadline);
    verify(authorized_resolver_signature);
    verify(supply_unchanged);
  },

  Claim => {
    verify(resolved == true);
    verify(burning_winning_tokens_only);
    verify(payout = (tokens * pool) / winning_supply);
  }
}
```

## Edge Cases

### All tokens on one side
```
Scenario: Everyone minted sets, then sold all their NO tokens to one person

Market state:
- Pool: 1000 CKB
- YES supply: 1000 (distributed among many users)
- NO supply: 1000 (all owned by Bob)

If YES wins:
- Bob loses everything (his 1000 NO tokens are worthless)
- YES holders share the 1000 CKB pool proportionally

If NO wins:
- Bob wins everything (his 1000 NO tokens claim the entire pool)
- YES holders get nothing
```

This is expected behavior - the person betting against the crowd takes all if they're right.

### Zero division protection
```
Cannot happen because:
- If winning_supply = 0, no one can claim (no tokens to burn)
- Pool only has CKB if tokens were minted
- If tokens were minted, supply > 0
```

### Precision
```typescript
// Always multiply before divide to avoid precision loss
// GOOD: (userTokens * pool) / winningSupply
// BAD: (userTokens / winningSupply) * pool

payout = (userTokens * marketData.ckbPool) / winningSupply;
```

## Next Steps

### Phase 1 - MVP (Current Focus)
1. ✅ Design complete set mechanism
2. ⏳ Implement market creation
3. ⏳ Implement complete set minting
4. ⏳ Implement complete set burning (before resolution)
5. ⏳ Implement resolution & claiming
6. ⏳ Test with real transactions on testnet

### Phase 2 - Trading Market
1. Design trading mechanism (order book vs AMM vs hybrid)
2. Implement price discovery system
3. Test arbitrage bounds
4. Optimize for gas efficiency

### Phase 3 - Production Hardening
1. Implement type script validation
2. Security audit
3. Mainnet deployment
4. User interface

---

## Comparison to Other Prediction Markets

**Polymarket:**
- Minting: USDC → YES + NO (complete sets)
- Trading: Central Limit Order Book (CLOB)
- Our approach: Same minting, different trading (to be designed)

**Augur:**
- Minting: ETH → YES + NO (complete sets)
- Trading: AMM + Order Book hybrid
- Our approach: Same pattern, on CKB/Nervos

**Gnosis:**
- Uses LMSR (Logarithmic Market Scoring Rule)
- Built-in liquidity but complex math
- Our approach: Simpler minting, separate trading layer

## Conclusion

The complete set mechanism is the industry-standard approach for prediction markets. It's simple, auditable, and flexible. Price discovery happens on a separate trading layer, which can be optimized independently.

**Key Insight:** Don't conflate minting (simple 1:1 mechanism) with trading (complex price discovery). Separate concerns = better design.
