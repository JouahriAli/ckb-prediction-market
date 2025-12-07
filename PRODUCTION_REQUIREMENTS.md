# Production Requirements & Phase 2 Improvements

This document lists all simplifications made in Phase 1 (MVP) and what needs to be addressed for a production-ready prediction market.

---

## 1. On-Chain Validation (Type Scripts)

### Current State (Phase 1 - MVP)
- **No type scripts** on market cells
- **No validation** of market updates
- Market owner can:
  - Arbitrarily update market data
  - Mint unlimited tokens
  - Resolve markets incorrectly
  - Steal escrow funds
- **Trust assumption**: Users must trust the market owner completely

### Production Requirements (Phase 2)
- **Market Type Script** that enforces:
  - CSMM formula correctness when minting tokens
  - Escrow capacity increases by exactly the bet amount
  - Token supply increases match CSMM calculations
  - Only market owner can resolve
  - Resolution is final (cannot be changed)
  - Deadline enforcement (no bets after deadline)
  - Minimum liquidity enforcement (prevent division by zero)

- **xUDT Owner Lock** using Type ID or custom script:
  - Only allows minting when market cell is updated correctly
  - Prevents market owner from minting tokens without corresponding escrow
  - Links token minting to market cell state changes

### Implementation Complexity
- **High** - Requires writing CKB type scripts in Rust
- Need to understand:
  - CKB Script execution environment
  - Molecule encoding/decoding
  - Gas optimization
  - Security considerations

---

## 2. Token Minting Control

### Current State (Phase 1 - MVP)
- **Design flaw identified**: Single-Use Lock prevents ongoing minting
- **Updated design**: xUDT args = market owner's lock hash
- Market owner can mint tokens freely (no restrictions)
- **Risk**: Market owner could mint 1 million tokens without adding escrow

### Production Requirements (Phase 2)
- **Atomic minting**: Tokens can only be minted in same transaction that:
  1. Updates market cell with increased escrow
  2. Updates token supply in market data
  3. Satisfies CSMM formula

- **Options**:
  - Type ID cell that links token minting to market updates
  - Output Type Proxy Lock that validates market cell changes
  - Custom type script that reads market cell data and validates

### References
- See `/home/ali/ccc/packages/demo/src/app/connected/(tools)/IssueXUdtTypeId/page.tsx`
- Output Type Proxy Lock example in CCC SDK

---

## 3. Oracle Integration for Resolution

### Current State (Phase 1 - MVP)
- **Manual resolution** by market owner
- Owner calls `resolveMarket(outcome: boolean)`
- **No verification** that outcome is correct
- **Trust assumption**: Market owner will resolve honestly

### Production Requirements (Phase 2)
- **Oracle integration** options:
  1. **CKB Oracle** (if available)
  2. **Off-chain oracle with on-chain verification**:
     - Chainlink-style price feeds
     - Multiple oracle signatures required
     - Dispute period
  3. **Decentralized resolution**:
     - Token holder voting
     - Schelling point mechanisms
     - Reality.eth style escalation

- **Dispute mechanism**:
  - Time window to challenge resolution
  - Stake required to dispute
  - Arbitration process

### Edge Cases
- What if oracle is unavailable?
- What if event is ambiguous?
- Invalid markets (need refund mechanism)

---

## 4. Liquidity Management

### Current State (Phase 1 - MVP)
- Initial supply: 1000 YES + 1000 NO tokens
- **Fixed** - no way to add/remove liquidity
- If one side gets too low, prices become extreme
- **Minimum liquidity**: 100 tokens (arbitrary constant)

### Production Requirements (Phase 2)
- **Dynamic liquidity provision**:
  - Allow LPs to add liquidity (mint balanced YES+NO pairs)
  - LP tokens to track ownership
  - Fees distributed to LPs

- **Liquidity incentives**:
  - Trading fees (e.g., 0.3%)
  - LP rewards
  - Volume-based incentives

- **Circuit breakers**:
  - Max bet size relative to liquidity
  - Slippage protection
  - Prevent market manipulation

### Example
```
Current: 1000 YES, 100 NO (YES very expensive)
- Need mechanism to add liquidity: +500 YES, +500 NO
- Or auto-rebalancing when imbalance occurs
```

---

## 5. Multi-Market Support & Market Registry

### Current State (Phase 1 - MVP)
- **Single market** tracked in .env file
- Manual OutPoint tracking
- No discovery mechanism
- No market categorization

### Production Requirements (Phase 2)
- **Market Registry Cell**:
  - List of all active markets
  - Market metadata (question, category, creator, etc.)
  - Status (active, resolved, disputed)

- **Market Discovery**:
  - Query all markets by category
  - Search by keywords
  - Filter by status/deadline

- **Market Cell Structure**:
  ```
  Market Cell:
    Type: MarketRegistryType (links to registry)
    Data:
      - Market metadata
      - Token type hashes
      - Creator
      - Category
      - Tags
  ```

### Related Infrastructure
- Indexer for market queries
- GraphQL API
- Frontend market browser

---

## 6. Fee Model & Economic Sustainability

### Current State (Phase 1 - MVP)
- **No fees** (except CKB transaction fees)
- Market owner pays for:
  - Market creation (~300 CKB for seal cells + market cell)
  - Gas fees for resolution
- **Not sustainable** for public markets

### Production Requirements (Phase 2)
- **Trading fees**:
  - Small percentage (0.1-0.5%) on each bet
  - Goes to protocol treasury or market creator

- **Market creation bond**:
  - Require stake to create market
  - Slashed if resolved incorrectly
  - Returned after successful resolution

- **Creator incentives**:
  - % of trading volume
  - Encourages quality markets

### Example Fee Structure
```
Bet: 1000 CKB on YES
- Fee: 3 CKB (0.3%)
- To market creator: 1 CKB
- To protocol: 1 CKB
- To liquidity providers: 1 CKB
- Actual bet added to escrow: 997 CKB
```

---

## 7. Token Transfer & Trading

### Current State (Phase 1 - MVP)
- Users can hold YES/NO tokens in xUDT cells
- **No transfer functionality implemented**
- **No secondary market**
- Tokens only useful for claiming after resolution

### Production Requirements (Phase 2)
- **Token transfers**:
  - Implement `transferTokens(to, amount, side)` function
  - Users can trade tokens peer-to-peer

- **Order book** (optional):
  - On-chain limit orders
  - Match buyers/sellers
  - More capital efficient than CSMM

- **Hybrid model**:
  - CSMM for minting/burning (vs. house)
  - Order book for peer-to-peer trading
  - Best of both worlds

### Use Cases
- Alice buys 100 YES tokens at 0.6 CKB each
- Price moves to 0.8 CKB
- Alice sells 50 YES tokens to Bob at 0.75 CKB (profit taking)
- Alice keeps 50 YES for final resolution

---

## 8. Edge Cases & Safety

### Current State (Phase 1 - MVP)
**Not handled**:
- Market creator disappears before resolution
- Deadline passes, no bets placed (empty market)
- Only one side has bets (cannot resolve fairly)
- Escrow depletion (what if total claims > escrow?)
- Rounding errors in CSMM calculations
- Integer overflow in token amounts
- Cell capacity arithmetic edge cases

### Production Requirements (Phase 2)

#### Invalid Market Handling
```typescript
// Market with no bets or one-sided
if (yesSupply === 0n || noSupply === 0n) {
  // Refund all bettors
  // Market creator loses creation bond
}
```

#### Escrow Safety
```typescript
// Before allowing claim
invariant: sum(all_payouts) <= total_escrow

// Track claimed amounts
marketData.totalClaimed += payout;
assert(marketData.totalClaimed <= marketData.totalEscrow);
```

#### Rounding Protection
```typescript
// Use fixed-point math with high precision
const PRECISION = 10n ** 18n;  // 18 decimals
const tokens = (betAmount * PRECISION) / price;
```

#### Deadline Enforcement
```typescript
// In type script
if (currentTimestamp > deadline && !resolved) {
  // Auto-resolve or refund
}
```

---

## 9. Gas Optimization

### Current State (Phase 1 - MVP)
- No optimization considerations
- Large market data (114 bytes)
- Encoding not optimized
- May hit CKB Script execution limits

### Production Requirements (Phase 2)
- **Data compression**:
  - Use Molecule schema (more efficient than manual encoding)
  - Bit packing for booleans
  - Variable-length encoding for numbers

- **Script optimization**:
  - Minimize on-chain computation
  - Cache expensive calculations
  - Use syscalls efficiently

- **Cell splitting**:
  - Separate market metadata from state
  - Only update state cell frequently
  - Metadata cell stays static

### Example
```
Current: 114 bytes per market
Optimized:
  - Metadata cell: 80 bytes (static)
  - State cell: 34 bytes (updated frequently)
```

---

## 10. Multi-Signature & Governance

### Current State (Phase 1 - MVP)
- **Single owner** controls market
- No checks and balances
- Centralized resolution

### Production Requirements (Phase 2)
- **Multi-sig market ownership**:
  - Require M-of-N signatures for resolution
  - Prevents single point of failure

- **DAO governance**:
  - Token holders vote on disputes
  - Protocol parameter updates
  - Treasury management

- **Timelock for resolution**:
  - Announce outcome
  - Wait 24 hours
  - Allow challenges before finalizing

---

## 11. Token Burning & Claiming UX

### Current State (Phase 1 - MVP)
- User must **manually claim** each winning token cell
- One transaction per token cell
- If user has 5 YES token cells → 5 transactions
- **Gas inefficient**
- **Poor UX**

### Production Requirements (Phase 2)
- **Batch claiming**:
  ```typescript
  // Claim all winning token cells in one transaction
  inputs: [market_cell, token_cell_1, token_cell_2, ..., token_cell_N]
  outputs: [updated_market, single_payout_cell]
  ```

- **Auto-compact tokens**:
  - Merge multiple small token cells into one
  - Reduce cell count

- **Automatic claiming** (advanced):
  - Off-chain service monitors resolutions
  - Aggregates claims for users
  - Users sign once, service batches

---

## 12. Cross-Chain Integration

### Current State (Phase 1 - MVP)
- CKB only
- No cross-chain assets

### Production Requirements (Phase 2)
- **RGB++ integration**:
  - Bet with BTC via RGB++
  - BTC-backed stablecoins as bet currency

- **Bridge to other chains**:
  - Accept USDT/USDC via bridges
  - Cross-chain oracles for events on other chains

- **Lightning Network**:
  - Fast micro-bets via Lightning
  - Settle to CKB periodically

---

## 13. Privacy Considerations

### Current State (Phase 1 - MVP)
- **Fully public**:
  - All bets visible
  - Token holdings visible
  - Betting patterns can be tracked

### Production Requirements (Phase 2)
- **Private bets** (optional):
  - Zero-knowledge proofs for bet amounts
  - Reveal only after resolution
  - Prevent front-running / market manipulation

- **Private balances**:
  - Users don't reveal total token holdings
  - Only reveal during claim

---

## 14. Testing & Auditing

### Current State (Phase 1 - MVP)
- **No tests**
- Manual testing only
- No security audit

### Production Requirements (Phase 2)
- **Unit tests**:
  - Test all CSMM calculations
  - Test edge cases (zero liquidity, overflow, etc.)

- **Integration tests**:
  - Full market lifecycle (create → bet → resolve → claim)
  - Multi-user scenarios

- **Type script testing**:
  - CKB Script simulator
  - Test all validation rules

- **Security audit**:
  - Professional audit of type scripts
  - Economic security analysis
  - Fuzzing for edge cases

---

## 15. Market Metadata & UI

### Current State (Phase 1 - MVP)
- Market question stored off-chain (in example script)
- No description
- No images/icons
- No social features

### Production Requirements (Phase 2)
- **Rich metadata**:
  ```typescript
  {
    question: "Will BTC hit $100k by EOY 2025?",
    description: "Resolves YES if...",
    category: "Crypto",
    tags: ["bitcoin", "price"],
    imageUrl: "ipfs://...",
    createdBy: "ckb1...",
    createdAt: 1234567890,
    resolutionSource: "CoinGecko API",
  }
  ```

- **Social features**:
  - Comments / discussion
  - Sharing
  - Leaderboards

- **Analytics**:
  - Trading volume charts
  - Price history
  - Liquidity depth

---

## 16. Legal & Compliance

### Current State (Phase 1 - MVP)
- No legal considerations
- No KYC/AML
- Educational/experimental only

### Production Requirements (Phase 2)
- **Jurisdictional restrictions**:
  - Block certain countries
  - Age verification

- **Prohibited markets**:
  - No assassination markets
  - No illegal activity predictions
  - Content moderation

- **KYC for large markets**:
  - Above certain threshold, require identity

- **Tax reporting**:
  - Help users calculate gains/losses
  - Generate tax forms

---

## 17. Upgradeability

### Current State (Phase 1 - MVP)
- **Not upgradeable**
- Type scripts (when added) will be immutable
- Code hash is fixed

### Production Requirements (Phase 2)
- **Proxy pattern**:
  - Type script delegates to upgradeable logic
  - Admin can update implementation

- **Migration path**:
  - Allow users to migrate from v1 to v2
  - Preserve balances and positions

- **Versioning**:
  - Multiple market versions can coexist
  - Users choose which version to use

---

## Priority Ranking

### Critical (Must Have for Launch)
1. ✅ Type scripts for validation
2. ✅ Proper xUDT minting control
3. ✅ Oracle integration
4. ✅ Security audit
5. ✅ Edge case handling

### High Priority
6. Market registry
7. Fee model
8. Liquidity management
9. Batch claiming
10. Testing infrastructure

### Medium Priority
11. Token transfers
12. Multi-sig governance
13. Gas optimization
14. Cross-chain integration

### Nice to Have
15. Privacy features
16. Social features
17. Advanced analytics
18. Upgradeability

---

## Estimated Timeline

**Phase 1 (Current MVP)**:
- Basic functionality
- Trust-based
- Learning/testing only
- **Status**: In progress

**Phase 2 (Production Beta)**:
- Items 1-10 above
- Limited public release
- Audited contracts
- **Estimate**: 3-6 months

**Phase 3 (Full Production)**:
- All items
- Multi-chain
- Advanced features
- **Estimate**: 6-12 months

---

## Resources Needed

### Development
- CKB type script developer (Rust)
- Frontend developer (React/Next.js)
- Backend developer (indexer, API)

### Infrastructure
- CKB nodes (mainnet + testnet)
- Indexer service
- Oracle service
- IPFS for metadata

### Legal
- Legal counsel for compliance
- Terms of service
- Privacy policy

### Security
- Security auditor for type scripts
- Bug bounty program
- Insurance fund for exploits

---

## Conclusion

Phase 1 (MVP) makes many simplifications to focus on learning CKB and proving the concept. A production prediction market requires significant additional work in:

1. **Security** (type scripts, audits)
2. **Economics** (fees, incentives, liquidity)
3. **UX** (batch operations, discovery, analytics)
4. **Legal** (compliance, moderation)

This document serves as a roadmap for future development.
