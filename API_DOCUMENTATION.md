# Prediction Market API Documentation

## Overview

This is a CKB blockchain-based prediction market using the **Complete Set Model** (similar to Polymarket). Users mint equal amounts of YES and NO tokens by depositing CKB collateral. Each token represents a claim on 1 CKB if that outcome wins.

**Key Principles:**
- 1 CKB = 1 YES token + 1 NO token (complete set)
- Tokens can be traded freely
- When market resolves, winning tokens can be redeemed for 1 CKB each
- Losing tokens become worthless

---

## Deployment Information

**Network:** CKB Testnet (Pudge)

**Deployed Contracts:**
- Market Contract: `0x909becfd148b9b0ddabc98f244a98abcd2360fcf94107432068dca01a2e010e4`
- Market Code Hash: `0x37402b2f7c5b30611d34bad3b76b9f3607aa297213525d998159a6f7c7fd9421`
- Token Contract: `0x44ba3ce43127972ab03daa9507947c7e14ea6ef92f043524395536a532e563d6`
- Token Code Hash: `0x54f68c08a051facc261167d0a45383cc5fa8b1ea7d1f9d9be5a7e623e27a1320`

**Market Cell:**
- Transaction: `0x4f666a10114a564c25a0f09b7ea64f3787722f922403c8971ad079f666eb785b`
- Type Script Hash: `0xa9e40b899b3d3e902e0b3e804d1b9a0a2410741dfd41959db5f741a10a315b7d`

**First Minting Transaction:**
- TX: `0x6d378b2f41aa5cb7c64f63ad89b200a67c0de8fe200fa39025c1c15f2c9f5736`
- Minted: 100 YES + 100 NO tokens
- Collateral: 100 CKB

---

## Scripts and Functions

### 1. `generate-key.js`

Generates a new CKB testnet private key and address.

**Usage:**
```bash
node generate-key.js
```

**Output:**
- Private key (save to `.env` as `PRIVATE_KEY`)
- Testnet address (fund via faucet)

---

### 2. `deploy-simple.js`

Deploys both market and token contracts to testnet.

**Usage:**
```bash
node deploy-simple.js
```

**What it does:**
1. Loads market and token contract binaries
2. Deploys market contract cell (code only, no state)
3. Waits 3 seconds
4. Deploys token contract cell (code only, no state)
5. Calculates code hashes using `ccc.hashCkb()`
6. Saves deployment info to `deployed.json`

**Requirements:**
- At least 1000 CKB in wallet
- Contract binaries built at:
  - `../contracts/market/build/market`
  - `../contracts/market-token/build/market-token`

**Output:** `deployed.json` with contract locations and code hashes

---

### 3. `create-market.js`

Creates the initial market cell with zero supply.

**Usage:**
```bash
node create-market.js
```

**What it does:**
1. Reads market contract code hash from `deployed.json`
2. Creates market type script:
   - `code_hash`: Hash of market contract binary
   - `hash_type`: "data2"
   - `args`: "0x" (empty)
3. Initializes market data (34 bytes):
   - `yes_supply`: u128 = 0
   - `no_supply`: u128 = 0
   - `resolved`: u8 = 0
   - `outcome`: u8 = 0
4. Creates cell with ~156 CKB capacity
5. Saves market cell outpoint to `deployed.json`

**Market Data Structure:**
```
Bytes 0-15:   yes_supply (u128, little-endian)
Bytes 16-31:  no_supply (u128, little-endian)
Byte 32:      resolved (0 = false, 1 = true)
Byte 33:      outcome (0 = NO, 1 = YES)
```

---

### 4. `deploy-token.js`

Deploys the token contract separately (alternative to deploy-simple.js).

**Usage:**
```bash
node deploy-token.js
```

**What it does:**
1. Loads token contract binary
2. Deploys to a cell
3. Calculates code hash correctly (handles both string and Uint8Array)
4. Updates `deployed.json` with token info

**Important Fix:**
Properly handles `ccc.hashCkb()` return type to avoid malformed "0x000x..." hashes.

---

### 5. `mint-tokens.js`

Mints YES and NO tokens by depositing CKB collateral.

**Usage:**
```bash
node mint-tokens.js
```

**What it does:**
1. Loads current market cell from chain
2. Parses current market data (yes_supply, no_supply)
3. Creates new market data with increased supply
4. Calculates market type script hash for token args
5. Creates token type scripts:
   - YES token: `args = market_hash + 0x01`
   - NO token: `args = market_hash + 0x02`
6. Builds transaction:
   - **Input:** Current market cell
   - **Outputs:**
     - Updated market cell (capacity increased by collateral)
     - YES token cell (150 CKB capacity)
     - NO token cell (150 CKB capacity)
7. Adds cell deps for both contracts
8. Completes inputs/fees and sends transaction

**Token Type Script Structure:**
```javascript
{
  code_hash: "0x54f68c08a051facc261167d0a45383cc5fa8b1ea7d1f9d9be5a7e623e27a1320",
  hash_type: "data2",
  args: "[32-byte market type hash][1-byte token ID]"
}
```
- Token ID 0x01 = YES token
- Token ID 0x02 = NO token

**Token Data Structure:**
```
16 bytes: token amount (u128, little-endian)
```

**Parameters:**
- `mintAmount`: Number of tokens to mint (default: 100)
- Each complete set requires `mintAmount` CKB collateral
- Token cell capacity: 150 CKB each (covers lock + type + data)

**Validation (on-chain):**
- Market contract validates: capacity increase == supply increase (in shannons)
- Token contracts validate: equal YES/NO minting, market supply updates

---

## Contract Validation Logic

### Market Contract (`contracts/market/src/main.rs`)

**Minting validation:**
1. Verifies exactly 1 market input and 1 market output
2. Checks `yes_supply` increased by same amount as `no_supply`
3. Validates market capacity increased by exact amount (in shannons):
   ```rust
   capacity_increase == yes_increase * 100_000_000
   ```
4. Ensures market remains unresolved

**Important constant:**
```rust
const SHANNONS_PER_CKB: u128 = 100_000_000;
```

### Token Contract (`contracts/market-token/src/main.rs`)

**Minting validation:**
1. Loads token type script args to identify market and token type (YES/NO)
2. Finds corresponding market cell and parses supply data
3. For new tokens (output > input):
   - Verifies both YES and NO tokens minted equally
   - Confirms market supply increased by mint amount
   - Validates market cell exists in transaction

**Type Script Args Format:**
```rust
struct TypeScriptArgs {
    market_type_hash: [u8; 32],  // Hash of market type script
    token_type: u8,              // 1 = YES, 2 = NO
}
```

---

## Transaction Examples

### Minting 100 YES + 100 NO Tokens

**Inputs:**
- Market cell: 156 CKB capacity, 0 YES, 0 NO

**Outputs:**
- Market cell: 256 CKB capacity (+100), 100 YES, 100 NO
- YES token cell: 150 CKB, 100 tokens
- NO token cell: 150 CKB, 100 tokens

**Total Cost:**
- Collateral: 100 CKB (locked in market)
- Token cells: 300 CKB (150 × 2, returned when redeemed)
- Fees: ~1 CKB
- **Total:** ~401 CKB

**What you get:**
- 100 YES tokens (worth 100 CKB if YES wins)
- 100 NO tokens (worth 100 CKB if NO wins)
- Guaranteed 100 CKB total value (one side must win)

---

## Data Encoding Reference

### u128 Little-Endian Encoding

Used for token amounts and market supplies:

```javascript
const buffer = Buffer.alloc(16);
const amount = BigInt(100);
buffer.writeBigUInt64LE(amount & BigInt("0xFFFFFFFFFFFFFFFF"), 0);  // Low 64 bits
buffer.writeBigUInt64LE(amount >> BigInt(64), 8);                    // High 64 bits
const hex = "0x" + buffer.toString("hex");
```

**Example:** 100 tokens = `0x6400000000000000000000000000000`

---

## Common Issues and Fixes

### 1. Malformed Code Hash ("0x000x...")

**Problem:** `ccc.hashCkb()` returns a string, and `Array.from(string)` converts characters to hex.

**Fix:**
```javascript
const dataHash = ccc.hashCkb(binary);
let codeHash;
if (typeof dataHash === "string") {
  codeHash = dataHash.startsWith("0x") ? dataHash : "0x" + dataHash;
} else {
  codeHash = "0x" + Array.from(dataHash).map(b => b.toString(16).padStart(2, '0')).join('');
}
```

### 2. Insufficient Cell Capacity

**Problem:** Token cells need capacity for lock + type + data.

**Solution:** Use 150 CKB per token cell (not just 61 CKB).

**Calculation:**
- Lock script: ~61 bytes
- Type script: ~66 bytes (code_hash + hash_type + args)
- Data: 16 bytes (u128)
- Overhead: Molecule encoding
- Total: ~142-150 CKB minimum

### 3. Type Script Hash vs Code Hash

**Important:** When referencing market in token args, use **type script hash**, not code hash!

```javascript
// CORRECT
const marketTypeHash = marketTypeScript.hash();  // Hash of entire script

// WRONG
const marketCodeHash = marketTypeScript.codeHash;  // Just the code_hash field
```

---

## Testing with ckb-debugger

See `contracts/market-token/tests/` for mock transaction files.

**Run tests:**
```bash
cd contracts/market-token
ckb-debugger --tx-file tests/mock_tx_mint.json \
             --script-group-type type -i 1 -e input
```

**Important:** Add `.cargo/config.toml` to disable atomic instructions:
```toml
[target.riscv64imac-unknown-none-elf]
rustflags = ["-C", "target-feature=-a", "-C", "debug-assertions=on"]
```

---

## Next Steps (Not Yet Implemented)

1. **Burning/Redeeming:** Convert complete sets back to CKB
2. **Resolution:** Mark market as resolved with winning outcome
3. **Claiming:** Redeem winning tokens for CKB
4. **Trading:** Transfer tokens between users
5. **Multiple Markets:** Support more than one market

---

## Resources

- **Explorer:** https://pudge.explorer.nervos.org/
- **Faucet:** https://faucet.nervos.org/
- **CCC Docs:** https://docs.ckbccc.com/
- **CKB Docs:** https://docs.nervos.org/

---

## File Structure

```
/home/ali/prediction-market/
├── contracts/
│   ├── market/
│   │   ├── src/main.rs           # Market type script
│   │   └── build/market          # Compiled binary
│   └── market-token/
│       ├── src/main.rs           # Token type script
│       └── build/market-token    # Compiled binary
├── scripts/
│   ├── generate-key.js           # Generate testnet key
│   ├── deploy-simple.js          # Deploy both contracts
│   ├── create-market.js          # Create market cell
│   ├── deploy-token.js           # Deploy token contract
│   ├── mint-tokens.js            # Mint YES/NO tokens
│   ├── deployed.json             # Deployment info
│   └── .env                      # Private key (not committed)
└── API_DOCUMENTATION.md          # This file
```
