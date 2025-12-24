# CKB Prediction Market - CCC Frontend

A clean, modern frontend for the CKB Prediction Market built entirely with CCC (no ckb-sdk-rust).

## Features

✅ **Pure CCC Implementation**: Uses @ckb-ccc/shell for all blockchain interactions
✅ **Network Switching**: Seamless toggle between devnet and testnet
✅ **Devnet Support**: Direct private key integration for local development
✅ **JoyID Ready**: Architecture prepared for JoyID wallet integration (testnet)
✅ **Complete Market Operations**: Create, mint, resolve, claim

## Architecture

### Technology Stack
- **Frontend**: Vanilla HTML/CSS/JavaScript (no build process needed)
- **CKB SDK**: CCC (@ckb-ccc/shell) via ES modules
- **Wallet**:
  - Devnet: Private key signer
  - Testnet: JoyID (coming soon)

### File Structure
```
frontend-ccc/
├── index.html          # Main UI
├── js/
│   ├── app.js         # Main application logic
│   └── config.js      # Contract configurations
├── css/               # (Future: separate stylesheets)
└── README.md          # This file
```

## Setup

### 1. Start Devnet
```bash
offckb node
```

### 2. Deploy Contracts
Ensure contracts are deployed to devnet:
```bash
cd /home/ali/prediction-market/devnet
cargo run
```

### 3. Serve Frontend
```bash
cd /home/ali/prediction-market/frontend-ccc
python3 -m http.server 8002
```

### 4. Open Browser
```
http://localhost:8002/index.html
```

## Network Configuration

### Devnet
- **RPC**: http://127.0.0.1:8114
- **Market Code Hash**: 0xfe3a71cfcb556500e7f760b5c853be8fc082d32748aa9e5a98e25d79d4116485
- **Private Key**: offckb account #0 (hardcoded)

### Testnet (Coming Soon)
- **RPC**: https://testnet.ckb.dev
- **Market Code Hash**: 0x2ff39cf33ec11c42c611240e9a61050194553c2f0965b86d0b25bf61ae692cdb
- **Wallet**: JoyID integration

## Operations

### 1. Create Market
Creates a new market cell with:
- Initial capacity: 128 CKB
- YES supply: 0
- NO supply: 0
- Resolved: false

### 2. Mint Tokens
Mints equal YES/NO token pairs:
- Requires 100 CKB per token
- Updates market cell supply
- Creates token cells for user

### 3. Resolve Market
Declares winning outcome:
- Sets resolved = true
- Sets outcome (YES/NO)
- Freezes minting

### 4. Claim Winnings
Burns winning tokens for CKB:
- 1 winning token = 100 CKB
- Decreases market capacity
- Returns CKB to claimer

## Development Status

### ✅ Completed
- [x] Project structure
- [x] Network switching UI
- [x] CCC client initialization
- [x] Devnet wallet integration
- [x] Create market operation

### 🚧 In Progress
- [ ] Mint tokens implementation
- [ ] Resolve market implementation
- [ ] Claim tokens implementation
- [ ] Market cell querying/tracking

### 📋 Planned
- [ ] JoyID integration for testnet
- [ ] Market browsing interface
- [ ] Transaction history
- [ ] Error handling improvements
- [ ] Loading states and animations

## Key Differences from Rust Backend

| Feature | Rust Backend | CCC Frontend |
|---------|-------------|--------------|
| SDK | ckb-sdk-rust | @ckb-ccc/shell |
| Language | Rust | JavaScript/TypeScript |
| Wallet | Private key only | Private key + JoyID |
| Architecture | API server | Pure frontend |
| Cell Queries | Direct RPC | CCC client methods |

## Troubleshooting

### "Failed to resolve module specifier"
- Make sure you're serving via HTTP (not file://)
- esm.sh requires network access for CDN

### "Connection failed"
- Check devnet is running: `curl http://127.0.0.1:8114`
- Verify RPC endpoint in js/app.js

### "Contract not found"
- Redeploy contracts: `cd devnet && cargo run`
- Update code hashes in js/app.js

## Next Steps

1. Implement full mint/resolve/claim operations
2. Add market cell state tracking
3. Integrate JoyID for testnet
4. Add comprehensive error handling
5. Build market browsing UI

---

**Built with CCC** | Pure Frontend | No Build Required
