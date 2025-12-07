# Type Script Architecture for Prediction Market

## Overview

The prediction market requires **two custom type scripts**:
1. **Market Cell Type Script**: Validates market state transitions
2. **Market Token Type Script**: Validates YES/NO token operations

Both scripts work together to enforce the complete set mechanism trustlessly.

## 1. Market Cell Type Script

### Cell Structure

```
Market Cell {
  capacity: u64,              // CKB pool (varies with deposits/withdrawals)
  lock: AlwaysSuccess,        // Anyone can spend (validation in type script)
  type: MarketTypeScript,     // Enforces all market rules
  data: MarketData            // Serialized market state
}
```

### MarketData Structure (Molecule encoding)

```rust
// Using Molecule serialization format
table MarketData {
    yes_supply: Uint128,        // Total YES tokens minted
    no_supply: Uint128,         // Total NO tokens minted
    ckb_pool: Uint64,           // Tracked CKB pool (capacity - structural minimum)
    resolved: byte,             // 0 = unresolved, 1 = resolved
    outcome: byte,              // 0 = NO wins, 1 = YES wins, 2 = unset
    deadline: Uint64,           // Unix timestamp
    resolver_lock_hash: Byte32, // Who can resolve this market
    yes_token_id: byte,         // Token identifier for YES (e.g., 0x01)
    no_token_id: byte,          // Token identifier for NO (e.g., 0x02)
}
```

### Type Script Args

```rust
struct MarketTypeScriptArgs {
    market_id: [u8; 32],  // Unique market identifier (derived from first input)
}
```

**Market ID Generation:**
- Use Type ID pattern: `hash(first_input_outpoint || output_index)`
- Guarantees uniqueness
- Can be computed deterministically

### Validation Logic

```rust
fn main() -> Result<i8, Error> {
    // Load script args
    let args = load_script_args()?;
    let market_id = parse_market_id(&args)?;

    // Find market cells in inputs and outputs
    let market_input = find_market_cell_input()?;
    let market_output = find_market_cell_output()?;

    // Determine operation type
    let operation = determine_operation(&market_input, &market_output)?;

    match operation {
        Operation::Create => validate_market_creation(&market_output, &market_id),
        Operation::MintCompleteSet => validate_mint(&market_input, &market_output),
        Operation::BurnCompleteSet => validate_burn(&market_input, &market_output),
        Operation::Resolve => validate_resolution(&market_input, &market_output),
        Operation::Claim => validate_claim(&market_input, &market_output),
    }
}
```

### Operation 1: Market Creation

```rust
fn validate_market_creation(
    market_output: &MarketCell,
    market_id: &[u8; 32]
) -> Result<i8, Error> {
    let data = parse_market_data(market_output.data)?;

    // 1. Initial state must be empty
    require(data.yes_supply == 0, "YES supply must start at 0")?;
    require(data.no_supply == 0, "NO supply must start at 0")?;
    require(data.ckb_pool == 0, "CKB pool must start at 0")?;

    // 2. Must be unresolved
    require(data.resolved == 0, "Must be unresolved")?;
    require(data.outcome == 2, "Outcome must be unset")?;

    // 3. Deadline must be in the future
    let current_time = load_header_epoch()?;
    require(data.deadline > current_time, "Deadline must be future")?;

    // 4. Resolver must be set
    require(!is_zero_hash(&data.resolver_lock_hash), "Resolver required")?;

    // 5. Token IDs must be set and different
    require(data.yes_token_id != 0, "YES token ID required")?;
    require(data.no_token_id != 0, "NO token ID required")?;
    require(data.yes_token_id != data.no_token_id, "Token IDs must differ")?;

    // 6. Capacity must be sufficient for structural minimum
    require(market_output.capacity >= MIN_MARKET_CAPACITY, "Insufficient capacity")?;

    Ok(0)
}
```

### Operation 2: Mint Complete Set

```rust
fn validate_mint(
    market_input: &MarketCell,
    market_output: &MarketCell,
) -> Result<i8, Error> {
    let data_in = parse_market_data(market_input.data)?;
    let data_out = parse_market_data(market_output.data)?;

    // 1. Market must not be resolved
    require(data_in.resolved == 0, "Market already resolved")?;

    // 2. Deadline not passed
    let current_time = load_header_epoch()?;
    require(current_time < data_in.deadline, "Deadline passed")?;

    // 3. Calculate minted amounts
    let yes_minted = data_out.yes_supply - data_in.yes_supply;
    let no_minted = data_out.no_supply - data_in.no_supply;

    // 4. Must mint equal YES and NO
    require(yes_minted == no_minted, "Must mint equal YES/NO")?;
    require(yes_minted > 0, "Must mint positive amount")?;

    // 5. CKB pool must increase by minted amount
    let pool_increase = data_out.ckb_pool - data_in.ckb_pool;
    require(pool_increase == yes_minted, "Pool must match minted amount")?;

    // 6. Capacity must increase by at least pool increase
    let capacity_increase = market_output.capacity - market_input.capacity;
    require(capacity_increase >= pool_increase, "Capacity must increase")?;

    // 7. Invariant: pool = (yes_supply + no_supply) / 2
    let expected_pool = (data_out.yes_supply + data_out.no_supply) / 2;
    require(data_out.ckb_pool == expected_pool, "Pool invariant violated")?;

    // 8. Verify tokens were actually minted (checked by token type script)
    // Token type script will validate this

    Ok(0)
}
```

### Operation 3: Burn Complete Set

```rust
fn validate_burn(
    market_input: &MarketCell,
    market_output: &MarketCell,
) -> Result<i8, Error> {
    let data_in = parse_market_data(market_input.data)?;
    let data_out = parse_market_data(market_output.data)?;

    // 1. Market must not be resolved
    require(data_in.resolved == 0, "Market already resolved")?;

    // 2. Calculate burned amounts
    let yes_burned = data_in.yes_supply - data_out.yes_supply;
    let no_burned = data_in.no_supply - data_out.no_supply;

    // 3. Must burn equal YES and NO
    require(yes_burned == no_burned, "Must burn equal YES/NO")?;
    require(yes_burned > 0, "Must burn positive amount")?;

    // 4. CKB pool must decrease by burned amount
    let pool_decrease = data_in.ckb_pool - data_out.ckb_pool;
    require(pool_decrease == yes_burned, "Pool must match burned amount")?;

    // 5. Capacity must decrease by at least pool decrease
    let capacity_decrease = market_input.capacity - market_output.capacity;
    require(capacity_decrease >= pool_decrease, "Capacity must decrease")?;

    // 6. Invariant: pool = (yes_supply + no_supply) / 2
    let expected_pool = (data_out.yes_supply + data_out.no_supply) / 2;
    require(data_out.ckb_pool == expected_pool, "Pool invariant violated")?;

    // 7. Verify tokens were actually burned (checked by token type script)

    Ok(0)
}
```

### Operation 4: Resolution

```rust
fn validate_resolution(
    market_input: &MarketCell,
    market_output: &MarketCell,
) -> Result<i8, Error> {
    let data_in = parse_market_data(market_input.data)?;
    let data_out = parse_market_data(market_output.data)?;

    // 1. Market must not already be resolved
    require(data_in.resolved == 0, "Already resolved")?;

    // 2. Deadline must have passed
    let current_time = load_header_epoch()?;
    require(current_time >= data_in.deadline, "Deadline not reached")?;

    // 3. Output must be resolved
    require(data_out.resolved == 1, "Must set resolved flag")?;

    // 4. Outcome must be valid (0 or 1, not 2)
    require(data_out.outcome <= 1, "Invalid outcome value")?;

    // 5. Resolver signature must be present
    require(verify_resolver_signature(&data_in.resolver_lock_hash)?, "Invalid resolver")?;

    // 6. Supplies must not change
    require(data_in.yes_supply == data_out.yes_supply, "YES supply changed")?;
    require(data_in.no_supply == data_out.no_supply, "NO supply changed")?;

    // 7. Pool must not change
    require(data_in.ckb_pool == data_out.ckb_pool, "Pool changed")?;

    // 8. Deadline, resolver, and token IDs must not change
    require(data_in.deadline == data_out.deadline, "Deadline changed")?;
    require(data_in.resolver_lock_hash == data_out.resolver_lock_hash, "Resolver changed")?;
    require(data_in.yes_token_id == data_out.yes_token_id, "YES token ID changed")?;
    require(data_in.no_token_id == data_out.no_token_id, "NO token ID changed")?;

    Ok(0)
}

fn verify_resolver_signature(resolver_lock_hash: &[u8; 32]) -> Result<bool, Error> {
    // Check if any input has a lock matching the resolver
    let inputs_count = load_input_count()?;

    for i in 0..inputs_count {
        let lock = load_input_lock(i)?;
        let lock_hash = blake2b_hash(&lock);

        if lock_hash == resolver_lock_hash {
            // Found matching lock - its lock script will validate signature
            return Ok(true);
        }
    }

    Err(Error::ResolverNotFound)
}
```

### Operation 5: Claim Payout

```rust
fn validate_claim(
    market_input: &MarketCell,
    market_output: &MarketCell,
) -> Result<i8, Error> {
    let data_in = parse_market_data(market_input.data)?;
    let data_out = parse_market_data(market_output.data)?;

    // 1. Market must be resolved
    require(data_in.resolved == 1, "Market not resolved")?;

    // 2. Determine which side won
    let winning_side = if data_in.outcome == 1 {
        TokenType::YES
    } else {
        TokenType::NO
    };

    // 3. Calculate tokens burned and expected payout
    let (tokens_burned, supply_decrease) = match winning_side {
        TokenType::YES => {
            let burned = data_in.yes_supply - data_out.yes_supply;
            (burned, "YES")
        },
        TokenType::NO => {
            let burned = data_in.no_supply - data_out.no_supply;
            (burned, "NO")
        }
    };

    require(tokens_burned > 0, "Must burn tokens")?;

    // 4. Losing side supply must not change
    match winning_side {
        TokenType::YES => {
            require(data_in.no_supply == data_out.no_supply, "NO supply changed")?;
        },
        TokenType::NO => {
            require(data_in.yes_supply == data_out.yes_supply, "YES supply changed")?;
        }
    }

    // 5. Calculate expected payout (proportional)
    // payout = (tokens_burned * pool_in) / winning_supply_in
    let winning_supply = match winning_side {
        TokenType::YES => data_in.yes_supply,
        TokenType::NO => data_in.no_supply,
    };

    let expected_payout = (tokens_burned * data_in.ckb_pool) / winning_supply;

    // 6. Pool must decrease by expected payout
    let actual_payout = data_in.ckb_pool - data_out.ckb_pool;
    require(actual_payout == expected_payout, "Incorrect payout")?;

    // 7. Capacity must decrease by at least payout
    let capacity_decrease = market_input.capacity - market_output.capacity;
    require(capacity_decrease >= actual_payout, "Capacity decrease insufficient")?;

    // 8. Verify tokens were actually burned (checked by token type script)

    Ok(0)
}
```

---

## 2. Market Token Type Script

### Cell Structure

```
Token Cell {
  capacity: u64,              // Enough for cell structure + data
  lock: Script,               // User's lock (who owns these tokens)
  type: MarketTokenTypeScript,
  data: u128                  // Token amount (16 bytes, little-endian)
}
```

### Type Script Args

```rust
struct TokenTypeScriptArgs {
    market_type_hash: [u8; 32],  // Hash of the market type script
    token_id: u8,                // 0x01 = YES, 0x02 = NO
}
```

**Key Insight:** Token type script args include the market type hash, so:
- Different markets have different token types
- Tokens are market-specific
- Can't mix tokens from different markets

### Validation Logic

```rust
fn main() -> Result<i8, Error> {
    // Load script args
    let args = load_script_args()?;
    let market_type_hash = parse_market_type_hash(&args)?;
    let token_id = parse_token_id(&args)?;

    // Group inputs and outputs by this type script
    let input_amount = sum_input_tokens()?;
    let output_amount = sum_output_tokens()?;

    // Determine operation
    if output_amount > input_amount {
        // MINTING
        validate_minting(market_type_hash, token_id, input_amount, output_amount)
    } else if output_amount < input_amount {
        // BURNING
        validate_burning(market_type_hash, token_id, input_amount, output_amount)
    } else {
        // TRANSFER (no supply change)
        // No validation needed - just moving tokens between users
        Ok(0)
    }
}
```

### Minting Validation

```rust
fn validate_minting(
    market_type_hash: &[u8; 32],
    token_id: u8,
    input_amount: u128,
    output_amount: u128,
) -> Result<i8, Error> {
    let minted = output_amount - input_amount;

    // 1. Find market cell in inputs and outputs
    let market_input = find_market_cell_by_type_hash(market_type_hash, true)?;
    let market_output = find_market_cell_by_type_hash(market_type_hash, false)?;

    let data_in = parse_market_data(market_input.data)?;
    let data_out = parse_market_data(market_output.data)?;

    // 2. Verify this token ID matches market's token IDs
    let is_yes_token = token_id == data_in.yes_token_id;
    let is_no_token = token_id == data_in.no_token_id;
    require(is_yes_token || is_no_token, "Invalid token ID")?;

    // 3. Check supply increase in market data
    if is_yes_token {
        let yes_increase = data_out.yes_supply - data_in.yes_supply;
        require(yes_increase == minted, "YES supply mismatch")?;

        // 4. Verify equal NO tokens also minted
        let no_increase = data_out.no_supply - data_in.no_supply;
        require(yes_increase == no_increase, "Must mint equal YES/NO")?;

    } else { // is_no_token
        let no_increase = data_out.no_supply - data_in.no_supply;
        require(no_increase == minted, "NO supply mismatch")?;

        // 4. Verify equal YES tokens also minted
        let yes_increase = data_out.yes_supply - data_in.yes_supply;
        require(no_increase == yes_increase, "Must mint equal YES/NO")?;
    }

    // 5. Market type script will validate the rest (capacity, pool, etc.)

    Ok(0)
}
```

### Burning Validation

```rust
fn validate_burning(
    market_type_hash: &[u8; 32],
    token_id: u8,
    input_amount: u128,
    output_amount: u128,
) -> Result<i8, Error> {
    let burned = input_amount - output_amount;

    // 1. Find market cell in inputs and outputs
    let market_input = find_market_cell_by_type_hash(market_type_hash, true)?;
    let market_output = find_market_cell_by_type_hash(market_type_hash, false)?;

    let data_in = parse_market_data(market_input.data)?;
    let data_out = parse_market_data(market_output.data)?;

    // 2. Verify token ID
    let is_yes_token = token_id == data_in.yes_token_id;
    let is_no_token = token_id == data_in.no_token_id;
    require(is_yes_token || is_no_token, "Invalid token ID")?;

    // 3. Check if market is resolved
    if data_in.resolved == 0 {
        // BURNING COMPLETE SET (before resolution)

        if is_yes_token {
            let yes_decrease = data_in.yes_supply - data_out.yes_supply;
            require(yes_decrease == burned, "YES supply mismatch")?;

            // Must burn equal NO tokens
            let no_decrease = data_in.no_supply - data_out.no_supply;
            require(yes_decrease == no_decrease, "Must burn equal YES/NO")?;

        } else { // is_no_token
            let no_decrease = data_in.no_supply - data_out.no_supply;
            require(no_decrease == burned, "NO supply mismatch")?;

            // Must burn equal YES tokens
            let yes_decrease = data_in.yes_supply - data_out.yes_supply;
            require(no_decrease == yes_decrease, "Must burn equal YES/NO")?;
        }

    } else {
        // CLAIMING PAYOUT (after resolution)

        // Verify burning winning tokens only
        let winning_side = data_in.outcome; // 0 = NO, 1 = YES

        if is_yes_token {
            require(winning_side == 1, "Can only burn winning tokens")?;
            let yes_decrease = data_in.yes_supply - data_out.yes_supply;
            require(yes_decrease == burned, "YES supply mismatch")?;

            // NO supply must not change
            require(data_in.no_supply == data_out.no_supply, "NO supply changed")?;

        } else { // is_no_token
            require(winning_side == 0, "Can only burn winning tokens")?;
            let no_decrease = data_in.no_supply - data_out.no_supply;
            require(no_decrease == burned, "NO supply mismatch")?;

            // YES supply must not change
            require(data_in.yes_supply == data_out.yes_supply, "YES supply changed")?;
        }
    }

    // 4. Market type script will validate the rest (payout amount, pool, etc.)

    Ok(0)
}
```

---

## 3. Script Interaction Patterns

### Minting Complete Set Transaction

```
INPUTS:
  - Market cell (capacity: 1000 CKB, pool: 0, yes: 0, no: 0)
  - User CKB cells (500 CKB)

OUTPUTS:
  - Market cell (capacity: 1500 CKB, pool: 500, yes: 500, no: 500)
  - User YES token cell (500 tokens)
  - User NO token cell (500 tokens)
  - User change

VALIDATION FLOW:
1. Market type script runs:
   - Sees yes_supply: 0 → 500 (minting)
   - Sees no_supply: 0 → 500 (minting)
   - Sees pool: 0 → 500 (increased)
   - Sees capacity: 1000 → 1500 (increased by 500)
   - ✓ Validates: equal minting, pool matches, invariant holds

2. YES token type script runs:
   - Input amount: 0
   - Output amount: 500
   - Minting detected
   - Finds market cell, checks yes_supply increased by 500
   - Checks no_supply also increased by 500
   - ✓ Validates: equal minting

3. NO token type script runs:
   - Input amount: 0
   - Output amount: 500
   - Minting detected
   - Finds market cell, checks no_supply increased by 500
   - Checks yes_supply also increased by 500
   - ✓ Validates: equal minting

All scripts pass → Transaction valid
```

### Burning Complete Set Transaction

```
INPUTS:
  - Market cell (capacity: 1500 CKB, pool: 500, yes: 500, no: 500)
  - User YES token cell (200 tokens)
  - User NO token cell (200 tokens)

OUTPUTS:
  - Market cell (capacity: 1300 CKB, pool: 300, yes: 300, no: 300)
  - User CKB payout (200 CKB)

VALIDATION FLOW:
1. Market type script runs:
   - Sees yes_supply: 500 → 300 (burning)
   - Sees no_supply: 500 → 300 (burning)
   - Sees pool: 500 → 300 (decreased)
   - ✓ Validates: equal burning, pool matches

2. YES token type script runs:
   - Input amount: 200
   - Output amount: 0
   - Burning detected
   - Market not resolved (resolved = 0)
   - Checks yes_supply decreased by 200
   - Checks no_supply also decreased by 200
   - ✓ Validates: equal burning

3. NO token type script runs:
   - Input amount: 200
   - Output amount: 0
   - Burning detected
   - Market not resolved
   - Checks no_supply decreased by 200
   - Checks yes_supply also decreased by 200
   - ✓ Validates: equal burning

All scripts pass → Transaction valid
```

### Claiming Payout Transaction

```
INPUTS:
  - Market cell (capacity: 1500 CKB, pool: 500, yes: 300, no: 200, resolved: 1, outcome: 1)
  - User YES token cell (100 tokens)

OUTPUTS:
  - Market cell (capacity: 1333 CKB, pool: 333, yes: 200, no: 200)
  - User CKB payout (167 CKB)  // (100 / 300) * 500 = 166.67 ≈ 167

VALIDATION FLOW:
1. Market type script runs:
   - Market is resolved (outcome = YES)
   - Sees yes_supply: 300 → 200 (burning)
   - Sees no_supply: 200 → 200 (unchanged)
   - Calculates payout: (100 * 500) / 300 = 166.67
   - Sees pool: 500 → 333 (decreased by ~167)
   - ✓ Validates: correct proportional payout

2. YES token type script runs:
   - Input amount: 100
   - Output amount: 0
   - Burning detected
   - Market is resolved (resolved = 1)
   - Outcome = 1 (YES wins)
   - Burning YES tokens (winning side) ✓
   - Checks yes_supply decreased by 100
   - Checks no_supply unchanged
   - ✓ Validates: burning winning tokens only

All scripts pass → Transaction valid
```

---

## 4. Implementation Notes

### Constants

```rust
// Minimum market cell capacity (structural minimum)
const MIN_MARKET_CAPACITY: u64 = 280_00000000; // 280 CKB

// Token IDs
const YES_TOKEN_ID: u8 = 0x01;
const NO_TOKEN_ID: u8 = 0x02;

// MarketData states
const UNRESOLVED: u8 = 0;
const RESOLVED: u8 = 1;

// Outcome values
const OUTCOME_NO: u8 = 0;
const OUTCOME_YES: u8 = 1;
const OUTCOME_UNSET: u8 = 2;
```

### Helper Functions

```rust
// Find market cell by type script hash
fn find_market_cell_by_type_hash(
    type_hash: &[u8; 32],
    is_input: bool
) -> Result<Cell, Error> {
    let count = if is_input {
        load_input_count()?
    } else {
        load_output_count()?
    };

    for i in 0..count {
        let cell_type = if is_input {
            load_input_type(i)?
        } else {
            load_output_type(i)?
        };

        if let Some(type_script) = cell_type {
            let hash = blake2b_hash(&type_script);
            if hash == type_hash {
                return Ok(load_cell(i, is_input)?);
            }
        }
    }

    Err(Error::MarketCellNotFound)
}

// Sum token amounts from inputs/outputs
fn sum_input_tokens() -> Result<u128, Error> {
    let mut total = 0u128;
    let count = load_input_count()?;

    for i in 0..count {
        if is_same_type_script(i, true)? {
            let data = load_input_data(i)?;
            let amount = u128::from_le_bytes(data[0..16].try_into()?);
            total += amount;
        }
    }

    Ok(total)
}

fn sum_output_tokens() -> Result<u128, Error> {
    let mut total = 0u128;
    let count = load_output_count()?;

    for i in 0..count {
        if is_same_type_script(i, false)? {
            let data = load_output_data(i)?;
            let amount = u128::from_le_bytes(data[0..16].try_into()?);
            total += amount;
        }
    }

    Ok(total)
}
```

### Error Codes

```rust
enum Error {
    // Market errors (1xx)
    InvalidInitialState = 100,
    MarketAlreadyResolved = 101,
    DeadlinePassed = 102,
    DeadlineNotReached = 103,
    InvalidOutcome = 104,
    ResolverNotFound = 105,

    // Minting errors (2xx)
    UnequalMinting = 200,
    PoolMismatch = 201,
    InvariantViolated = 202,

    // Burning errors (3xx)
    UnequalBurning = 300,
    BurningLosingTokens = 301,

    // Claim errors (4xx)
    IncorrectPayout = 400,

    // Token errors (5xx)
    InvalidTokenId = 500,
    SupplyMismatch = 501,
    MarketCellNotFound = 502,

    // General errors
    ParseError = 900,
    InvalidArgs = 901,
}
```

---

## 5. Security Considerations

### Double-Spend Protection
- Market cell can only be spent once per transaction
- Type scripts validate state transitions atomically
- Cell model prevents double-spending inherently

### Reentrancy Protection
- Not applicable (no callbacks in UTXO model)
- Each transaction is atomic

### Integer Overflow
- Use checked arithmetic in Rust
- Validate amounts don't overflow u128

### Precision Loss
- Always multiply before divide
- Use 128-bit integers for token amounts

### Front-Running
- Market resolution requires deadline
- Cannot resolve early
- No MEV opportunities in minting/burning (deterministic pricing)

---

## 6. Testing Strategy

### Unit Tests (off-chain)
1. Test each operation validation function
2. Test edge cases (zero amounts, overflow, etc.)
3. Test error conditions

### Integration Tests (on-chain)
1. Deploy scripts to devnet
2. Test full transaction flows:
   - Create market
   - Mint complete sets
   - Burn complete sets
   - Resolve market
   - Claim payouts
3. Test attack scenarios:
   - Try to mint unequal YES/NO
   - Try to claim before resolution
   - Try to burn without returning CKB
   - Try to resolve early

### Fuzzing
1. Generate random valid/invalid transactions
2. Verify scripts accept valid and reject invalid
3. Look for edge cases

---

## 7. Gas Optimization

### Minimize Script Size
- Use compact Molecule encoding
- Avoid unnecessary checks
- Reuse helper functions

### Reduce Cycles
- Early exit on invalid conditions
- Cache frequently used values
- Use efficient algorithms

### Batch Operations
- Allow multiple claims in one transaction
- Process multiple markets if possible

---

## 8. Deployment Checklist

- [ ] Write type scripts in Rust
- [ ] Compile to RISC-V binary
- [ ] Test on devnet
- [ ] Security audit
- [ ] Deploy to testnet
- [ ] User testing
- [ ] Final audit
- [ ] Deploy to mainnet

---

## Summary

**Two type scripts work together:**

1. **Market Type Script**: Validates market state (supplies, pool, resolution)
2. **Token Type Script**: Validates token operations (minting, burning, transfers)

**Key invariant enforced by both:**
```
ckb_pool == (yes_supply + no_supply) / 2
yes_minted == no_minted (always equal)
```

**Security model:**
- Anyone can interact (lock = AlwaysSuccess)
- Type scripts enforce all rules
- Double validation (market + token scripts)
- Atomic state transitions

This design gives you a **trustless, permissionless prediction market** on CKB!
