# Deadline Enforcement - Design Notes

## The Problem

We want to prevent bets after the market deadline, but implementing this on-chain in Phase 1 has complications.

## Why TimeLock Doesn't Work for Market Cell

**Initial idea**: Use TimeLock as the market cell's lock script to prevent spending before deadline.

**Problem discovered**:
- TimeLock requires an "owner cell" to unlock
- Every bettor would need to include this owner cell in their betting transaction
- This creates coordination problems and complexity
- Only ONE transaction can consume the owner cell at a time
- Concurrent bets would fail

**Example flow that doesn't work**:
```
Market cell has TimeLock(ownerCellOutPoint, deadline)

Alice wants to bet:
  Inputs: [owner cell, market cell, Alice's CKB]

Bob wants to bet at same time:
  Inputs: [owner cell, market cell, Bob's CKB]  ← CONFLICT! Owner cell already spent
```

## Alternative Approaches

### Option 1: Off-Chain Enforcement (Phase 1 - Current)
- Store deadline in market data (as timestamp OR block number)
- Check deadline in betting.ts **before** building transaction
- **Trust assumption**: Market owner won't accept late bets
- **Pros**: Simple, works for MVP
- **Cons**: Not trustless

### Option 2: Type Script Validation (Phase 2 - Production)
- Write a custom type script for the market cell
- Type script validates:
  - Current block number < deadline (from market data)
  - OR market is already resolved (allow spending after deadline for resolution)
- **Pros**: Trustless, on-chain enforcement
- **Cons**: Requires writing Rust type script

### Option 3: Separate Resolution Lock (Advanced)
- Market cell has TWO locks:
  - Regular lock (for betting/updates)
  - TimeLock (for resolution, activated after deadline)
- Use CKB's anyone-can-pay or similar pattern
- **Pros**: Flexible
- **Cons**: Very complex

## Block Number vs Timestamp

### For CKB On-Chain Enforcement:

**Block Number** (Recommended):
- ✅ Deterministic, can't be manipulated
- ✅ Accessible in type scripts via transaction inputs
- ✅ ~8 seconds per block on CKB
- ❌ Users think in dates/times, not blocks

**Epoch**:
- ✅ Deterministic
- ✅ ~4 hours per epoch
- ❌ Too coarse-grained for prediction markets

**Timestamp**:
- ❌ Not directly accessible in type scripts
- ❌ Can be manipulated by miners (within bounds)
- ❌ Unreliable for on-chain enforcement

### Current Decision (Phase 1):

Store deadline as **Unix timestamp** in market data:
- Better UX (users understand dates)
- Enforce off-chain in betting.ts
- Phase 2: Convert timestamp → block number when creating market, enforce with type script

## Implementation Plan

### Phase 1 (Current - MVP)
```typescript
// MarketData
interface MarketData {
  deadline: bigint;  // Unix timestamp (seconds)
  // ... other fields
}

// In betting.ts
const currentTime = Math.floor(Date.now() / 1000);
if (currentTime > marketData.deadline) {
  throw new Error("Market closed - deadline passed");
}
```

### Phase 2 (Production)
```typescript
// MarketConfig
interface MarketConfig {
  question: string;
  deadline: bigint;           // Unix timestamp (for UX)
  initialCapacity: bigint;
}

// When creating market:
const currentBlock = await client.getTip();
const blocksUntilDeadline = estimateBlocksFromTime(deadline);
const deadlineBlock = currentBlock + blocksUntilDeadline;

// MarketData (stored on-chain)
interface MarketData {
  deadlineBlock: bigint;      // Block number (for type script)
  // ... other fields
}

// Type script (Rust):
// 1. Read deadlineBlock from market data
// 2. Read current block number from transaction context
// 3. If current_block >= deadlineBlock && !resolved: reject transaction
```

### Helper Function (Phase 2)
```typescript
function estimateBlocksFromTime(targetTimestamp: bigint): bigint {
  const now = Math.floor(Date.now() / 1000);
  const secondsUntil = Number(targetTimestamp) - now;
  const CKB_AVG_BLOCK_TIME = 8; // seconds
  return BigInt(Math.ceil(secondsUntil / CKB_AVG_BLOCK_TIME));
}
```

## Type Script Pseudo-Code (Phase 2)

```rust
// market_type_script.rs

// Load market data from cell
let market_data = decode_market_data(cell.data);

// Get current block number from transaction
let current_block = get_block_number();  // From transaction context

// Rule 1: No bets after deadline (unless resolving)
if current_block >= market_data.deadline_block {
    // Check if this is a resolution transaction
    if !is_resolution_tx() {
        return Err("Market closed - deadline passed");
    }
}

// Rule 2: Validate CSMM formula (if betting)
if is_betting_tx() {
    validate_csmm_pricing();
    validate_token_minting();
    validate_escrow_increase();
}

// Rule 3: Only owner can resolve
if is_resolution_tx() {
    validate_owner_signature();
}
```

## References

- CKB `since` field: Used in inputs, not directly in type scripts
- TimeLock script: Works for LOCK scripts, not suitable for shared cells
- Type scripts: Can access transaction context (block number, epoch)
- [CKB Transaction Structure RFC](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0022-transaction-structure/0022-transaction-structure.md)

## Decision Log

**2025-11-09**:
- Decided NOT to use TimeLock for market cell (coordination issues)
- Phase 1: Off-chain deadline check with timestamp
- Phase 2: Type script with block number enforcement
- Saved context in this file for future reference

---

**Status**: Deferred to Phase 2
**Blocker**: Need to learn type script development before implementing
**Current workaround**: Off-chain validation in betting.ts
