#!/bin/bash
set -e

echo "=== ATTACK TEST: Creating Tokens Without Market Cell ==="
echo "Trying to mint YES/NO tokens without market cell in inputs..."
echo ""

PRIVKEY="6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6"
echo $PRIVKEY > privkey.txt

node << 'EONODE'
const fs = require('fs');

// Attack: Create token cells without having market cell in inputs
// This would bypass all market validation!
const tx = {
  version: "0x0",
  cell_deps: [
    { out_point: { tx_hash: "0x75be96e1871693f030db27ddae47890a28ab180e88e36ebb3575d9f1377d3da7", index: "0x0" }, dep_type: "dep_group" },
    { out_point: { tx_hash: "0x4f80b8ddd59bfb87dc45f795d89f3ae8daa128d75c21ad6ecddcbbd6f93bfe5d", index: "0x0" }, dep_type: "code" }
  ],
  header_deps: [],
  inputs: [
    // Using regular CKB cell as input, NO market cell!
    { since: "0x0", previous_output: { tx_hash: "0x563812c99b336d1c2257c34f2a44ee7a835b926849ca57195f2be740cd086757", index: "0x3" } }
  ],
  outputs: [
    {
      capacity: "0x37e11d600",  // 150 CKB
      lock: { code_hash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", hash_type: "type", args: "0x8e42b1999f265a0078503c4acec4d5e134534297" },
      type: { code_hash: "0x54f68c08a051facc261167d0a45383cc5fa8b1ea7d1f9d9be5a7e623e27a1320", hash_type: "data2", args: "0x6da49e9c7f74215921df034109d3bb6fe50518159934771f906ac07351e64efc01" }
    },
    {
      capacity: "0x37e11d600",  // 150 CKB
      lock: { code_hash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", hash_type: "type", args: "0x8e42b1999f265a0078503c4acec4d5e134534297" },
      type: { code_hash: "0x54f68c08a051facc261167d0a45383cc5fa8b1ea7d1f9d9be5a7e623e27a1320", hash_type: "data2", args: "0x6da49e9c7f74215921df034109d3bb6fe50518159934771f906ac07351e64efc02" }
    }
  ],
  outputs_data: [
    "0x64000000000000000000000000000000",  // 100 YES tokens
    "0x64000000000000000000000000000000"   // 100 NO tokens
  ],
  witnesses: []
};

fs.writeFileSync('attack-no-market.json', JSON.stringify({ transaction: tx, multisig_configs: {}, signatures: {} }, null, 2));
console.log("✓ Token creation without market attack transaction built");
console.log("  NO market cell in inputs!");
console.log("  Creating 100 YES + 100 NO tokens out of thin air");
EONODE

echo ""
echo "Attempting to send token creation without market attack..."
ckb-cli tx sign-inputs --tx-file attack-no-market.json --privkey-path privkey.txt --add-signatures --skip-check
ckb-cli tx send --tx-file attack-no-market.json --skip-check 2>&1 || echo ""
echo ""
echo "Attack should have FAILED - token contract requires market cell!"
