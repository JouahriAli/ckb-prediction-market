#!/bin/bash
set -e

echo "=== Testing Token Burning ==="
echo ""

PRIVKEY="6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6"
echo $PRIVKEY > privkey.txt

# Minted tokens from previous step
MINT_TX="0xcd36d99587b07545979f9e2284f27e221ef3d58f237424d2191f056911b6d484"

echo "Burning 20 YES + 20 NO tokens (returning 4,000 CKB collateral)"
echo "  Market cell: $MINT_TX:0"
echo "  YES tokens: $MINT_TX:1 (50 tokens)"
echo "  NO tokens: $MINT_TX:2 (50 tokens)"
echo ""

# Market type hash
MARKET_TYPE_HASH="0x50831a97f193f33e195a6d54048542b8d0c27633054106de0f2844bcdda34871"

node << 'EONODE'
const fs = require('fs');

const marketTypeHash = "0x50831a97f193f33e195a6d54048542b8d0c27633054106de0f2844bcdda34871";

// Burn 20 YES + 20 NO tokens
// Input market: 5,128 CKB, 50 YES + 50 NO
// Output market: 3,128 CKB, 30 YES + 30 NO (returned 2,000 CKB)
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
    { since: "0x0", previous_output: { tx_hash: "0xcd36d99587b07545979f9e2284f27e221ef3d58f237424d2191f056911b6d484", index: "0x0" } },  // Market
    { since: "0x0", previous_output: { tx_hash: "0xcd36d99587b07545979f9e2284f27e221ef3d58f237424d2191f056911b6d484", index: "0x1" } },  // YES tokens
    { since: "0x0", previous_output: { tx_hash: "0xcd36d99587b07545979f9e2284f27e221ef3d58f237424d2191f056911b6d484", index: "0x2" } }   // NO tokens
  ],
  outputs: [
    {
      capacity: "0x1a43676800",  // 1,128 CKB (5,128 - 4,000)
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
      capacity: "0x5d21db9b50",  // 4,000 CKB returned (minus fee)
      lock: { code_hash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", hash_type: "type", args: "0x8e42b1999f265a0078503c4acec4d5e134534297" },
      type: null
    }
  ],
  outputs_data: [
    "0x1e0000000000000000000000000000001e0000000000000000000000000000000000",  // 30 YES, 30 NO
    "0x1e000000000000000000000000000000",  // 30 YES tokens (50 - 20)
    "0x1e000000000000000000000000000000",  // 30 NO tokens (50 - 20)
    "0x"
  ],
  witnesses: []
};

fs.writeFileSync('burn-test.json', JSON.stringify({ transaction: tx, multisig_configs: {}, signatures: {} }, null, 2));
console.log("✓ Burning transaction built");
EONODE

echo "Signing and sending transaction..."
ckb-cli tx sign-inputs --tx-file burn-test.json --privkey-path privkey.txt --add-signatures --skip-check
TX_HASH=$(ckb-cli tx send --tx-file burn-test.json --skip-check 2>&1 | grep -oP '0x[0-9a-f]{64}' | head -1)

echo ""
if [ -n "$TX_HASH" ]; then
  echo "✅ Token burning successful!"
  echo "  TX hash: $TX_HASH"
  echo "  Burned: 20 YES + 20 NO tokens (40 total)"
  echo "  Returned: 4,000 CKB collateral"
  echo "  New market state: 1,128 CKB, 30 YES + 30 NO"
else
  echo "❌ Burning transaction failed"
  ckb-cli tx send --tx-file burn-test.json --skip-check
fi
