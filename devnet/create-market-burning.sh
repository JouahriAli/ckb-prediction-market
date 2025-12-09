#!/bin/bash
set -e

echo "=== Creating Market Cell with Burning Support ==="
echo ""

PRIVKEY="6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6"
echo $PRIVKEY > privkey.txt

# Get address for capacity input
ADDRESS=$(ckb-cli util key-info --privkey-path privkey.txt --no-color | grep 'address' | grep 'testnet' | awk '{print $2}')
echo "Using address: $ADDRESS"

# Find a capacity cell to use from wallet
echo "Finding capacity cell..."
CELL_INFO=$(ckb-cli wallet get-live-cells --address $ADDRESS --limit 1 | grep -A 5 "live cells" | tail -n 3)
INPUT_TX=$(echo "$CELL_INFO" | grep "tx_hash" | awk '{print $2}')
INPUT_IDX=$(echo "$CELL_INFO" | grep "index" | awk '{print $2}')

if [ -z "$INPUT_TX" ]; then
    echo "Error: No capacity cells found. Please fund the address first."
    exit 1
fi

echo "Using cell: $INPUT_TX index $INPUT_IDX"

# New contract deployment info
MARKET_TX="0xe02d69e39aa8235332e4cf037abd00a3049c78ba59d57a7dc93c38393baad2ac"
MARKET_CODE_HASH="0x29707d6ffcd4a78ac68fd9b7539ca7c5a6781713ef5be337f1f60896d681cd30"
ALWAYS_SUCCESS_TX="0x7ba0e0efd0a22333afb85f468a7418c9078ec0b801dc2477b8ed9e28c75cdd64"
ALWAYS_SUCCESS_CODE_HASH="0x21854a7b67a2c4a71a8558c6d4023cf787e71db49d09cb4aa8748dbf6a8ef6ec"

echo ""
echo "Building market creation transaction..."

INPUT_TX=$INPUT_TX INPUT_IDX=$INPUT_IDX node << 'EONODE'
const fs = require('fs');

const inputTx = process.env.INPUT_TX;
const inputIdx = process.env.INPUT_IDX;

const tx = {
  version: "0x0",
  cell_deps: [
    // Secp256k1 dep group for signature verification
    { out_point: { tx_hash: "0x75be96e1871693f030db27ddae47890a28ab180e88e36ebb3575d9f1377d3da7", index: "0x0" }, dep_type: "dep_group" },
    // Market contract
    { out_point: { tx_hash: "0xe02d69e39aa8235332e4cf037abd00a3049c78ba59d57a7dc93c38393baad2ac", index: "0x0" }, dep_type: "code" },
    // Always-success lock
    { out_point: { tx_hash: "0x7ba0e0efd0a22333afb85f468a7418c9078ec0b801dc2477b8ed9e28c75cdd64", index: "0x0" }, dep_type: "code" }
  ],
  header_deps: [],
  inputs: [
    { since: "0x0", previous_output: { tx_hash: inputTx, index: inputIdx } }
  ],
  outputs: [
    {
      capacity: "0x2faf08000",  // 128 CKB minimum
      lock: {
        code_hash: "0x21854a7b67a2c4a71a8558c6d4023cf787e71db49d09cb4aa8748dbf6a8ef6ec",
        hash_type: "data2",
        args: "0x"
      },
      type: {
        code_hash: "0x29707d6ffcd4a78ac68fd9b7539ca7c5a6781713ef5be337f1f60896d681cd30",
        hash_type: "data2",
        args: "0x"
      }
    }
  ],
  outputs_data: [
    "0x00000000000000000000000000000000000000000000000000000000000000000000"  // 0 YES, 0 NO, not resolved
  ],
  witnesses: []
};

fs.writeFileSync('market-burning.json', JSON.stringify({ transaction: tx, multisig_configs: {}, signatures: {} }, null, 2));
console.log("✓ Market creation transaction built");
console.log("  Market capacity: 128 CKB");
console.log("  Initial supply: 0 YES, 0 NO");
EONODE

echo ""
echo "Signing and sending transaction..."
ckb-cli tx sign-inputs --tx-file market-burning.json --privkey-path privkey.txt --add-signatures --skip-check
TX_HASH=$(ckb-cli tx send --tx-file market-burning.json --skip-check | grep -oP '0x[0-9a-f]{64}')

echo ""
echo "✓ Market cell created!"
echo "  TX hash: $TX_HASH"
echo "  Market code hash: $MARKET_CODE_HASH"
echo ""
echo "Saving market cell info..."
echo "{\"market_tx\": \"$TX_HASH\", \"market_index\": \"0x0\", \"market_code_hash\": \"$MARKET_CODE_HASH\"}" > market-burning-cell.json
echo "✓ Saved to market-burning-cell.json"
