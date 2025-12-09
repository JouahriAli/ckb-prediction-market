# Security Test Results

All security tests performed on CKB Pudge devnet to validate market and token contract security.

## Test Summary

| Attack Vector | Script | Result | Error Code | Description |
|--------------|--------|--------|------------|-------------|
| Drain Market | `attack-drain.sh` | ✅ BLOCKED | Market Error 14 | Attempted to reduce market capacity without burning tokens |
| Hijack Lock | `attack-hijack-lock.sh` | ✅ BLOCKED | Market Error 15 | Attempted to change market lock script from always-success to secp256k1 |
| Unequal Minting | `attack-unequal-mint.sh` | ✅ BLOCKED | Token Error 13 | Attempted to mint 100 YES but only 50 NO tokens |
| Change Market Args | `attack-change-market-args.sh` | ✅ BLOCKED | Market Error 11 | Attempted to change market type script args |
| Tokens Without Market | `attack-tokens-no-market.sh` | ✅ BLOCKED | Token Error 11 | Attempted to create tokens without market cell in inputs |

## Detailed Test Results

### 1. Drain Market Attack

**Attack**: Reduce market capacity from 10,128 CKB to 128 CKB without burning tokens, stealing 9,999 CKB.

**Transaction**:
- Input: Market cell with 10,128 CKB, 100 YES + 100 NO supply
- Output 1: Market cell with 128 CKB, still 100 YES + 100 NO supply
- Output 2: 9,999 CKB to attacker's address

**Result**: ❌ REJECTED with `Error::InsufficientCollateral` (error 14)

**Contract Logic**: Market contract enforces collateralization at 100 CKB per token unit (contracts/market/src/main.rs:253-256)

```rust
if output_capacity < input_capacity {
    return Err(Error::InsufficientCollateral);
}
```

---

### 2. Lock Hijacking Attack

**Attack**: Change market cell's lock script from always-success to attacker's secp256k1 lock, gaining control of the market.

**Transaction**:
- Input: Market cell with always-success lock
- Output: Market cell with secp256k1 lock (attacker controlled)

**Result**: ❌ REJECTED with `Error::LockScriptChanged` (error 15)

**Contract Logic**: Market contract validates lock preservation (contracts/market/src/main.rs:202-216)

```rust
fn validate_lock_preserved() -> Result<(), Error> {
    let input_lock = load_market_lock(Source::Input)?;
    let output_lock = load_market_lock(Source::Output)?;

    if input_lock.as_slice() != output_lock.as_slice() {
        return Err(Error::LockScriptChanged);
    }
    Ok(())
}
```

---

### 3. Unequal Minting Attack

**Attack**: Mint 100 YES tokens but only 50 NO tokens, breaking the equal supply invariant.

**Transaction**:
- Input: Market cell with 100 YES + 100 NO supply
- Output: Market cell with 200 YES + 150 NO supply (unequal increase!)

**Result**: ❌ REJECTED with `Error::UnequalMinting` (error 13)

**Contract Logic**: Token contract enforces equal YES/NO minting (contracts/market-token/src/main.rs:218-220)

```rust
if yes_increase != no_increase {
    debug!("Unequal minting: YES {}, NO {}", yes_increase, no_increase);
    return Err(Error::UnequalMinting);
}
```

---

### 4. Market Type Script Args Change Attack

**Attack**: Change market type script args from `0x` to `0xdeadbeef`, effectively creating a different market.

**Transaction**:
- Input: Market cell with type script args `0x`
- Output: Market cell with type script args `0xdeadbeef`

**Result**: ❌ REJECTED with `Error::MultipleMarketCells` (error 11)

**Why It Failed**: When type script args change, the output has a different type script hash. The market contract only counts cells with **matching** type scripts, so it sees:
- 1 market cell in inputs (with args `0x`)
- 0 market cells in outputs (different type script due to changed args)

This violates the requirement for exactly 1 output market cell (contracts/market/src/main.rs:325-327).

**CKB Property**: Type script identity (code_hash + hash_type + args) is enforced by CKB's type script mechanism. Each type script only validates cells with matching type script hashes.

---

### 5. Create Tokens Without Market Cell Attack

**Attack**: Create YES/NO token cells without having the market cell in inputs, bypassing all market validation.

**Transaction**:
- Input: Regular CKB cell (NOT a market cell)
- Output 1: 100 YES tokens
- Output 2: 100 NO tokens

**Result**: ❌ REJECTED with `Error::MarketCellNotFound` (error 11)

**Contract Logic**: Token contract requires the market cell to be present in both inputs and outputs (contracts/market-token/src/main.rs:133-137)

```rust
let market_in = find_market_cell(Source::Input)?
    .ok_or(Error::MarketCellNotFound)?;
let market_out = find_market_cell(Source::Output)?
    .ok_or(Error::MarketCellNotFound)?;
```

---

## Security Properties Validated

### Market Contract (contracts/market/src/main.rs)

✅ **Lock Preservation**: Market lock script cannot be changed (prevents hijacking)

✅ **Collateral Enforcement**: Capacity must be >= 128 CKB + (100 CKB × total supply)

✅ **Single Market Cell**: Exactly 1 market cell in inputs and outputs

✅ **Type Script Immutability**: Type script args cannot be changed (CKB property)

### Token Contract (contracts/market-token/src/main.rs)

✅ **Equal Minting**: YES and NO supply must increase equally

✅ **Market Cell Required**: Market cell must be present in inputs and outputs

✅ **Supply Synchronization**: Token supply changes must match market supply changes

---

## Error Codes

### Market Contract Errors
- Error 10: InvalidMarketData - Resolution not implemented
- Error 11: MultipleMarketCells - Must have exactly 1 market cell
- Error 12: SupplyDecrease - Supply cannot decrease (burning not implemented)
- Error 13: UnequalSupplyIncrease - YES and NO must increase equally
- Error 14: InsufficientCollateral - Capacity doesn't match token supply
- Error 15: LockScriptChanged - Lock script was modified

### Token Contract Errors
- Error 10: InvalidTokenId - Token must be YES (0x01) or NO (0x02)
- Error 11: MarketCellNotFound - Market cell missing in inputs/outputs
- Error 12: SupplyMismatch - Token supply doesn't match market supply
- Error 13: UnequalMinting - YES/NO minting amounts don't match
- Error 14: UnequalBurning - YES/NO burning amounts don't match (not implemented)
- Error 15: BurningLosingTokens - Cannot burn winning tokens after resolution
- Error 16: InvalidMarketState - Market state is invalid

---

## Conclusion

All 5 attack vectors were successfully blocked by the contract validation logic. The prediction market contracts properly enforce:

1. Collateralization requirements (100 CKB per token)
2. Lock script preservation (prevents hijacking)
3. Equal YES/NO supply (fundamental market invariant)
4. Type script immutability (prevents market switching)
5. Market cell dependency (prevents unauthorized token creation)

The contracts are secure against common attack vectors for the minting phase. Additional testing would be needed for the burning and resolution phases once implemented.
