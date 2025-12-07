# CKB Prediction Market MVP

A simple prediction market dapp built on CKB (Nervos Network) using the CCC SDK.

## 📋 Project Overview

**MVP Scope**: A minimal prediction market where users can bet on a single binary outcome event.

**Example Event**: "Will BTC close above $100,000 on 2025-11-10?"
- **YES** side: BTC will close above $100,000
- **NO** side: BTC will close below $100,000

## 🎯 MVP Features

### Core Functionality
1. **Create Market**: Initialize a prediction market for a binary event
2. **Place Bets**: Users can bet CKB on YES or NO
3. **View Positions**: Check current bets and potential payouts
4. **Resolve Market**: Declare the outcome (deterministic for testing)
5. **Claim Winnings**: Winners withdraw their share of the pool

### Simplified for MVP
- ✅ Single market (hardcoded event)
- ✅ Deterministic outcome (no oracle needed)
- ✅ CKB-only (no UDT tokens)
- ✅ Simple linear payouts (proportional to bet size)
- ❌ No AMM/liquidity pools
- ❌ No order book
- ❌ No partial fills

## 🏗️ Architecture

### Cell Model Design

**Market Cell** (single cell representing the entire market):
```
Capacity: Total CKB locked in market
Lock Script: Market lock (custom script)
Type Script: Market type (validates market rules)
Data: {
  yesPool: u128,      // Total CKB bet on YES
  noPool: u128,       // Total CKB bet on NO
  totalBets: u64,     // Number of bets placed
  resolved: bool,     // Is market resolved?
  outcome: bool,      // Final outcome (true=YES, false=NO)
  deadline: u64       // Timestamp when betting closes
}
```

**Position Cells** (one per user bet):
```
Capacity: User's bet amount
Lock Script: User's lock (owner)
Type Script: Position type (links to market)
Data: {
  marketId: Bytes32,  // Which market this belongs to
  side: bool,         // true=YES, false=NO
  amount: u128,       // CKB amount bet
  timestamp: u64      // When bet was placed
}
```

### Transaction Flows

#### 1. Create Market
```
Inputs: [User's CKB cell]
Outputs: [Market cell (initial state), Change]
```

#### 2. Place Bet
```
Inputs: [Market cell, User's CKB cell]
Outputs: [Updated market cell, Position cell, Change]
```

#### 3. Resolve Market
```
Inputs: [Market cell]
Outputs: [Resolved market cell (outcome set)]
```

#### 4. Claim Winnings
```
Inputs: [Resolved market cell, Position cell(s)]
Outputs: [Updated market cell, User payout, Change]
```

## 💰 Payout Math

**Simple proportional payout:**

```
Winner's payout = (Winner's bet / Total winning pool) * (Total losing pool + Total winning pool)
```

**Example:**
- YES pool: 1000 CKB (Alice: 600, Bob: 400)
- NO pool: 500 CKB (Charlie: 500)
- Outcome: YES wins

Alice gets: (600 / 1000) * 1500 = 900 CKB (50% profit)
Bob gets: (400 / 1000) * 1500 = 600 CKB (50% profit)
Charlie loses: 500 CKB

## 🔧 Technical Stack

- **Language**: TypeScript
- **SDK**: CKB CCC SDK (@ckb-ccc/core)
- **Network**: CKB Testnet (Pudge)
- **Scripts**: Pre-existing CKB scripts (Phase 1 - no custom scripts yet)

## 📝 Implementation Phases

### Phase 1: Off-Chain Validation (Current MVP)
- Use standard CKB lock scripts
- Validation logic in TypeScript (client-side)
- Trust-based resolution (deterministic outcome)
- Focus: Learn CKB patterns, transaction building, cell management

### Phase 2: Type Scripts (Future)
- Custom type script for market validation
- On-chain enforcement of rules
- Prevent invalid state transitions

### Phase 3: Oracle Integration (Future)
- Real event outcomes (price feeds, sports, etc.)
- Decentralized oracle network
- Dispute resolution

### Phase 4: Advanced Features (Future)
- Multiple markets
- AMM for liquidity
- Limit orders
- Market maker incentives

## 🎓 Learning Objectives

Through building this MVP, you'll learn:

1. **Multi-Cell State Management**: Coordinating market cell + position cells
2. **Cell Data Encoding**: Storing complex state (pools, bets, outcomes)
3. **Transaction Composition**: Multi-input, multi-output transactions
4. **Capacity Management**: Ensuring sufficient CKB for all cells
5. **Cell Queries**: Finding all positions for a market
6. **State Transitions**: Create → Bet → Resolve → Claim lifecycle

### Development Approach

**⚠️ IMPORTANT: Discussion-First Development Process**

This is a multi-month learning project. Before implementing ANY non-trivial changes:

1. **Stop and Discuss**: When encountering a design decision or problem, STOP coding immediately
2. **Document Options**: Present multiple solution approaches with trade-offs
3. **Discuss Thoroughly**: Review options together, ask questions, ensure understanding
4. **Agree on Solution**: Only proceed with implementation after explicit agreement
5. **Document Decision**: Record the chosen approach and reasoning in relevant docs

**Example Format**:
```markdown
## Problem: [Issue Description]

### Option 1: [Approach Name]
- **Pros**: ...
- **Cons**: ...
- **Complexity**: ...

### Option 2: [Approach Name]
- **Pros**: ...
- **Cons**: ...
- **Complexity**: ...

### Recommendation: [Chosen Option]
**Reasoning**: ...

**Questions**:
1. [Question for discussion]
2. [Question for discussion]
```

**Step-by-step explanations**: Every implementation step will be explained in detail to ensure understanding of the code logic and CKB concepts. This prevents getting lost in complexity and builds a solid foundation for blockchain development on Nervos CKB.

**Conversation Tracking**: For this long-term project, important design decisions, gotchas, and learnings are documented in:
- [README.md](README.md) - Development approach, gotchas, SDK learnings, roadmap
- [CSMM_DESIGN.md](CSMM_DESIGN.md) - CSMM + xUDT + Virtual Liquidity design details
- [DECISIONS.md](DECISIONS.md) - **Design decision log with alternatives and trade-offs**
  - Use this to track "why we chose X over Y"
  - Prevents re-discussing the same decisions
  - Provides context for future changes

## 📂 Project Structure

```
prediction-market/
├── README.md                  # This file
├── package.json              # Dependencies
├── tsconfig.json             # TypeScript config
├── .env                      # Private keys (testnet)
├── src/
│   ├── types.ts              # TypeScript types for market data
│   ├── encoding.ts           # Cell data encoding/decoding
│   ├── market.ts             # Market creation & management
│   ├── betting.ts            # Place bets, view positions
│   ├── resolution.ts         # Resolve market & claim winnings
│   └── queries.ts            # Cell queries and data fetching
└── examples/
    ├── 01-create-market.ts   # Create a test market
    ├── 02-place-bet.ts       # Place YES/NO bets
    ├── 03-view-market.ts     # Query market state
    ├── 04-resolve.ts         # Resolve market outcome
    └── 05-claim.ts           # Claim winnings
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- pnpm
- CKB testnet account with CKB tokens

### Setup
```bash
cd prediction-market
pnpm install

# Create .env file with your testnet credentials
echo 'PRIVATE_KEY=0x...' > .env
echo 'CKB_RPC_URL=https://testnet.ckb.dev' >> .env
```

### Run Examples
```bash
# Create a market
pnpm exec tsx examples/01-create-market.ts

# Place a bet
pnpm exec tsx examples/02-place-bet.ts

# View market state
pnpm exec tsx examples/03-view-market.ts

# Resolve the market
pnpm exec tsx examples/04-resolve.ts

# Claim winnings
pnpm exec tsx examples/05-claim.ts
```

## 🧪 Testing Strategy

**Deterministic Outcome for MVP:**
```typescript
// Hardcoded in resolution.ts for testing
const OUTCOME = true; // YES wins (BTC closes above $100k)
```

Later phases will integrate real price feeds.

## 🔐 Security Considerations

### Phase 1 Limitations (MVP)
⚠️ **This is NOT production-ready**:
- No on-chain validation (client can cheat)
- Centralized resolution (trust-based)
- No dispute mechanism
- No fee structure

### Required for Production
- Custom type scripts for validation
- Decentralized oracle
- Time locks and deadlines
- Emergency pause mechanism
- Fee collection for sustainability

## 📊 Example Market

**Event**: "Will BTC close above $100,000 on 2025-11-10 23:59:59 UTC?"
- **Deadline**: 2025-11-10 23:00:00 UTC (betting closes 1 hour before)
- **Initial Pools**: 0 CKB YES, 0 CKB NO
- **Minimum Bet**: 100 CKB
- **Resolution**: Manual (deterministic TRUE for testing)

## 🤝 Contributing

This is a learning project. Feel free to experiment and extend!

## 📚 Resources

- [CKB CCC SDK Docs](https://docs.ckbccc.com)
- [CKB CCC Local Repository](/home/ali/ccc) - examples in `MY_EXAMPLES/` and `packages/demo/src/app/connected/(tools)/`
- [Nervos CKB Docs](https://docs.nervos.org)
- [Cell Model Explained](https://docs.nervos.org/docs/basics/concepts/cell-model)
- [RGB++ Protocol](https://github.com/ckb-cell/RGBPlusPlus-design)

## 💡 CCC SDK Learnings & Gotchas

### Cell Fetching Best Practice

**Issue**: `client.getCellLive(outPoint, true)` may return empty or unreliable results in CCC SDK v1.12.2.

**Solution**: Use a two-step approach:

```typescript
// Step 1: Fetch transaction to get cell data
const tx = await client.getTransaction(txHash);
const output = tx.transaction.outputs[index];
const outputData = tx.transaction.outputsData[index];

// Step 2: Check if cell is still live (not spent)
const cellStatus = await client.getCellLive({ txHash, index }, false);
if (cellStatus && cellStatus.status === "dead") {
  throw new Error("Cell already spent");
}

// Step 3: Construct cell object manually
const cell = {
  cellOutput: output,
  outputData: outputData,
};
```

**Why this works**:
- `getTransaction()` reliably fetches historical data
- `getCellLive()` with `withData=false` only checks status
- More robust than relying on `getCellLive()` to return cell data

### Witness Handling

**Issue**: Adding raw witness bytes causes "invalid buffer size" errors.

**Wrong**:
```typescript
tx.witnesses.push(ccc.hexFrom(new Uint8Array(65))); // ❌ Fails
```

**Right**:
```typescript
// Let CCC handle witnesses automatically during signing
// Don't manually add witnesses - completeInputsByCapacity handles it
await tx.completeInputsByCapacity(signer);
await tx.completeFeeBy(signer, 1000);
```

### Cell State Tracking

**Critical**: After every transaction that consumes a cell, the cell moves to a new OutPoint.

```
Create market  → Market at tx1:0
Place bet      → Market moves to tx2:0  (tx1:0 is now "dead")
Place bet 2    → Market moves to tx3:0  (tx2:0 is now "dead")
Resolve market → Market moves to tx4:0  (tx3:0 is now "dead")
```

**Always update your `.env`** with the latest transaction hash after modifying a cell!

### Cell Collector Performance

**Issue**: `client.findCellsByLock()` can be slow when scanning many cells.

**Phase 1 Workaround**: For MVP, limit position queries or use simpler scripts without full scans.

**Phase 2 Solution**: Use type scripts - cells with the same type script are indexed and can be queried O(1).

## 🗺️ Roadmap

- [x] Project setup and architecture design
- [x] Implement cell data encoding/decoding
- [x] Build market creation
- [x] Build betting functionality
- [x] Build query functions
- [x] Test market creation on testnet ✅
- [x] Test betting on testnet ✅
- [ ] Build resolution & claiming
- [ ] Test full lifecycle on testnet
- [ ] Add custom type scripts (Phase 2)
- [ ] Integrate oracle (Phase 3)
- [ ] Multi-market support (Phase 4)

---

**Built with CKB CCC SDK** | Learning Project | Not Production Ready
