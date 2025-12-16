# CKB Prediction Market - Devnet Testing

Working Rust test suite for testing the complete prediction market workflow on devnet.

## ✅ Verified Working

All tests pass successfully on devnet:
- Create market cell
- Mint token pairs (YES + NO)
- Resolve market
- Claim winning tokens

## Quick Start

### 1. Ensure Devnet is Running

```bash
# Check devnet status
curl -s http://127.0.0.1:8114 -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"get_tip_block_number","params":[],"id":1}'
```

If not running, start it with `offckb node`.

### 2. Run the Test Suite

```bash
cd /home/ali/prediction-market/devnet
cargo run
```

### 3. Expected Output

```
=== Market Contract Test Suite ===

Connected to devnet at http://127.0.0.1:8114
Current block height: 8582

Market code hash: 0xfe3a71...
Always-success code hash: 0x21854a...

Lock script hash: 0x7de82d...

=== Step 1: Create Market Cell ===
  Building transaction...
  Collected 1 fee cells
  Waiting for confirmation...
  TX: 0x53088e94...
Market created!

=== Step 2: Mint 10 Tokens ===
  Building transaction...
  Waiting for confirmation...
  TX: 0xda10d3e1...
Minted 10 YES + 10 NO tokens!

=== Step 3: Resolve Market (YES wins) ===
  Building transaction...
  Waiting for confirmation...
  TX: 0x58bed227...
Market resolved: YES wins!

=== Step 4: Claim 5 Winning Tokens ===
  Building transaction...
  Waiting for confirmation...
  TX: 0xa470428f...
Claimed 5 YES tokens for 500 CKB!

=== All Tests Passed! ===
```

## Test Details

### Account
- Private key: `6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6`
- Pre-funded with 420M CKB (offckb Account #0)

### Contract Addresses (Devnet)
```rust
Market:
  - Code Hash: 0xfe3a71cfcb556500e7f760b5c853be8fc082d32748aa9e5a98e25d79d4116485
  - TX Hash: 0x6c88542e395d308dc6e08b745473dce80e06ae06e50c69221b54508c5b5335d5

Always-Success:
  - Code Hash: 0x21854a7b67a2c4a71a8558c6d4023cf787e71db49d09cb4aa8748dbf6a8ef6ec
  - TX Hash: 0x0cc42f03d73e685843da66a6f049107634986572802eb8d0363e7e662125d077

Secp256k1 Dep Group:
  - TX Hash: 0x75be96e1871693f030db27ddae47890a28ab180e88e36ebb3575d9f1377d3da7
```

## Architecture

### Market Data Structure (34 bytes)
```rust
struct MarketData {
    yes_supply: u128,    // 16 bytes
    no_supply: u128,     // 16 bytes
    resolved: bool,      // 1 byte
    outcome: bool,       // 1 byte
}
```

### Transaction Patterns

**1. Create Market**
- Input: Fee cells
- Output: Market cell (128 CKB) + Change
- Data: `MarketData { yes: 0, no: 0, resolved: false, outcome: false }`

**2. Mint Tokens**
- Input: Market cell + Fee cells (100 CKB per token)
- Output: Market cell (capacity increased) + Change
- Validation: Equal YES and NO minting, exact collateral

**3. Resolve Market**
- Input: Market cell + Fee cells
- Output: Market cell (same capacity) + Change
- Validation: Set resolved=true, specify outcome

**4. Claim Winnings**
- Input: Market cell + Fee cells
- Output: Market cell (capacity decreased) + Change (receives claimed CKB)
- Validation: Only winning tokens can be claimed, 100 CKB per token

## Key Implementation Details

### Critical Fixes Applied

1. **ResponseFormat Access** (line 241):
   ```rust
   let inner = match tx.inner {  // Use tx.inner, not tx
       ckb_jsonrpc_types::Either::Left(view) => view,
       ckb_jsonrpc_types::Either::Right(_) => return Err(...),
   };
   ```

2. **RecoveryId Conversion** (line 635):
   ```rust
   signature[64] = i32::from(rec_id) as u8;  // For secp256k1 0.30
   ```

3. **Witness Structure**:
   - First witness for market cell: Dummy 65-byte signature
   - Subsequent witnesses for fee cells: Real signatures

### Helper Functions

**collect_cells**: Gathers sufficient cells for capacity
**get_cell**: Retrieves cell data from transaction
**sign_transaction**: Signs all fee-only inputs
**sign_transaction_with_market**: Signs with market cell as first input
**send_transaction**: Submits and waits for confirmation

## Customizing Tests

Edit `src/main.rs` to customize:

```rust
// Change mint amount (line 110)
mint_tokens(&mut client, &privkey, &contracts, &lock_script, market_outpoint, 20)?;

// Change resolution outcome (line 114)
resolve_market(&mut client, &privkey, &contracts, &lock_script, market_outpoint, false)?;  // NO wins

// Change claim amount (line 118)
claim_tokens(&mut client, &privkey, &contracts, &lock_script, market_outpoint, 8)?;
```

## Troubleshooting

### "Insufficient balance"
- Ensure you're using the correct private key
- Check devnet is using offckb default accounts

### "Transaction not found"
- Wait a few seconds for block confirmation
- Check devnet is mining blocks

### "Cell not found"
- Ensure contracts are deployed: `offckb my-scripts`
- Redeploy if needed: `offckb deploy`

### "Invalid signature"
- Verify private key is correct
- Check witness structure matches input order

## Dependencies

```toml
[dependencies]
ckb-sdk = "3"
ckb-types = "0.200"
ckb-hash = "0.200"
ckb-jsonrpc-types = "0.200"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
hex = "0.4"
anyhow = "1"
secp256k1 = "0.30"
```

## Framework Documentation

This implementation uses the **standard ckb-sdk-rust transaction building framework** documented in:
- `.claude/skills/ckb-knowledge/SKILL.md` - Complete framework reference
- Includes all helper functions, signing patterns, and cell collection logic

## Next Steps

After successful devnet testing:
1. Deploy contracts to testnet
2. Update contract hashes in code
3. Run same tests on testnet
4. Deploy to mainnet when ready

---

**Status**: ✅ All tests passing on devnet (tested 2025-12-13)
