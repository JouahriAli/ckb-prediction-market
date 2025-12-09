#!/bin/bash
set -e

echo "=== ATTACK TEST: Hijacking Market Lock Script ==="
echo "Trying to change always-success lock to attacker's secp256k1 lock..."
echo ""

PRIVKEY="6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6"
echo $PRIVKEY > privkey.txt

node << 'EONODE'
const fs = require('fs');

// Attack: Change the market cell's lock from always-success to secp256k1
// This would let the attacker control the market!
const tx = {
  version: "0x0",
  cell_deps: [
    { out_point: { tx_hash: "0x75be96e1871693f030db27ddae47890a28ab180e88e36ebb3575d9f1377d3da7", index: "0x0" }, dep_type: "dep_group" },
    { out_point: { tx_hash: "0x4450343ae605e673c0bcbd8789edb4a148806462d8d5d016a839ccfb6205ea10", index: "0x0" }, dep_type: "code" },
    { out_point: { tx_hash: "0x7ba0e0efd0a22333afb85f468a7418c9078ec0b801dc2477b8ed9e28c75cdd64", index: "0x0" }, dep_type: "code" }
  ],
  header_deps: [],
  inputs: [
    { since: "0x0", previous_output: { tx_hash: "0x563812c99b336d1c2257c34f2a44ee7a835b926849ca57195f2be740cd086757", index: "0x0" } }
  ],
  outputs: [
    {
      capacity: "0xebcf8f4000",  // 10,127 CKB (1 CKB fee)
      lock: {
        // Changed from always-success to attacker's secp256k1 lock!
        code_hash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
        hash_type: "type",
        args: "0x8e42b1999f265a0078503c4acec4d5e134534297"
      },
      type: { code_hash: "0xb1279e1fcecb5c3ead2020f1ab82ab4943efb7581fc058f59ee66c29796e548c", hash_type: "data2", args: "0x" }
    }
  ],
  outputs_data: [
    "0x64000000000000000000000000000000640000000000000000000000000000000000"  // Keep same supply
  ],
  witnesses: ["0x"]
};

fs.writeFileSync('attack-hijack.json', JSON.stringify({ transaction: tx, multisig_configs: {}, signatures: {} }, null, 2));
console.log("✓ Hijack attack transaction built");
console.log("  Input lock: always-success (anyone can spend)");
console.log("  Output lock: secp256k1 (attacker controlled)");
EONODE

echo ""
echo "Attempting to send hijack attack..."
ckb-cli tx sign-inputs --tx-file attack-hijack.json --privkey-path privkey.txt --add-signatures --skip-check
ckb-cli tx send --tx-file attack-hijack.json --skip-check 2>&1 || echo ""
echo ""
echo "Attack should have FAILED with LockScriptChanged error!"
