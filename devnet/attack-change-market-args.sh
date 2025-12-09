#!/bin/bash
set -e

echo "=== ATTACK TEST: Changing Market Type Script Args ==="
echo "Trying to change market args from 0x to 0xdeadbeef..."
echo ""

PRIVKEY="6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6"
echo $PRIVKEY > privkey.txt

node << 'EONODE'
const fs = require('fs');

// Attack: Change market type script args
// This would make it a different market!
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
      lock: { code_hash: "0x21854a7b67a2c4a71a8558c6d4023cf787e71db49d09cb4aa8748dbf6a8ef6ec", hash_type: "data2", args: "0x" },
      type: {
        code_hash: "0xb1279e1fcecb5c3ead2020f1ab82ab4943efb7581fc058f59ee66c29796e548c",
        hash_type: "data2",
        args: "0xdeadbeef"  // Changed from 0x!
      }
    }
  ],
  outputs_data: [
    "0x64000000000000000000000000000000640000000000000000000000000000000000"  // Keep same supply
  ],
  witnesses: []
};

fs.writeFileSync('attack-change-args.json', JSON.stringify({ transaction: tx, multisig_configs: {}, signatures: {} }, null, 2));
console.log("✓ Market args change attack transaction built");
console.log("  Input market args: 0x");
console.log("  Output market args: 0xdeadbeef");
EONODE

echo ""
echo "Attempting to send market args change attack..."
ckb-cli tx sign-inputs --tx-file attack-change-args.json --privkey-path privkey.txt --add-signatures --skip-check
ckb-cli tx send --tx-file attack-change-args.json --skip-check 2>&1 || echo ""
echo ""
echo "Attack should have FAILED - CKB enforces type script immutability!"
