# CKB Prediction Market - Development Context

**Purpose:** This file provides Claude with complete context about the project architecture, implementation status, and development guidelines.

---

## 🎯 Project Status: CORE COMPLETE

### ✅ Fully Implemented Features

**Complete Prediction Market Lifecycle:**
- ✅ **Market Creation** - Create markets with AlwaysSuccess lock + type script
- ✅ **Minting** - Mint complete sets (YES + NO tokens) with CKB collateral
- ✅ **Burning** - Redeem complete sets before resolution to recover CKB
- ✅ **Resolution** - Mark market outcome (YES wins / NO wins)
- ✅ **Claiming** - Winners burn tokens to recover CKB collateral
- ✅ **Multiple Markets** - Support for independent parallel markets
- ✅ **Frontend UI** - Full CCC + JoyID integration (Verdict interface)

### 🚧 In Progress

- 🚧 **CLOB Trading** - Central Limit Order Book using limit order cells (see CLOB Architecture below)

### ⏳ Not Yet Implemented

- ⏳ **Oracle Resolution** - Automated/authorized resolution (currently permissionless)
- ⏳ **RGB++ Integration** - Cross-chain asset bridging
- ⏳ **Market Metadata** - Questions, descriptions, categories
- ⏳ **Advanced Analytics** - Price charts, volume tracking, historical data

---

## 🏗️ Architecture Overview

### Smart Contracts (Rust)

**Market Contract** (`contracts/market/src/main.rs`)
- Type script enforces all collateralization rules
- Data: 35 bytes (token_code_hash[32] + hash_type[1] + resolved[1] + outcome[1])
- Validates minting (capacity increase), burning (capacity decrease), resolution, claiming
- Single source of truth for market state

**Token Contract** (`contracts/market-token/src/main.rs`)
- Type script identifies market via args: `[32-byte market hash][1-byte token ID]`
- Token IDs: 0x01 = YES, 0x02 = NO
- Simplified logic: if market cell present → delegate to market contract
- If no market cell → only allow transfers/burns (output ≤ input)
- **xUDT-compatible:** Uses u128 data format
- **CLOB-enabled:** Extended data format supports limit orders (amount + limit_price)

### Frontend (CCC + JoyID)

**Main Frontend** (`frontend-ccc/`)
- `index.html` - Basic UI for testing/development
- `js/app.js` - CCC integration with JoyID wallet

**Verdict Frontend** (`verdict/`)
- `index.html` - Polished production UI
- `admin.html` - Market management interface
- `js/app.js` - Full market lifecycle implementation
- Uses `@ckb-ccc/ccc` v1.1.22 + JoyID passkey authentication

### Deployment (CKB Pudge Testnet)

| Contract | Code Hash | TX Hash |
|----------|-----------|---------|
| **Market** | `0x5377ffaf...` | `0x5245d322...` |
| **Token** | `0x40ee502c...` | `0x23b21d3f...` |

**Address:** `ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqwq6072ngzarpg9apuhptlqm9s9y9d6w6qwges4n`

---

## 💱 CLOB Trading Architecture

### Design Philosophy

**Token Cells as Limit Orders** (native to UTXO model)
- ✅ Each token cell can BE a limit order (just add price to cell data)
- ✅ No pool contract needed (cells themselves are liquidity)
- ✅ No impermanent loss (sellers keep custody until filled)
- ✅ True price discovery (market-driven, not algorithmic)
- ✅ Natural for prediction markets (users think in limit orders)
- ✅ Capital efficient (no locked liquidity pools)

**Inspired by UTXOSwap's intent-based model, simplified for prediction markets**

### Token Cell as Limit Order

**Token Data Format Convention:**
- **16 bytes:** Normal token holding (just amount) - used by mint/burn/claim
- **32 bytes:** Limit order (amount + limit_price) - used by createLimitOrder()
- Contract accepts both formats for backward compatibility

**Extended Token Data Format (32 bytes):**
```rust
struct TokenData {
    amount: u128,        // 16 bytes - token amount
    limit_price: u128,   // 16 bytes - CKB per token (0 = not for sale)
}
```

**Examples:**
```
Holding (not for sale):
  Lock: alice_lock
  Type: YES token type script
  Data: [amount: 100, limit_price: 0]

Limit sell order:
  Lock: alice_lock
  Type: YES token type script
  Data: [amount: 100, limit_price: 65_00000000]  // 65 CKB per token
```

### Trading Flows

**Create Limit Sell Order:**
```
Alice sets price on her tokens:

Transaction:
  Input:  Alice's 100 YES (limit_price = 0)
  Output: Alice's 100 YES (limit_price = 65 CKB)

Validation:
  - Lock unchanged (Alice still owns) ✓
  - Amount unchanged ✓
  - Just setting price ✓

Order now visible on-chain!
```

**Fill Limit Order (Buy):**
```
Bob buys Alice's tokens:

Transaction:
  Inputs:
    - Alice's 100 YES (limit_price = 65, lock = alice)
    - Bob's CKB (6500 CKB)

  Outputs:
    - Bob's 100 YES (limit_price = 0, lock = bob)
    - Alice's CKB (6500 CKB)

Token contract validates:
  - Limit price was set (65 CKB) ✓
  - Lock changed (sale) ✓
  - Payment: 100 × 65 = 6500 CKB to Alice ✓
```

**Partial Fill:**
```
Carol buys 40 of Alice's 100 YES:

Transaction:
  Inputs:
    - Alice's 100 YES (limit_price = 65)
    - Carol's CKB (2600 CKB)

  Outputs:
    - Alice's 60 YES (limit_price = 65, still for sale!)
    - Carol's 40 YES (limit_price = 0)
    - Alice's CKB (2600 CKB)

Validation:
  - Total output = input ✓
  - Carol paid 40 × 65 ✓
  - Alice keeps 60 at same price ✓
```

**Cancel Order:**
```
Alice changes her mind:

Transaction:
  Input:  Alice's 100 YES (limit_price = 65)
  Output: Alice's 100 YES (limit_price = 0)

Validation:
  - Lock unchanged (Alice's signature) ✓
  - Just resetting price ✓
```

### Order Book = Cell Indexing

**No special "order book" contract needed!**

```javascript
// Query all YES sell orders
const orders = await collector.getCells({
    type: yesTokenTypeScript
});

const sellOrders = orders
    .filter(cell => parseLimitPrice(cell.data) > 0)
    .sort((a, b) => a.price - b.price);

// That's your order book!
```

### Price Discovery & Arbitrage

**Complete set arbitrage enforces price bounds:**

```
If order book shows:
  Best YES ask: 55 CKB
  Best NO ask:  50 CKB
  Total: 105 CKB

Arbitrageur:
  1. Buy 1 YES at 55 CKB
  2. Buy 1 NO at 50 CKB
  3. Burn set → get 100 CKB
  4. Loss: -5 CKB ❌

Won't happen! Prices naturally stay near YES + NO ≈ 100 CKB
```

### Throughput Considerations

**One trade per block:**
- CKB block time: ~8 seconds
- Throughput: ~7.5 fills/minute = 450 fills/hour
- **Perfect for prediction markets** (low steady volume, spikes during events)

**Compare to alternatives:**
- AMM pool: Same throughput (1 swap/block), but needs complex pool contract
- Intent-based (UTXOSwap): Higher throughput via batching, but needs sequencer
- Simple CLOB: **Best fit for prediction market volumes**

**Future scaling options:**
- Add off-chain order matching (if needed)
- Implement intent-based batching (when volume justifies)
- Keep permissionless fallback (always can fill on-chain directly)

---

## 🛠️ Development Guidelines

### Code Quality Standards

**1. Modularity First**
- Keep functions small and single-purpose
- Separate concerns (validation, formatting, transaction building)
- Avoid copy-paste - extract shared logic into utilities
- Example: Use helper functions for repeated patterns like cell searching, balance calculation

**2. Test Everything**
- Test each small change immediately after writing it
- For contract changes: use `ckb-debugger` before deploying
- For frontend changes: test in browser before committing
- When fixing bugs: create minimal reproduction first, then fix
- Never assume code works - verify with real tests

**3. Incremental Development**
- Make one small change at a time
- Verify it works before moving to the next change
- Commit working states frequently
- If something breaks, you can quickly revert to last working state

**4. Clear Naming**
- Use descriptive variable/function names (not `temp`, `data`, `val`)
- Be explicit: `yesTokenBalance` not `balance1`
- Function names should be verbs: `calculateCollateral()`, `validateOutcome()`

**5. Error Handling**
- Always handle errors gracefully
- Provide clear error messages to users
- Log errors with context for debugging
- Never silently swallow exceptions

**6. Documentation**
- Comment complex logic (why, not what)
- Update docs when changing behavior
- Keep API_DOCUMENTATION.md in sync with code
- Document assumptions and invariants

**7. Security Awareness**
- Validate all user inputs
- Check cell capacities before transactions
- Verify type script hashes match expected values
- Be cautious with lock scripts (AlwaysSuccess is permissionless)

**8. Design Decisions**
- **ALWAYS discuss design decisions with the user before implementing**
- Don't make assumptions about data formats, architecture, or UX choices
- When multiple approaches exist, present options and trade-offs
- Example: "Should we use 16-byte or 32-byte data for minting?" → Ask first!
- If unsure about a design choice during implementation, stop and ask

---

## 🔑 Key Technical Details

### Market Data Format (35 bytes)
```
bytes 0-31:  token_code_hash (32 bytes) - hash of token contract binary
byte 32:     hash_type (1 byte) - 2 = Data1
byte 33:     resolved (1 byte) - 0 or 1
byte 34:     outcome (1 byte) - 0 = NO wins, 1 = YES wins
```

### Token Type Script Args (33 bytes)
```
bytes 0-31:  market_type_hash (32 bytes) - hash of market's type script
byte 32:     token_id (1 byte) - 0x01 = YES, 0x02 = NO
```

### Collateral Economics
- **Ratio:** 100 CKB per token (1 complete set = 100 CKB collateral)
- **Minting:** Lock 100 CKB → get 1 YES + 1 NO token
- **Burning (pre-resolution):** Return 1 YES + 1 NO → recover 100 CKB
- **Claiming (post-resolution):** Return 1 winning token → recover 100 CKB

### Cell Capacity Requirements
- **Market Cell:** Variable (starts ~200 CKB, grows with collateral)
- **Token Cell:** ~150 CKB (covers lock + type + data + overhead)
- **Transaction Fees:** ~1-5 CKB

---

## 🐛 Common Pitfalls & Solutions

### Contract Development

**1. Atomic Instructions Error**
- **Problem:** CKB-VM doesn't support RISC-V A extension
- **Solution:** Add `-C target-feature=-a` to `.cargo/config.toml`

**2. Code Hash Calculation**
- **Problem:** Standard blake2b gives wrong hash
- **Solution:** Always use `ccc.hashCkb()` (uses CKB's personalization)

**3. Type Script Hash vs Code Hash**
- **Type Script Hash:** `hash(codeHash || hashType || args)` - identifies specific script instance
- **Code Hash:** `hash(binary)` - identifies contract code
- **Rule:** Token args use market's **type script hash**, not code hash

### Frontend Development

**1. Cell Capacity Validation**
- Always check if cells have enough capacity for lock + type + data
- Use `tx.completeInputsByCapacity()` to ensure sufficient inputs
- Token cells need ~150 CKB each (not just 61 CKB)

**2. Cell Deps**
- Include all referenced contracts in `tx.cellDeps`
- AlwaysSuccess lock needs `ccc.KnownScript.AlwaysSuccess` cell dep
- Missing cell deps = transaction rejection

**3. Molecule Encoding**
- CKB uses Molecule serialization (not standard JSON/rlp)
- Use `ccc.numLeToBytes()` for little-endian u128 encoding
- Arrays need proper Uint8Array handling (not string arrays)

**4. Cache Busting**
- Update `?v=` parameter in script tags when changing JS
- Browsers aggressively cache static files

---

## 📁 Project Structure

```
prediction-market/
├── contracts/
│   ├── market/              # Market type script (Rust)
│   ├── market-token/        # Token type script (Rust)
│   └── pool/                # AMM pool type script (Rust) - Coming Soon
├── scripts/
│   ├── generate-key.js      # Generate testnet address
│   ├── deploy-simple.js     # Deploy contracts
│   ├── create-market.js     # Create market cell
│   └── upgrade-contract.js  # Upgrade deployed contract
├── frontend-ccc/            # Basic CCC frontend
│   ├── index.html
│   └── js/app.js
├── verdict/                 # Production UI
│   ├── index.html           # Main interface
│   ├── admin.html           # Admin panel
│   ├── js/app.js            # Full implementation
│   └── js/pool.js           # AMM trading logic - Coming Soon
├── devnet/                  # Local devnet utilities
├── API_DOCUMENTATION.md     # Complete API reference
└── CLAUDE.md               # This file

External References:
├── /home/ali/utxoswap-sdk-js/  # UTXOSwap SDK (for AMM research)
```

---

## 🧪 Testing Workflow

### Contract Testing
```bash
# 1. Build contract with debug assertions
cd contracts/market
RUSTFLAGS="-C target-feature=-a -C debug-assertions=on" cargo build --release --target=riscv64imac-unknown-none-elf

# 2. Create mock transaction (use scripts or manual JSON)

# 3. Test with ckb-debugger
ckb-debugger --tx-file mock-tx.json --script-group-type type -i 0 -e input

# 4. Verify output (should exit with code 0)
```

### Frontend Testing
```bash
# 1. Make small change to frontend code
# 2. Update cache version in HTML: <script src="js/app.js?v=NEW_VERSION">
# 3. Open in browser and test specific feature
# 4. Check browser console for errors
# 5. Verify transaction on explorer
```

### Integration Testing
1. Create test market on testnet
2. Mint small amount of tokens (e.g., 1-10)
3. Test burning/resolution/claiming flow
4. Check final balances match expected values
5. Verify on explorer: https://pudge.explorer.nervos.org

---

## 📚 Development History

### Phase 1: Contract Development (Dec 7, 2024)
- Market contract implementation with minting validation
- Token contract with market delegation pattern
- Local testing with ckb-debugger
- Fixed atomic instructions issue

### Phase 2: Testnet Deployment (Dec 7-20, 2024)
- Deployed contracts to Pudge testnet
- Built CCC frontend with JoyID integration
- Implemented market creation and minting
- Contract upgrade utility

### Phase 3: Full Lifecycle (Dec 24, 2024)
- Simplified token contract (delegation pattern)
- Implemented burning functionality
- Added resolution mechanism
- Implemented claiming for winners
- Built Verdict production UI

### Phase 4: Security & Refinement (Current)
- Comprehensive security testing
- Attack vector validation
- Code cleanup and optimization
- Documentation updates

---

## 🎓 Key Learnings

**CKB Development:**
- Type script validation runs for BOTH inputs and outputs containing that type
- Lock script only validates spending (inputs), not receiving (outputs)
- AlwaysSuccess lock = permissionless (anyone can spend)
- Type IDs ensure unique cell identity across transactions

**CCC Library:**
- `ccc.hashCkb()` can return string OR Uint8Array (always type-check)
- `Transaction.from()` needs plain objects (not class instances)
- Cell deps are critical (missing dep = silent validation failure)
- JoyID uses passkeys (biometric auth, no seed phrases)

**Prediction Markets:**
- Complete Set model is elegant and simple
- Equal YES/NO minting prevents manipulation
- Collateral ratio must be strictly enforced on-chain
- Resolution should be authorized (oracle/multisig)

---

## 🚀 Current & Future Work

### 🎯 Current Task: CLOB Trading Implementation

**Goal:** Enable limit order trading by extending token contract with price field

**Deliverables:**

**1. Token Contract Update (Rust)** - `contracts/market-token/src/main.rs`
   - [ ] Extend data format: `[amount: u128][limit_price: u128]` (32 bytes total)
   - [ ] Add limit order validation logic
   - [ ] Validate order fills (payment = amount × limit_price)
   - [ ] Support partial fills (split cells correctly)
   - [ ] Maintain backward compatibility (limit_price = 0 for normal holding)
   - [ ] Test with ckb-debugger

**2. Frontend Order Book (JavaScript)** - `verdict/js/orderbook.js`
   - [ ] `getOrderBook(marketHash, tokenId)` - query and display sell orders
   - [ ] `createLimitOrder(amount, price)` - set limit_price on tokens
   - [ ] `fillOrder(orderCell, amount)` - buy tokens at limit price
   - [ ] `cancelOrder(orderCell)` - reset limit_price to 0
   - [ ] `fillPartialOrder()` - buy portion of order
   - [ ] Order book UI (price levels, amounts, one-click fill)

**3. Testing & Deployment**
   - [ ] Test limit order creation
   - [ ] Test full order fills
   - [ ] Test partial order fills
   - [ ] Test order cancellation
   - [ ] Deploy updated token contract to testnet
   - [ ] Create test orders and verify fills

**Success Metrics:**
- Users can create limit sell orders
- Buyers can fill orders at posted prices
- Order book displays all available orders
- Partial fills work correctly
- Prices bounded by complete set arbitrage

---

### 📋 Future Enhancements

**High Priority:**
1. ✅ ~~Trading infrastructure~~ → AMM in progress
2. Oracle integration for authorized resolution
3. Market metadata (questions, categories, expiry)
4. Event emission for indexing
5. Price charts and analytics

**Medium Priority:**
6. RGB++ bridge for cross-chain assets
7. Multi-outcome markets (not just binary)
8. Liquidity mining incentives
9. Market creation fees
10. Sequencer/batching (if throughput becomes issue)

**Low Priority:**
11. Advanced analytics dashboard
12. Social features (comments, likes)
13. Market templates
14. Governance mechanisms

---

## 💡 Development Tips

**When Adding Features:**
1. Start by reading existing code to understand patterns
2. Create new feature in isolation (separate function/module)
3. Test independently before integrating
4. Update documentation as you go
5. Commit working states frequently

**When Fixing Bugs:**
1. Reproduce bug reliably first
2. Identify root cause (use console.log, debugger, explorers)
3. Write minimal fix (don't refactor everything)
4. Test fix works
5. Check if similar bugs exist elsewhere

**When Refactoring:**
1. Ensure tests pass before starting
2. Make small incremental changes
3. Test after each change
4. Keep commits small and focused
5. Don't mix refactoring with feature additions

---

## 📞 Resources

**CKB Development:**
- **CCC Docs:** https://docs.ckbccc.com
- **CKB Docs:** https://docs.nervos.org
- **Pudge Explorer:** https://pudge.explorer.nervos.org
- **JoyID:** https://joy.id
- **ckb-debugger:** https://github.com/nervosnetwork/ckb-standalone-debugger

**AMM References:**
- **Uniswap V2 Whitepaper:** https://uniswap.org/whitepaper.pdf
- **UTXOSwap SDK:** https://github.com/UTXOSwap/utxoswap-sdk-js (intent-based AMM reference, cloned to `/home/ali/utxoswap-sdk-js`)
- **Constant Product Formula:** x × y = k (Uniswap V2 standard)

---

## 🔧 CCC Transaction Completion API Reference

**CRITICAL:** Understanding these methods is essential for correct transaction building.

### Available Methods

**1. `completeInputsByCapacity(signer, capacityTweak?, filter?)`**
- **Purpose:** Add inputs until total input capacity ≥ total output capacity + fees
- **Use when:** You've defined outputs with specific capacities and need to fund them
- **Returns:** Number of inputs added
- **Note:** This does NOT handle transaction fees - use `completeFeeBy()` after this

**2. `completeFeeBy(signer, feeRate?, filter?, options?)`**
- **Purpose:** Add inputs for fees AND create a NEW change output to signer's address
- **Use when:** Outputs have fixed capacities, you want change in a separate cell
- **Returns:** `[addedInputs: number, hasChange: boolean]`
- **Example:**
  ```javascript
  await tx.completeFeeBy(this.signer, 1000);
  // Creates new output for change if there's excess capacity
  ```

**3. `completeFeeChangeToOutput(signer, index, feeRate?, filter?, options?)`**
- **Purpose:** Add inputs for fees AND add excess capacity to EXISTING output at index
- **Use when:** You WANT to increase an existing output's capacity with change
- **Returns:** `[addedInputs: number, hasChange: boolean]`
- **⚠️ Warning:** Excess capacity goes into `outputs[index]`, not a new cell!
- **Example:**
  ```javascript
  await tx.completeFeeChangeToOutput(this.signer, 0, 1000);
  // Adds all excess capacity to outputs[0]
  ```

**4. `completeFeeChangeToLock(signer, changeScript, feeRate?, filter?, options?)`**
- **Purpose:** Add inputs for fees AND create change output with specific lock script
- **Use when:** You want change to go to a specific address/lock
- **Returns:** `[addedInputs: number, hasChange: boolean]`

### Common Patterns

**Pattern 1: Fixed-Capacity Outputs (Markets, Tokens)**
```javascript
// Outputs already have correct capacity specified
const tx = ccc.Transaction.from({
    inputs: [...],
    outputs: [
        { capacity: 200_00000000n, lock: marketLock, type: marketType },
        { capacity: 170_00000000n, lock: userLock, type: tokenType }
    ]
});

// Option A: Just handle fees (if inputs already cover output capacity)
await tx.completeFeeBy(this.signer, 1000);
// Creates separate change output

// Option B: Need to fund outputs + fees
await tx.completeInputsByCapacity(this.signer);  // Cover outputs
await tx.completeFeeBy(this.signer, 1000);       // Handle fees + change
```

**Pattern 2: Flexible Output (Sending all available CKB)**
```javascript
const tx = ccc.Transaction.from({
    inputs: [someCell],
    outputs: [
        { capacity: someCell.capacity, lock: recipientLock }
    ]
});

// Add excess capacity to output 0
await tx.completeFeeChangeToOutput(this.signer, 0, 1000);
// Output 0 gets: original capacity + any excess - fees
```

### What We Got Wrong

**❌ WRONG - We used `completeInputsBy()` which doesn't exist:**
```javascript
await tx.completeInputsBy(this.signer);      // Error: not a function!
await tx.completeFeeBy(this.signer, 1000);
```

**✅ CORRECT - Use completeInputsByCapacity() or just completeFeeBy():**
```javascript
// If transaction inputs don't cover outputs:
await tx.completeInputsByCapacity(this.signer);
await tx.completeFeeBy(this.signer, 1000);

// OR if inputs already exist (like minting, where we consume market cell):
await tx.completeFeeBy(this.signer, 1000);  // This is usually enough!
```

### Bug: Wrong Use of completeFeeChangeToOutput

**Our Previous Bug:**
```javascript
// Creating market with 200 CKB capacity
const tx = ccc.Transaction.from({
    outputs: [{ capacity: 200_00000000n, lock, type }]
});

await tx.completeFeeChangeToOutput(this.signer, 0, 1000);
// ❌ This added ALL excess capacity to output 0!
// Market got 171k CKB instead of 200 CKB
```

**The Fix:**
```javascript
await tx.completeFeeBy(this.signer, 1000);
// ✅ Creates separate change output
// Market keeps exactly 200 CKB
```

### Decision Tree: Which Method to Use?

```
Do you want excess capacity added to an existing output?
├─ YES → Use completeFeeChangeToOutput(signer, index, feeRate)
│         Example: Sending all CKB to recipient
│
└─ NO → Need change in a separate output
    │
    ├─ Do existing inputs cover output capacity?
    │  ├─ YES → Just use completeFeeBy(signer, feeRate)
    │  │         Example: Minting (market cell input covers token outputs)
    │  │
    │  └─ NO → Use both:
    │            1. completeInputsByCapacity(signer)
    │            2. completeFeeBy(signer, feeRate)
    │            Example: Creating market from scratch
```

### Best Practices

1. **Always check CCC docs** - Don't assume method names based on patterns
2. **For prediction market transactions:**
   - Market creation: `completeFeeBy()` alone (starts with no inputs)
   - Minting: `completeFeeBy()` alone (market cell input provides capacity)
   - Limit orders: `completeFeeBy()` alone (token cell inputs provide capacity)
   - Burns/Claims: Can use `completeFeeChangeToOutput()` if sending all CKB back

3. **Test with small amounts first** - Check actual capacities on testnet explorer

---

**Last Updated:** December 30, 2024
**Status:** Core functionality complete. Currently implementing AMM trading (pool contract + frontend integration).
**Next Milestone:** Launch trading MVP within 1 week
