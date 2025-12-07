# Testing Market Token Contract with ckb-debugger

## Test Setup

This directory contains mock transaction files for testing the market token contract offline using ckb-debugger.

## Mock Transaction: `mock_tx_mint.json`

Simulates a complete set minting operation:

**Scenario:**
- User deposits 100 CKB (in shannons: 0x174876e800 = 100_00000000)
- Mints 100 YES tokens + 100 NO tokens
- Market cell state updates: 0→100 for both YES and NO supply

**Transaction Structure:**

### Inputs
1. **Market Cell** (before minting):
   - YES supply: 0
   - NO supply: 0
   - Resolved: false

### Outputs
1. **Market Cell** (after minting):
   - YES supply: 100 (0x64 in hex)
   - NO supply: 100 (0x64 in hex)
   - Resolved: false

2. **YES Token Cell**:
   - Amount: 100 tokens (16 bytes LE: 0x64000000000000000000000000000000)
   - Type script args: market_hash + 0x01 (YES token ID)

3. **NO Token Cell**:
   - Amount: 100 tokens (16 bytes LE: 0x64000000000000000000000000000000)
   - Type script args: market_hash + 0x02 (NO token ID)

## Running Tests

### Basic Test
```bash
ckb-debugger --tx-file tests/mock_tx_mint.json --script-group-type type -i 1 -b ../build/market-token
```

Flags:
- `--tx-file`: Path to mock transaction JSON
- `--script-group-type type`: Run type script validation
- `-i 1`: Test the type script of output at index 1 (YES token)
- `-b`: Path to contract binary

### Test All Token Outputs

Test YES token (output index 1):
```bash
ckb-debugger --tx-file tests/mock_tx_mint.json --script-group-type type -i 1 -b ../build/market-token
```

Test NO token (output index 2):
```bash
ckb-debugger --tx-file tests/mock_tx_mint.json --script-group-type type -i 2 -b ../build/market-token
```

### Expected Result

If validation passes, you should see:
```
Run result: 0
Total cycles consumed: XXXXX
```

Exit code 0 means the contract validated successfully.

### Debugging

To see debug output:
```bash
ckb-debugger --tx-file tests/mock_tx_mint.json --script-group-type type -i 1 -b ../build/market-token -d
```

To get detailed execution trace:
```bash
ckb-debugger --tx-file tests/mock_tx_mint.json --script-group-type type -i 1 -b ../build/market-token --mode full
```

## Test Scenarios to Add

1. ✅ **Valid minting**: Equal YES and NO tokens (current test)
2. ⏳ **Invalid minting**: Unequal YES and NO tokens (should fail)
3. ⏳ **Burning complete set**: Equal YES and NO burned before resolution
4. ⏳ **Claiming payout**: Burn winning tokens after resolution
5. ⏳ **Invalid claim**: Try to burn losing tokens (should fail)
6. ⏳ **Transfer**: Just moving tokens between users (should pass)

## Cycle Consumption

The debugger will report cycle consumption, which is important for:
- Gas cost estimation
- Optimization opportunities
- Ensuring contract stays within CKB cycle limits

## Notes

- The mock transaction uses placeholder hashes (0xaaa..., 0xbbb...)
- In real deployment, these would be actual contract code hashes
- The market cell data format matches our MarketData structure
- Token amounts are u128 little-endian (16 bytes)
