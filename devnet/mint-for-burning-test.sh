#!/bin/bash
set -e

echo "=== Minting Tokens for Burning Test ==="
echo ""

PRIVKEY="6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6"
echo $PRIVKEY > privkey.txt

# Market cell from previous step
MARKET_TX="0xafd59d14f15b7b8a0bfed8d600cfc237b5615a68a96b9ad4791e72434d64dfa4"
MARKET_IDX="0x0"

# Capacity cell for collateral
CAPACITY_TX="0x563812c99b336d1c2257c34f2a44ee7a835b926849ca57195f2be740cd086757"
CAPACITY_IDX="0x3"

# Contract info
MARKET_CODE_HASH="0x29707d6ffcd4a78ac68fd9b7539ca7c5a6781713ef5be337f1f60896d681cd30"
TOKEN_CODE_HASH="0x54f68c08a051facc261167d0a45383cc5fa8b1ea7d1f9d9be5a7e623e27a1320"
ALWAYS_SUCCESS_CODE_HASH="0x21854a7b67a2c4a71a8558c6d4023cf787e71db49d09cb4aa8748dbf6a8ef6ec"

echo "Minting 50 YES + 50 NO tokens (5,000 CKB collateral)"
echo "  Market cell: $MARKET_TX:$MARKET_IDX"
echo ""

node << 'EONODE'
const fs = require('fs');

// Market type hash (calculated from type script)
const marketTypeHash = "0x50831a97f193f33e195a6d54048542b8d0c27633054106de0f2844bcdda34871";

const tx = {
  version: "0x0",
  cell_deps: [
    { out_point: { tx_hash: "0x75be96e1871693f030db27ddae47890a28ab180e88e36ebb3575d9f1377d3da7", index: "0x0" }, dep_type: "dep_group" },
    { out_point: { tx_hash: "0xe02d69e39aa8235332e4cf037abd00a3049c78ba59d57a7dc93c38393baad2ac", index: "0x0" }, dep_type: "code" },
    { out_point: { tx_hash: "0xca006eec29e52c70b00bdb307858c58c542be373ff2b0ca2d26fb295a0947799", index: "0x0" }, dep_type: "code" },
    { out_point: { tx_hash: "0x7ba0e0efd0a22333afb85f468a7418c9078ec0b801dc2477b8ed9e28c75cdd64", index: "0x0" }, dep_type: "code" }
  ],
  header_deps: [],
  inputs: [
    { since: "0x0", previous_output: { tx_hash: "0xafd59d14f15b7b8a0bfed8d600cfc237b5615a68a96b9ad4791e72434d64dfa4", index: "0x0" } },
    { since: "0x0", previous_output: { tx_hash: "0x5d3f0d9ac586e2550015f5beddd1ef49203167e746c65756410001499886c05c", index: "0x0" } }
  ],
  outputs: [
    {
      capacity: "0x7765430800",  // 5,128 CKB
      lock: { code_hash: "0x21854a7b67a2c4a71a8558c6d4023cf787e71db49d09cb4aa8748dbf6a8ef6ec", hash_type: "data2", args: "0x" },
      type: { code_hash: "0x29707d6ffcd4a78ac68fd9b7539ca7c5a6781713ef5be337f1f60896d681cd30", hash_type: "data2", args: "0x" }
    },
    {
      capacity: "0x37e11d600",  // 150 CKB
      lock: { code_hash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", hash_type: "type", args: "0x8e42b1999f265a0078503c4acec4d5e134534297" },
      type: { code_hash: "0x54f68c08a051facc261167d0a45383cc5fa8b1ea7d1f9d9be5a7e623e27a1320", hash_type: "data2", args: `0x${marketTypeHash.slice(2)}01` }
    },
    {
      capacity: "0x37e11d600",  // 150 CKB
      lock: { code_hash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", hash_type: "type", args: "0x8e42b1999f265a0078503c4acec4d5e134534297" },
      type: { code_hash: "0x54f68c08a051facc261167d0a45383cc5fa8b1ea7d1f9d9be5a7e623e27a1320", hash_type: "data2", args: `0x${marketTypeHash.slice(2)}02` }
    },
    {
      capacity: "0x89ce7fc67a4",  // 94,700 CKB change (minus fee)
      lock: { code_hash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", hash_type: "type", args: "0x8e42b1999f265a0078503c4acec4d5e134534297" },
      type: null
    }
  ],
  outputs_data: [
    "0x32000000000000000000000000000000320000000000000000000000000000000000",  // 50 YES, 50 NO
    "0x32000000000000000000000000000000",  // 50 YES tokens
    "0x32000000000000000000000000000000",  // 50 NO tokens
    "0x"  // Change cell data
  ],
  witnesses: []
};

fs.writeFileSync('mint-burning-test.json', JSON.stringify({ transaction: tx, multisig_configs: {}, signatures: {} }, null, 2));
console.log("✓ Minting transaction built");
EONODE

echo "Signing and sending transaction..."
ckb-cli tx sign-inputs --tx-file mint-burning-test.json --privkey-path privkey.txt --add-signatures --skip-check
TX_HASH=$(ckb-cli tx send --tx-file mint-burning-test.json --skip-check 2>&1 | grep -oP '0x[0-9a-f]{64}' | head -1)

echo ""
echo "✓ Tokens minted!"
echo "  TX hash: $TX_HASH"
echo "  Market cell: output 0 (5,128 CKB, 50 YES + 50 NO supply)"
echo "  YES tokens: output 1 (50 tokens)"
echo "  NO tokens: output 2 (50 tokens)"
echo ""
echo "Saving for burning test..."
echo "{\"mint_tx\": \"$TX_HASH\"}" > mint-tx-burning.json
echo "✓ Ready for burning test!"
