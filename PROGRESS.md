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
- Data: 35 bytes (token_code_hash[32] + hash_type[1] + resolved[1] + outcome[1])
- Capacity increases by exactly the CKB deposited
- Acts as escrow for all collateral
- Type ID validation ensures unique market identity

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
| Contract | TX Hash | Code Hash | Status |
|----------|---------|-----------|--------|
| Market (original) | `0x909becfd148b9b0ddabc98f244a98abcd2360fcf94107432068dca01a2e010e4` | `0x37402b2f7c5b30611d34bad3b76b9f3607aa297213525d998159a6f7c7fd9421` | Deprecated |
| Market (upgraded Dec 20) | `0x99ed92624f3183ad8f274d80b5845d48028d24e138ffe65e6a586ae39a442aa4` | `0xfe3a71cfcb556500e7f760b5c853be8fc082d32748aa9e5a98e25d79d4116485` | Deprecated |
| Market (upgraded Dec 24 old) | `0x8aa521d7063000d0aaae0cf48cb7c9641dbf4b1fe3bb2c98905732dad2db4f5a` | `0xd29655b59337923c9d1929f5dea5b37faac0bfa385fbaac85ffbe51fac25234e` | Deprecated |
| **Market (Dec 24 v2 - 35-byte)** | `0x5245d3227ee810c34f5a3beb00364e023803f20453de2b32de04af9e19c00590` | `0x5377ffaf1a41f5e79bd25f8d0e1eac411863a35de41be3db49350c584a16e60d` | **Active** |
| Token | `0x44ba3ce43127972ab03daa9507947c7e14ea6ef92f043524395536a532e563d6` | `0x54f68c08a051facc261167d0a45383cc5fa8b1ea7d1f9d9be5a7e623e27a1320` | Active |

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

## Session: December 20, 2024

### CCC Frontend Implementation ✅

**Completed:**
- [x] Contract upgrade utility (`scripts/upgrade-contract.js`)
- [x] Market contract upgraded on testnet (new code hash)
- [x] CCC-based frontend with JoyID integration
- [x] Market cell creation with AlwaysSuccess lock
- [x] Token minting functionality

**Frontend Features:**
- JoyID wallet connection (testnet)
- Create market cells (AlwaysSuccess lock + market type script)
- Mint complete sets (YES + NO tokens)
- Real-time balance updates
- Transaction explorer links

**Key Technical Decisions:**
1. **AlwaysSuccess Lock for Market Cells**
   - Market cells use AlwaysSuccess lock (anyone can unlock)
   - Security enforced by type script, not lock script
   - Enables permissionless market interactions

2. **Contract Upgrade Tool**
   - Built `upgrade-contract.js` for seamless contract upgrades
   - Consumes old contract cell, creates new one with updated binary
   - Returns excess capacity to free up CKB

3. **CCC Integration**
   - Using `@ckb-ccc/ccc` v1.1.22 for all blockchain interactions
   - JoyID signer for passkey-based authentication
   - Built-in support for testnet system scripts (AlwaysSuccess, Secp256k1, etc.)

**Files Created/Modified:**
- `frontend-ccc/js/app.js` - Main app logic with JoyID integration
- `frontend-ccc/index.html` - UI with wallet connection
- `scripts/upgrade-contract.js` - Contract upgrade utility
- `PROGRESS.md` - Updated documentation

---

## Session: December 24, 2024

### Market-Token Contract Simplification ✅

**Problem:** Redundant validation in market-token contract duplicated market contract logic.

**Solution:** Simplified market-token type script to only:
1. Check if market cell is in inputs → delegate all validation to market contract
2. If no market cell → only allow `output_amount <= input_amount` (transfers/burns)

**New market-token contract logic:**
```rust
if market_cell_in_inputs(&args.market_type_hash) {
    // Market cell present - market type script validates everything
    return Ok(());
}
// No market cell - only allow transfers/burns (output <= input)
if output_amount > input_amount {
    return Err(Error::UnauthorizedMinting);
}
```

**Benefits:**
- Simpler code (~180 lines vs ~350 lines)
- Single source of truth (market contract)
- Smaller binary (198KB vs 209KB)

### Contract Deployments (Current Active)

| Contract | TX Hash | Code Hash | Status |
|----------|---------|-----------|--------|
| **Market** | `0x5245d3227ee810c34f5a3beb00364e023803f20453de2b32de04af9e19c00590` | `0x5377ffaf1a41f5e79bd25f8d0e1eac411863a35de41be3db49350c584a16e60d` | **Active** |
| **Token** | `0xc85097fc1367d51ba639bda59df53ad94d274d26aa176953a7aff287bcc37652` | `0x4cb52d7042988b6db9045383bd709adf043eb37f1988b48b05187f61cb7a17da` | **Active** |

**IMPORTANT:** Code hash is calculated using CKB's blake2b with personalization `"ckb-default-hash"`. Standard blake2b gives wrong hash!

```javascript
// CORRECT way to calculate code hash in CCC:
const dataHash = ccc.hashCkb(cellData);
```

### Frontend Updates ✅

**1. Minting Per Market:**
- Removed standalone "Mint Tokens" section
- Each market card now has its own mint input + button
- Validates token_code_hash matches before minting

**2. Token Balance Display:**
- Shows YES and NO token balances for each market
- Searches by type script, filters by user's lock script

**3. Token Code Hash Validation:**
- Frontend checks if market's stored `token_code_hash` matches `CONFIG.tokenCodeHash`
- Prevents transactions that would fail on-chain

### Key Technical Details

**Market Data Format (35 bytes):**
```
bytes 0-31:  token_code_hash (32 bytes) - hash of token contract binary
byte 32:     hash_type (1 byte) - 2 = Data1
byte 33:     resolved (1 byte) - 0 or 1
byte 34:     outcome (1 byte) - 0 = NO wins, 1 = YES wins
```

**Token Type Script Args (33 bytes):**
```
bytes 0-31:  market_type_hash (32 bytes) - hash of market's type script
byte 32:     token_id (1 byte) - 0x01 = YES, 0x02 = NO
```

**Collateral Ratio:** 100 CKB per token (1 complete set = 1 YES + 1 NO = 100 CKB)

### Issues Encountered & Fixed

1. **Wrong token code hash calculation**
   - Used standard blake2b instead of CKB's blake2b
   - Fix: Use `ccc.hashCkb()` for code hash calculation

2. **Market token_code_hash mismatch**
   - Old markets stored old token code hash
   - New tokens created with new code hash → market contract rejects
   - Fix: Create new market after token contract upgrade, or use matching market

3. **Missing cell deps**
   - AlwaysSuccess dep needed for market cell's lock script
   - Fix: Added `tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.AlwaysSuccess)`

### Frontend Files

- `frontend-ccc/index.html` - Main UI
- `frontend-ccc/js/app.js` - CCC/JoyID integration

**Cache busting:** Update `?v=` parameter in script tag when making changes.

### Resolution & Claims Implementation (Dec 24 v10) ✅

**Completed:**
- [x] Per-market resolution UI (YES Wins / NO Wins buttons on each active market)
- [x] `resolveForMarket(txHash, index, outcome)` - resolves specific market
- [x] `claimForMarket(txHash, index, amount, outcome)` - claim winning tokens after resolution
- [x] Claim UI appears on resolved markets showing winning token balance

**Resolution Flow:**
1. User clicks "YES Wins" or "NO Wins" on active market
2. Transaction updates market data: `resolved = 1`, `outcome = 0/1`
3. Capacity unchanged, lock unchanged, type unchanged
4. Contract validates token counts don't change during resolution

**Claim Flow:**
1. After resolution, winners see claim UI with their winning token balance
2. User enters amount to claim, clicks "Claim CKB"
3. Transaction:
   - Input: market cell + winning token cells
   - Output: market cell (reduced capacity) + remaining tokens (if any)
   - Contract validates: capacity_decrease = tokens_burned × 100 CKB

### Next Steps

- [ ] Implement complete set burning (redeem before resolution)
- [ ] Add token transfer functionality
- [ ] Add market metadata (question, description)
- [ ] Add authorization for resolution (oracle/owner signature)

---

**Status:** Resolution and claiming implemented. Full prediction market lifecycle working on testnet.
