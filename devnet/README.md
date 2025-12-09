# Devnet Testing

## Setup

The contracts are already deployed to devnet via offckb:
- Market contract: Check `/home/ali/.local/share/offckb-nodejs/devnet/contracts/market/`
- Market-token contract: Check `/home/ali/.local/share/offckb-nodejs/devnet/contracts/market-token/`
- Always-success lock: Check `/home/ali/.local/share/offckb-nodejs/devnet/contracts/always-success/`

## Pre-funded Accounts

Run `offckb accounts` to see all 20 pre-funded devnet accounts (each with 420M CKB).

## Creating Market Cell

Due to CCC library limitations with custom devnet configurations, the recommended approach is to use offckb's REPL environment or build transactions manually.

### Option 1: Manual Transaction (TODO)
See `create-market.cjs` for transaction skeleton generation.

### Option 2: offckb REPL (Recommended)
```bash
offckb repl --network devnet
```

Then in the REPL, you can use CKB tools to build and send transactions.

## Next Steps

1. Complete the market cell creation workflow
2. Implement minting transactions for devnet
3. Test the complete flow locally before testnet deployment
