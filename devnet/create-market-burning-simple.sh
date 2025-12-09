#!/bin/bash
set -e

echo "=== Creating Market Cell with Burning Support ==="
echo ""

PRIVKEY="6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6"
echo $PRIVKEY > privkey.txt

# Use existing capacity cell from previous operations
INPUT_TX="0x563812c99b336d1c2257c34f2a44ee7a835b926849ca57195f2be740cd086757"
INPUT_IDX="0x3"

# New contract deployment info (with burning support)
MARKET_TX="0xe02d69e39aa8235332e4cf037abd00a3049c78ba59d57a7dc93c38393baad2ac"
MARKET_CODE_HASH="0x29707d6ffcd4a78ac68fd9b7539ca7c5a6781713ef5be337f1f60896d681cd30"
ALWAYS_SUCCESS_TX="0x7ba0e0efd0a22333afb85f468a7418c9078ec0b801dc2477b8ed9e28c75cdd64"
ALWAYS_SUCCESS_CODE_HASH="0x21854a7b67a2c4a71a8558c6d4023cf787e71db49d09cb4aa8748dbf6a8ef6ec"

echo "Building market creation transaction..."
echo "  Input: $INPUT_TX index $INPUT_IDX"
echo "  Market code hash: $MARKET_CODE_HASH"
echo ""

node << 'EONODE'
const fs = require('fs');

const tx = {
  version: "0x0",
  cell_deps: [
    // Secp256k1 dep group
    { out_point: { tx_hash: "0x75be96e1871693f030db27ddae47890a28ab180e88e36ebb3575d9f1377d3da7", index: "0x0" }, dep_type: "dep_group" },
    // Market contract (with burning support)
    { out_point: { tx_hash: "0xe02d69e39aa8235332e4cf037abd00a3049c78ba59d57a7dc93c38393baad2ac", index: "0x0" }, dep_type: "code" },
    // Always-success lock
    { out_point: { tx_hash: "0x7ba0e0efd0a22333afb85f468a7418c9078ec0b801dc2477b8ed9e28c75cdd64", index: "0x0" }, dep_type: "code" }
  ],
  header_deps: [],
  inputs: [
    { since: "0x0", previous_output: { tx_hash: "0x563812c99b336d1c2257c34f2a44ee7a835b926849ca57195f2be740cd086757", index: "0x3" } }
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
    "0x00000000000000000000000000000000000000000000000000000000000000000000"  // 0 YES, 0 NO
  ],
  witnesses: []
};

fs.writeFileSync('market-burning.json', JSON.stringify({ transaction: tx, multisig_configs: {}, signatures: {} }, null, 2));
console.log("✓ Market creation transaction built");
EONODE

echo "Signing and sending transaction..."
ckb-cli tx sign-inputs --tx-file market-burning.json --privkey-path privkey.txt --add-signatures --skip-check
TX_HASH=$(ckb-cli tx send --tx-file market-burning.json --skip-check 2>&1 | grep -oP '0x[0-9a-f]{64}' | head -1)

echo ""
echo "✓ Market cell created with burning support!"
echo "  TX hash: $TX_HASH"
echo "  Market code hash: $MARKET_CODE_HASH"
echo ""
echo "Saving to deployed-burning.json..."
echo "{\"market_cell_tx\": \"$TX_HASH\", \"market_cell_index\": \"0x0\"}" > market-cell-burning.json
echo "✓ Done!"
