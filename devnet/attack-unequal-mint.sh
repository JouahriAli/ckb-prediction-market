#!/bin/bash
set -e

echo "=== ATTACK TEST: Minting Unequal YES/NO Tokens ==="
echo "Trying to mint 100 YES but only 50 NO tokens..."
echo ""

PRIVKEY="6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6"
echo $PRIVKEY > privkey.txt

node << 'EONODE'
const fs = require('fs');

// Attack: Mint 100 YES tokens but only 50 NO tokens
// This breaks the equal supply invariant!
const tx = {
  version: "0x0",
  cell_deps: [
    { out_point: { tx_hash: "0x75be96e1871693f030db27ddae47890a28ab180e88e36ebb3575d9f1377d3da7", index: "0x0" }, dep_type: "dep_group" },
    { out_point: { tx_hash: "0x4450343ae605e673c0bcbd8789edb4a148806462d8d5d016a839ccfb6205ea10", index: "0x0" }, dep_type: "code" },
    { out_point: { tx_hash: "0x4f80b8ddd59bfb87dc45f795d89f3ae8daa128d75c21ad6ecddcbbd6f93bfe5d", index: "0x0" }, dep_type: "code" },
    { out_point: { tx_hash: "0x7ba0e0efd0a22333afb85f468a7418c9078ec0b801dc2477b8ed9e28c75cdd64", index: "0x0" }, dep_type: "code" }
  ],
  header_deps: [],
  inputs: [
    { since: "0x0", previous_output: { tx_hash: "0x563812c99b336d1c2257c34f2a44ee7a835b926849ca57195f2be740cd086757", index: "0x0" } },
    { since: "0x0", previous_output: { tx_hash: "0x563812c99b336d1c2257c34f2a44ee7a835b926849ca57195f2be740cd086757", index: "0x3" } }
  ],
  outputs: [
    {
      capacity: "0xebcf959000",  // 10,128 CKB
      lock: { code_hash: "0x21854a7b67a2c4a71a8558c6d4023cf787e71db49d09cb4aa8748dbf6a8ef6ec", hash_type: "data2", args: "0x" },
      type: { code_hash: "0xb1279e1fcecb5c3ead2020f1ab82ab4943efb7581fc058f59ee66c29796e548c", hash_type: "data2", args: "0x" }
    },
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
    "0xc8000000000000000000000000000000960000000000000000000000000000000000",  // Market: 200 YES, 150 NO (unequal!)
    "0x64000000000000000000000000000000",  // YES token: 100 (input had 100, +100 = 200 total)
    "0x32000000000000000000000000000000"   // NO token: 50 (input had 100, +50 = 150 total)
  ],
  witnesses: []
};

fs.writeFileSync('attack-unequal.json', JSON.stringify({ transaction: tx, multisig_configs: {}, signatures: {} }, null, 2));
console.log("✓ Unequal mint attack transaction built");
console.log("  Market supply: 200 YES, 150 NO (UNEQUAL!)");
console.log("  YES tokens created: +100");
console.log("  NO tokens created: +50");
EONODE

echo ""
echo "Attempting to send unequal mint attack..."
ckb-cli tx sign-inputs --tx-file attack-unequal.json --privkey-path privkey.txt --add-signatures --skip-check
ckb-cli tx send --tx-file attack-unequal.json --skip-check 2>&1 || echo ""
echo ""
echo "Attack should have FAILED with token contract validation error!"
