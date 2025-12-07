# Project Progress Log

## Session: December 7, 2025

### Completed Milestones

#### Phase 1: Contract Development ✅
- [x] Market contract implementation (Rust)
- [x] Token contract implementation (Rust)
- [x] Capacity validation (1 CKB = 1 token collateral)
- [x] Equal YES/NO minting enforcement
- [x] Market supply tracking

#### Phase 2: Local Testing ✅
- [x] ckb-debugger setup and configuration
- [x] Fixed atomic instructions issue (`-C target-feature=-a`)
- [x] Created mock transaction files
- [x] Validated all three type scripts locally:
  - Market contract
  - YES token contract
  - NO token contract

#### Phase 3: Testnet Deployment ✅
- [x] Generated testnet key and address
- [x] Funded address with CKB from faucet (200k CKB total)
- [x] Deployed market contract: `0x909becfd...`
- [x] Deployed token contract: `0x44ba3ce4...`
- [x] Created initial market cell: `0x4f666a10...`
- [x] Fixed code hash calculation bugs
- [x] Successfully minted 100 YES + 100 NO tokens

### Technical Achievements

#### Bug Fixes
1. **Atomic Instructions Error**
   - Problem: CKB-VM doesn't support RISC-V A extension
   - Solution: Added rustflags `-C target-feature=-a` to `.cargo/config.toml`

2. **Type Script Hash Confusion**
   - Problem: Using code_hash instead of type script hash in token args
   - Solution: Use `typeScript.hash()` not `typeScript.codeHash`

3. **Capacity Unit Mismatch**
   - Problem: Comparing shannons to token count
   - Solution: Convert tokens to shannons (× 100,000,000) before validation

4. **Malformed Code Hashes**
   - Problem: `ccc.hashCkb()` returning string, then `Array.from()` converting characters
   - Solution: Type-check and handle string vs Uint8Array properly

5. **Insufficient Token Cell Capacity**
   - Problem: 61 CKB too small for lock + type + data
   - Solution: Increased to 150 CKB per token cell

#### Contract Architecture

**Market Cell:**
- Type script enforces collateralization rules
- Data: 34 bytes (yes_supply + no_supply + resolved + outcome)
- Capacity increases by exactly the CKB deposited
- Acts as escrow for all collateral

**Token Cells:**
- Type script identifies market via type hash in args
- Args format: `[32-byte market hash][1-byte token ID]`
- Token ID: 0x01 = YES, 0x02 = NO
- Data: 16 bytes (u128 token amount)
- Each cell needs ~150 CKB capacity

### Deployment Details

**Network:** CKB Pudge Testnet

**Address:** `ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqwq6072ngzarpg9apuhptlqm9s9y9d6w6qwges4n`

**Contracts Deployed:**
| Contract | TX Hash | Code Hash |
|----------|---------|-----------|
| Market | `0x909becfd148b9b0ddabc98f244a98abcd2360fcf94107432068dca01a2e010e4` | `0x37402b2f7c5b30611d34bad3b76b9f3607aa297213525d998159a6f7c7fd9421` |
| Token | `0x44ba3ce43127972ab03daa9507947c7e14ea6ef92f043524395536a532e563d6` | `0x54f68c08a051facc261167d0a45383cc5fa8b1ea7d1f9d9be5a7e623e27a1320` |

**Market Cell:**
- TX: `0x4f666a10114a564c25a0f09b7ea64f3787722f922403c8971ad079f666eb785b`
- Type Hash: `0xa9e40b899b3d3e902e0b3e804d1b9a0a2410741dfd41959db5f741a10a315b7d`

**First Minting:**
- TX: `0x6d378b2f41aa5cb7c64f63ad89b200a67c0de8fe200fa39025c1c15f2c9f5736`
- Minted: 100 YES + 100 NO tokens
- Collateral: 100 CKB deposited to market
- Explorer: https://pudge.explorer.nervos.org/transaction/0x6d378b2f41aa5cb7c64f63ad89b200a67c0de8fe200fa39025c1c15f2c9f5736

### Scripts Implemented

1. **generate-key.js** - Generate testnet key/address
2. **deploy-simple.js** - Deploy both contracts
3. **create-market.js** - Create initial market cell
4. **deploy-token.js** - Deploy token contract
5. **mint-tokens.js** - Mint YES/NO token pairs

### Testing Strategy

**Local Testing (ckb-debugger):**
- Created complete mock transactions
- Tested all validation paths
- Enabled debug output with `-C debug-assertions=on`
- All contracts pass validation

**Testnet Testing:**
- Deployed real contracts
- Created real market
- Successfully executed minting transaction
- All validations passed on-chain

### Key Learnings

1. **CKB Development:**
   - Always disable atomic instructions for CKB-VM compatibility
   - Type script hash ≠ code hash (hash of entire script vs just code)
   - Capacity must cover lock + type + data + molecule overhead
   - 1 CKB = 100,000,000 shannons (important for validation)

2. **CCC Library:**
   - `ccc.hashCkb()` can return string or Uint8Array
   - Always type-check before hex conversion
   - `Transaction.from()` requires plain objects
   - Cell deps must include all referenced contracts

3. **Testing:**
   - ckb-debugger only validates individual type scripts
   - Mock transactions must match on-chain format exactly
   - Test locally before deploying (saves CKB/time)

### Current State

**Working Features:**
- ✅ Complete Set minting (YES + NO tokens)
- ✅ Collateralization enforcement (1 token = 1 CKB)
- ✅ Market supply tracking
- ✅ Type script validation

**Not Yet Implemented:**
- ⏳ Burning (redeem complete set → CKB)
- ⏳ Resolution (mark market outcome)
- ⏳ Claiming (redeem winning tokens)
- ⏳ Trading (transfer tokens)
- ⏳ Multiple markets

### Next Steps

1. Implement burning functionality (reverse of minting)
2. Add resolution mechanism (owner/oracle sets outcome)
3. Implement claiming for winners
4. Add proper error handling and edge cases
5. Build frontend interface
6. Security audit

### Cost Analysis

**Per Complete Set (1 YES + 1 NO):**
- Collateral: 1 CKB (locked in market)
- Token cells: 300 CKB (150 × 2, refundable)
- Transaction fee: ~1 CKB
- **Total cost:** ~302 CKB per token pair

**For 100 tokens:**
- Collateral: 100 CKB
- Token cells: 30,000 CKB (refundable on redemption)
- Fees: ~1 CKB
- **Total:** ~30,101 CKB

### Files Modified/Created

**Contracts:**
- `contracts/market/src/main.rs` - Market validation logic
- `contracts/market/.cargo/config.toml` - Disable atomic instructions
- `contracts/market-token/src/main.rs` - Token validation logic
- `contracts/market-token/.cargo/config.toml` - Disable atomic instructions

**Scripts:**
- `scripts/generate-key.js` - New
- `scripts/deploy-simple.js` - New
- `scripts/create-market.js` - New
- `scripts/deploy-token.js` - New
- `scripts/mint-tokens.js` - New
- `scripts/deployed.json` - Generated
- `scripts/.env` - Generated (not committed)

**Documentation:**
- `API_DOCUMENTATION.md` - New (comprehensive API reference)
- `PROGRESS.md` - This file

### Git Commits

See commit history for detailed changes.

---

**Status:** Phase 1 complete - Basic minting functionality working on testnet!
