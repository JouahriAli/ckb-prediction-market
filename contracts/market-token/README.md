# Market Token Type Script

Custom UDT type script for prediction market YES/NO tokens.

## Overview

This type script validates that YES and NO tokens can only be:
- **Minted** in equal amounts when depositing CKB to the market
- **Burned** in equal amounts (complete sets) before resolution
- **Burned** individually (winning tokens only) after resolution for payouts

## Type Script Args Structure

```
Bytes 0-31:  market_type_hash (32 bytes)  // Hash of the market type script
Byte 32:     token_id (1 byte)            // 0x01 = YES, 0x02 = NO
```

## Token Cell Structure

```
Token Cell {
  capacity: u64,
  lock: user_lock,           // User owns these tokens
  type: {
    code_hash: TOKEN_SCRIPT_CODE_HASH,
    hash_type: "data1",
    args: market_type_hash + token_id
  },
  data: u128 (16 bytes LE)   // Token amount
}
```

## Validation Rules

### Minting (output > input)
1. Market cell must be in inputs and outputs
2. Token supply increase in market data matches minted amount
3. Equal YES and NO tokens must be minted
4. Market must not be resolved

### Burning Complete Set (output < input, market not resolved)
1. Equal YES and NO tokens must be burned
2. Token supply decrease in market data matches burned amount
3. Market must not be resolved

### Claiming Payout (output < input, market resolved)
1. Can only burn winning tokens (YES if outcome=true, NO if outcome=false)
2. Token supply decrease matches burned amount
3. Losing side supply must not change

### Transfer (output == input)
- No validation needed, tokens just moving between users

## Building

### Prerequisites
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install RISC-V target
rustup target add riscv64imac-unknown-none-elf
```

### Build Contract
```bash
cd contracts/market-token
make build
```

The compiled binary will be in `build/market-token.patched`.

### Check Size
```bash
make size
```

### Clean
```bash
make clean
```

## Error Codes

- `10`: Invalid token ID (must be 0x01 or 0x02)
- `11`: Market cell not found in transaction
- `12`: Supply mismatch (market data doesn't match token amounts)
- `13`: Unequal minting (YES and NO must be minted equally)
- `14`: Unequal burning (complete sets require equal YES and NO)
- `15`: Burning losing tokens (can only burn winning tokens after resolution)
- `16`: Invalid market state (unexpected state change)

## Security

This type script enforces the complete set mechanism by:
1. **Double validation**: Both YES and NO scripts check that the other was also minted/burned
2. **Market data sync**: Validates that market cell data matches actual token operations
3. **Resolution check**: Different rules before/after market resolution
4. **Overflow protection**: Uses checked arithmetic throughout

## Integration

The token type script works with the market cell (which has a separate type script or owner lock).
Together they enforce:
- Complete set minting: 1 CKB → 1 YES + 1 NO
- Complete set burning: 1 YES + 1 NO → 1 CKB (before resolution)
- Proportional payouts: winning tokens → CKB share (after resolution)

## Testing

Run tests with:
```bash
cargo test
```

Note: Tests require implementing mock syscalls for the CKB environment.

## Deployment

1. Build the contract
2. Deploy to a cell on CKB devnet/testnet
3. Use the cell's outpoint as a cell_dep in transactions
4. Reference the contract by data hash when creating tokens

Example:
```typescript
const tokenTypeScript = {
  code_hash: "0x...",  // Hash of the contract code
  hash_type: "data1",
  args: marketTypeHash + "01"  // Market hash + YES token ID
};
```
