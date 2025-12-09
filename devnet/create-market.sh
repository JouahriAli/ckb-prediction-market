#!/bin/bash
set -e

echo "=== Creating Market Cell on Devnet (with always-success lock) ==="
echo ""

# Account #0 from offckb
OWNER_ADDRESS="ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqvwg2cen8extgq8s5puft8vf40px3f599cytcyd8"
PRIVKEY="6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6"

# Input from lockless cell test (41,989,769 CKB)
INPUT_TX="0x604c689a7316468cc0ef6e059adf5776b22f737464a9367f1c4c7e4f59371404"
INPUT_IDX=1

# Contract info from offckb deployments
MARKET_TX="0x4450343ae605e673c0bcbd8789edb4a148806462d8d5d016a839ccfb6205ea10"
MARKET_CODE_HASH="0xb1279e1fcecb5c3ead2020f1ab82ab4943efb7581fc058f59ee66c29796e548c"

# Always-success contract info
ALWAYS_SUCCESS_TX="0x7ba0e0efd0a22333afb85f468a7418c9078ec0b801dc2477b8ed9e28c75cdd64"
ALWAYS_SUCCESS_CODE_HASH="0x21854a7b67a2c4a71a8558c6d4023cf787e71db49d09cb4aa8748dbf6a8ef6ec"

# Market data (34 bytes: yes_supply + no_supply + resolved + outcome, all zeros)
MARKET_DATA="0x00000000000000000000000000000000000000000000000000000000000000000000"

echo "Step 1: Initialize transaction"
ckb-cli tx init --tx-file market.json

echo "Step 2: Add input cell"
ckb-cli tx add-input \
  --tx-hash $INPUT_TX \
  --index $INPUT_IDX \
  --tx-file market.json

echo "Step 3: Add market output (128 CKB with market data)"
ckb-cli tx add-output \
  --to-sighash-address $OWNER_ADDRESS \
  --capacity 128 \
  --to-data $MARKET_DATA \
  --tx-file market.json

echo "Step 4: Add change output (41,989,640 CKB - leaves 1 CKB for fees)"
ckb-cli tx add-output \
  --to-sighash-address $OWNER_ADDRESS \
  --capacity 41989640 \
  --tx-file market.json

echo "Step 5: Manually add market type script and contract cell dep"
echo $PRIVKEY > privkey.txt

node << 'EONODE'
const fs = require('fs');
const tx = JSON.parse(fs.readFileSync('market.json', 'utf8'));

// Change market cell lock to always-success
tx.transaction.outputs[0].lock = {
  code_hash: "0x21854a7b67a2c4a71a8558c6d4023cf787e71db49d09cb4aa8748dbf6a8ef6ec",
  hash_type: "data2",
  args: "0x"
};

// Add market type script to first output
tx.transaction.outputs[0].type = {
  code_hash: "0xb1279e1fcecb5c3ead2020f1ab82ab4943efb7581fc058f59ee66c29796e548c",
  hash_type: "data2",
  args: "0x"
};

// Add market contract cell dep
tx.transaction.cell_deps.push({
  out_point: {
    tx_hash: "0x4450343ae605e673c0bcbd8789edb4a148806462d8d5d016a839ccfb6205ea10",
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

fs.writeFileSync('market.json', JSON.stringify(tx, null, 2));
console.log("✓ Added always-success lock, market type script, and cell deps");
EONODE

echo "Step 6: Sign transaction"
ckb-cli tx sign-inputs \
  --tx-file market.json \
  --privkey-path privkey.txt \
  --add-signatures

echo "Step 7: Send transaction (with --skip-check for custom lock)"
TX_HASH=$(ckb-cli tx send --tx-file market.json --skip-check)

echo ""
echo "✅ Market cell created!"
echo "TX Hash: $TX_HASH"
echo ""
echo "View transaction:"
echo "  ckb-cli rpc get_transaction --hash $TX_HASH"
echo ""

# Save deployment info
cat > deployed.json << EOFJSON
{
  "network": "devnet",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
  "marketCell": {
    "txHash": $TX_HASH,
    "outPoint": {
      "txHash": $TX_HASH,
      "index": "0x0"
    }
  }
}
EOFJSON

echo "✅ Deployment info saved to devnet/deployed.json"
