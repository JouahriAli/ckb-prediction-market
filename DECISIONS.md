# Design Decisions Log

This document tracks major design decisions made throughout the project, including alternatives considered, trade-offs, and reasoning.

---

## Decision #1: Token Uniqueness Per Market (PENDING DISCUSSION)

**Date**: 2025-11-11
**Status**: 🟡 PENDING - Awaiting decision
**Related Files**: `src/market.ts`, `src/betting.ts`, `src/queries.ts`

### Problem Statement

Currently, all markets created by the same owner share identical YES/NO token type hashes because we use:
```typescript
yesTokenArgs = ownerLockHash + "01"
noTokenArgs = ownerLockHash + "00"
```

**Impact**:
- When viewing Market A's state, `examples/03-view-market.ts` shows tokens from ALL markets (A, B, C...)
- User sees token holdings from previous/other markets mixed together
- Cannot distinguish which tokens belong to which market
- Confusing UX and potential for errors

**Example**:
```
Market A (current): 0x721c...c4da
Market B (old):     0x9272...1516
Market C (old):     0x8f6f...4767

User runs: pnpm exec tsx examples/03-view-market.ts
Output shows:
  - 240 NO tokens from Market A ✓
  - 240 NO tokens from Market B ✗ (should not show)
  - 216 NO tokens from Market C ✗ (should not show)
```

### Solution Options

#### Option 1: Include Market Identifier in Token Args

Make token args unique per market: `ownerLockHash + marketIdentifier + suffix`

##### Option 1.1: Timestamp Nonce
```typescript
// Market creation:
const nonce = BigInt(Date.now());
const yesTokenArgs = ownerLockHash + numToHex(nonce, 8) + "01";

// Store nonce in market data (requires +8 bytes encoding)
marketData.marketNonce = nonce;

// Betting (reconstruction):
const nonce = marketData.marketNonce;
const tokenArgs = ownerLockHash + numToHex(nonce, 8) + (side ? "01" : "00");
```

**Pros**:
- Simple to generate (just use timestamp)
- Guaranteed unique per market
- No external dependencies

**Cons**:
- Must store nonce in market data (+8 bytes)
- Changes market data encoding (114 → 122 bytes)
- Must reconstruct exact same nonce when betting
- Already attempted and reverted due to complexity

**Complexity**: Medium (data schema change)

##### Option 1.2: Market Transaction Hash
```typescript
// Problem: Chicken-and-egg!
// Can't use market tx hash before creating the market

// Possible workaround: 2-transaction approach
// Tx1: Create market with placeholder
// Tx2: Update market with token type hashes
```

**Pros**:
- Market tx hash is natural unique identifier
- No extra data to store

**Cons**:
- Chicken-and-egg problem
- Requires 2 transactions instead of 1
- More complex, higher gas costs
- Not elegant

**Complexity**: High (requires restructuring)

##### Option 1.3: First Input Outpoint (RECOMMENDED)
```typescript
// Market creation:
const inputs = await tx.completeInputsByCapacity(signer);
const firstInput = inputs[0].previousOutput;
const marketId = firstInput.txHash + numToHex(firstInput.index, 4); // 36 bytes
const yesTokenArgs = ownerLockHash + marketId + "01";

// Betting (reconstruction):
const marketCreationTx = await client.getTransaction(marketTxHash);
const firstInput = marketCreationTx.transaction.inputs[0].previousOutput;
const marketId = firstInput.txHash + numToHex(firstInput.index, 4);
const tokenArgs = ownerLockHash + marketId + (side ? "01" : "00");
```

**Pros**:
- ✅ Deterministic - first input is known before signing
- ✅ Unique per market (outpoints are unique)
- ✅ No extra storage needed in market data
- ✅ Can be reconstructed from market creation transaction
- ✅ Elegant and follows CKB patterns

**Cons**:
- Requires fetching market creation tx to reconstruct args
- Slightly more complex arg reconstruction
- First input must be deterministic (CCC SDK handles this)

**Complexity**: Medium (tx fetching required)

#### Option 2: Filter Tokens by Market Status

Keep simple token args, but filter displayed tokens based on context.

```typescript
// In view-market.ts:
async function findUserPositionsForMarket(marketTxHash) {
  const allTokens = await findAllUserTokens();

  // Only show tokens if:
  // 1. They were created in txs that spent this market cell
  // 2. They haven't been spent yet
  return allTokens.filter(token => {
    return isTokenFromThisMarket(token, marketTxHash);
  });
}
```

**Pros**:
- No schema changes
- No arg complexity
- Keep current simple token args

**Cons**:
- Requires traversing transaction history
- Complex filtering logic
- Still fundamentally ambiguous (can't tell by type hash alone)
- Won't work reliably

**Complexity**: High (transaction graph traversal)

#### Option 3: Store Token Cell Outpoints in Market Data

Market data maintains array of all token cell outpoints created for this market.

```typescript
marketData.tokenCells = [
  { txHash: "0x...", index: 1, side: false },
  { txHash: "0x...", index: 2, side: true },
  // ... grows with every bet
];
```

**Pros**:
- Definitive source of truth
- No ambiguity

**Cons**:
- Market data grows with every bet (not scalable)
- Encoding becomes variable-length (complex)
- Defeats purpose of using xUDT standard
- Anti-pattern for CKB

**Complexity**: High (variable-length encoding, scalability issues)

#### Option 4: Accept Limitation for MVP

Document that one address should only manage one active market at a time.

**Pros**:
- No code changes needed
- Simple for MVP
- Can improve in Phase 2 with type scripts

**Cons**:
- Awkward limitation
- Must create new addresses for multiple markets
- Still causes issues if testing multiple markets

**Complexity**: None (documentation only)

### Recommendation

**Option 1.3: Use First Input Outpoint**

**Reasoning**:
1. Most elegant CKB-native solution
2. Deterministic and unique without extra storage
3. Follows blockchain patterns (using tx inputs as identifiers)
4. Clean separation between markets
5. Reconstructable from on-chain data

**Implementation Steps**:
1. Modify `src/market.ts`:
   - After `completeInputsByCapacity`, get first input
   - Include `firstInput.txHash + firstInput.index` in token args
2. Modify `src/betting.ts`:
   - Fetch market creation transaction
   - Extract first input from that transaction
   - Reconstruct token args with same marketId
3. Modify `src/resolution.ts`:
   - Same reconstruction logic for claiming

**Trade-offs Accepted**:
- Slightly more complex token arg reconstruction (need to fetch creation tx)
- Worth it for clean market isolation

### Open Questions

**For Discussion**:
1. Do you prefer Option 1.3 (first input outpoint), or another approach?
2. Should we keep it super simple for MVP (Option 4) and improve later?
3. Is there a simpler approach we haven't considered?
4. Are you comfortable with fetching the market creation tx on every bet?

### Implementation Plan (if Option 1.3 chosen)

```
[ ] 1. Update market.ts to use first input in token args
[ ] 2. Add helper function: getMarketIdFromCreationTx(txHash)
[ ] 3. Update betting.ts to reconstruct args using helper
[ ] 4. Update resolution.ts to use same reconstruction
[ ] 5. Test complete flow: create → bet → resolve → claim
[ ] 6. Verify tokens are unique per market
[ ] 7. Update documentation
```

---

## Decision #2: Proportional Redemption vs 1:1 Token Payout

**Date**: 2025-11-11
**Status**: ✅ RESOLVED
**Decision**: Proportional redemption based on available escrow

### Problem Statement

Virtual liquidity (1000 tokens) creates phantom value for pricing but isn't backed by real CKB in escrow.

**Example**:
- Market capacity: 420 CKB (300 initial + 120 from bet)
- Structural minimum: 280 CKB
- Available escrow: 140 CKB
- Tokens minted: 240 NO tokens (using CSMM with virtual 1000)
- If 1:1 redemption: 240 tokens × 1 CKB = 240 CKB needed
- But only 140 CKB available! ❌

### Solution Chosen

**Proportional Redemption**:
```typescript
availableEscrow = marketCapacity - MIN_MARKET_CAPACITY;
actualWinningSupply = actual YES/NO token supply (no virtual);
redemptionRate = availableEscrow / actualWinningSupply;
userPayout = (userTokens / actualWinningSupply) × availableEscrow;
```

**Result**:
- 240 tokens redeem for 140 CKB total
- Redemption rate: 0.583 CKB/token (not 1:1)
- Each token holder gets proportional share of available escrow

### Key Insight

Virtual liquidity is **phantom value** - it affects token minting prices but doesn't exist in escrow. Winners can't redeem at 1:1 because that CKB was never deposited.

**Implementation**: [src/resolution.ts:286-309](src/resolution.ts)

---

## Template for Future Decisions

```markdown
## Decision #X: [Decision Title]

**Date**: YYYY-MM-DD
**Status**: 🟡 PENDING / ✅ RESOLVED / ❌ REJECTED
**Related Files**: ...

### Problem Statement
[What problem are we solving?]

### Solution Options
[List 2-3 options with pros/cons]

### Recommendation
[Which option and why?]

### Open Questions
[Questions for discussion]

### Implementation Plan
[Step-by-step if decided]
```

---

**Note**: This is a living document. Update it whenever making significant design decisions.
