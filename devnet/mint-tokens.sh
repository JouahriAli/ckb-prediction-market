#!/bin/bash
set -e

echo "=== Minting YES/NO Tokens on Devnet ==="
echo ""

# Account #0 from offckb
OWNER_ADDRESS="ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqvwg2cen8extgq8s5puft8vf40px3f599cytcyd8"
PRIVKEY="6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6"

# Market cell (with always-success lock)
MARKET_TX="0x355ec54fd37460639ab3d6ec3be5b1a3b5b3375059450b0143bac36af75d273d"
MARKET_IDX=0

# Contract deployments
MARKET_CONTRACT_TX="0x4450343ae605e673c0bcbd8789edb4a148806462d8d5d016a839ccfb6205ea10"
MARKET_CODE_HASH="0xb1279e1fcecb5c3ead2020f1ab82ab4943efb7581fc058f59ee66c29796e548c"

TOKEN_CONTRACT_TX="0x4f80b8ddd59bfb87dc45f795d89f3ae8daa128d75c21ad6ecddcbbd6f93bfe5d"
TOKEN_CODE_HASH="0x54f68c08a051facc261167d0a45383cc5fa8b1ea7d1f9d9be5a7e623e27a1320"

ALWAYS_SUCCESS_TX="0x7ba0e0efd0a22333afb85f468a7418c9078ec0b801dc2477b8ed9e28c75cdd64"
ALWAYS_SUCCESS_CODE_HASH="0x21854a7b67a2c4a71a8558c6d4023cf787e71db49d09cb4aa8748dbf6a8ef6ec"

# Minting parameters
MINT_AMOUNT=100
CKB_PER_TOKEN=100
COLLATERAL_CKB=$((MINT_AMOUNT * CKB_PER_TOKEN))
TOKEN_CELL_CAPACITY=150

echo "Minting: $MINT_AMOUNT YES + $MINT_AMOUNT NO tokens"
echo "Collateral: $COLLATERAL_CKB CKB ($CKB_PER_TOKEN CKB per token)"
echo ""

# Calculate market type hash
echo "Step 1: Calculate market type hash"
echo $PRIVKEY > privkey.txt

MARKET_TYPE_HASH=$(node << 'EONODE'
const { ccc } = require("@ckb-ccc/shell");

const marketTypeScript = new ccc.Script(
  "0xb1279e1fcecb5c3ead2020f1ab82ab4943efb7581fc058f59ee66c29796e548c",
  "data2",
  "0x"
);

const hash = marketTypeScript.hash();
const hashHex = typeof hash === "string"
  ? (hash.startsWith("0x") ? hash : "0x" + hash)
  : "0x" + Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');

console.log(hashHex);
EONODE
)

echo "Market type hash: $MARKET_TYPE_HASH"
echo ""

# Create market data (yes_supply=100, no_supply=100, resolved=false, outcome=false)
echo "Step 2: Generate market and token data"
MARKET_DATA=$(node << EONODE
const buffer = Buffer.alloc(34);
// yes_supply (u128 LE)
buffer.writeBigUInt64LE(BigInt($MINT_AMOUNT) & BigInt("0xFFFFFFFFFFFFFFFF"), 0);
buffer.writeBigUInt64LE(BigInt($MINT_AMOUNT) >> BigInt(64), 8);
// no_supply (u128 LE)
buffer.writeBigUInt64LE(BigInt($MINT_AMOUNT) & BigInt("0xFFFFFFFFFFFFFFFF"), 16);
buffer.writeBigUInt64LE(BigInt($MINT_AMOUNT) >> BigInt(64), 24);
// resolved and outcome
buffer.writeUInt8(0, 32);
buffer.writeUInt8(0, 33);
console.log("0x" + buffer.toString("hex"));
EONODE
)

TOKEN_DATA=$(node << EONODE
const buffer = Buffer.alloc(16);
buffer.writeBigUInt64LE(BigInt($MINT_AMOUNT) & BigInt("0xFFFFFFFFFFFFFFFF"), 0);
buffer.writeBigUInt64LE(BigInt($MINT_AMOUNT) >> BigInt(64), 8);
console.log("0x" + buffer.toString("hex"));
EONODE
)

echo "Market data: $MARKET_DATA"
echo "Token data: $TOKEN_DATA"
echo ""

# Initialize transaction
echo "Step 3: Build base transaction with ckb-cli"
ckb-cli tx init --tx-file mint.json

# Add market cell input
ckb-cli tx add-input \
  --tx-hash $MARKET_TX \
  --index $MARKET_IDX \
  --tx-file mint.json

# Add updated market output (128 + collateral)
MARKET_CAPACITY=$((128 + COLLATERAL_CKB))
ckb-cli tx add-output \
  --to-sighash-address $OWNER_ADDRESS \
  --capacity $MARKET_CAPACITY \
  --to-data $MARKET_DATA \
  --tx-file mint.json

# Add YES token output
ckb-cli tx add-output \
  --to-sighash-address $OWNER_ADDRESS \
  --capacity $TOKEN_CELL_CAPACITY \
  --to-data $TOKEN_DATA \
  --tx-file mint.json

# Add NO token output
ckb-cli tx add-output \
  --to-sighash-address $OWNER_ADDRESS \
  --capacity $TOKEN_CELL_CAPACITY \
  --to-data $TOKEN_DATA \
  --tx-file mint.json

# Add additional input for capacity (change cell from market creation)
ckb-cli tx add-input \
  --tx-hash $MARKET_TX \
  --index 1 \
  --tx-file mint.json

# Add change output
# Total inputs: 128 + 41,989,640 = 41,989,768 CKB
# Total outputs needed: 10,128 + 150 + 150 + 1 (fee) = 10,429 CKB
# Change: 41,989,640 - 10,000 - 150 - 150 - 1 = 41,979,339 CKB
CHANGE_CAPACITY=41979339
ckb-cli tx add-output \
  --to-sighash-address $OWNER_ADDRESS \
  --capacity $CHANGE_CAPACITY \
  --tx-file mint.json

echo "Step 4: Add type scripts, locks, and cell deps"
node << 'EONODE'
const fs = require('fs');
const tx = JSON.parse(fs.readFileSync('mint.json', 'utf8'));

// Set market cell output to use always-success lock (preserve it)
tx.transaction.outputs[0].lock = {
  code_hash: "0x21854a7b67a2c4a71a8558c6d4023cf787e71db49d09cb4aa8748dbf6a8ef6ec",
  hash_type: "data2",
  args: "0x"
};

// Add market type script to output 0
tx.transaction.outputs[0].type = {
  code_hash: "0xb1279e1fcecb5c3ead2020f1ab82ab4943efb7581fc058f59ee66c29796e548c",
  hash_type: "data2",
  args: "0x"
};

// Calculate market type hash for token args
const MARKET_TYPE_HASH = "0x6da49e9c7f74215921df034109d3bb6fe50518159934771f906ac07351e64efc";

// Add YES token type script to output 1
tx.transaction.outputs[1].type = {
  code_hash: "0x54f68c08a051facc261167d0a45383cc5fa8b1ea7d1f9d9be5a7e623e27a1320",
  hash_type: "data2",
  args: MARKET_TYPE_HASH + "01"
};

// Add NO token type script to output 2
tx.transaction.outputs[2].type = {
  code_hash: "0x54f68c08a051facc261167d0a45383cc5fa8b1ea7d1f9d9be5a7e623e27a1320",
  hash_type: "data2",
  args: MARKET_TYPE_HASH + "02"
};

// Add market contract cell dep
tx.transaction.cell_deps.push({
  out_point: {
    tx_hash: "0x4450343ae605e673c0bcbd8789edb4a148806462d8d5d016a839ccfb6205ea10",
    index: "0x0"
  },
  dep_type: "code"
});

// Add token contract cell dep
tx.transaction.cell_deps.push({
  out_point: {
    tx_hash: "0x4f80b8ddd59bfb87dc45f795d89f3ae8daa128d75c21ad6ecddcbbd6f93bfe5d",
    index: "0x0"
  },
  dep_type: "code"
});

// Add always-success cell dep
tx.transaction.cell_deps.push({
  out_point: {
    tx_hash: "0x7ba0e0efd0a22333afb85f468a7418c9078ec0b801dc2477b8ed9e28c75cdd64",
    index: "0x0"
  },
  dep_type: "code"
});

fs.writeFileSync('mint.json', JSON.stringify(tx, null, 2));
console.log("✓ Added type scripts, locks, and cell deps");
EONODE

# Sign transaction
echo ""
echo "Step 5: Sign transaction"
echo $PRIVKEY > privkey.txt
ckb-cli tx sign-inputs \
  --tx-file mint.json \
  --privkey-path privkey.txt \
  --add-signatures

# Send transaction
echo "Step 6: Send transaction (with --skip-check for custom locks)"
TX_HASH=$(ckb-cli tx send --tx-file mint.json --skip-check)

echo ""
echo "✅ Minting transaction sent!"
echo "TX Hash: $TX_HASH"
echo ""
echo "You now have:"
echo "  - $MINT_AMOUNT YES tokens"
echo "  - $MINT_AMOUNT NO tokens"
echo "  - Market supply: $MINT_AMOUNT YES, $MINT_AMOUNT NO"
echo ""
