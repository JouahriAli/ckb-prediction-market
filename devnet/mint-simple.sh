#!/bin/bash
set -e

echo "=== Minting Tokens (Simple Approach) ==="

PRIVKEY="6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6"
echo $PRIVKEY > privkey.txt

# Build transaction manually
node << 'EONODE'
const fs = require('fs');

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
    { since: "0x0", previous_output: { tx_hash: "0x355ec54fd37460639ab3d6ec3be5b1a3b5b3375059450b0143bac36af75d273d", index: "0x0" } },
    { since: "0x0", previous_output: { tx_hash: "0x355ec54fd37460639ab3d6ec3be5b1a3b5b3375059450b0143bac36af75d273d", index: "0x1" } }
  ],
  outputs: [
    {
      capacity: "0xebcf959000",
      lock: { code_hash: "0x21854a7b67a2c4a71a8558c6d4023cf787e71db49d09cb4aa8748dbf6a8ef6ec", hash_type: "data2", args: "0x" },
      type: { code_hash: "0xb1279e1fcecb5c3ead2020f1ab82ab4943efb7581fc058f59ee66c29796e548c", hash_type: "data2", args: "0x" }
    },
    {
      capacity: "0x37e11d600",
      lock: { code_hash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", hash_type: "type", args: "0x8e42b1999f265a0078503c4acec4d5e134534297" },
      type: { code_hash: "0x54f68c08a051facc261167d0a45383cc5fa8b1ea7d1f9d9be5a7e623e27a1320", hash_type: "data2", args: "0x6da49e9c7f74215921df034109d3bb6fe50518159934771f906ac07351e64efc01" }
    },
    {
      capacity: "0x37e11d600",
      lock: { code_hash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", hash_type: "type", args: "0x8e42b1999f265a0078503c4acec4d5e134534297" },
      type: { code_hash: "0x54f68c08a051facc261167d0a45383cc5fa8b1ea7d1f9d9be5a7e623e27a1320", hash_type: "data2", args: "0x6da49e9c7f74215921df034109d3bb6fe50518159934771f906ac07351e64efc02" }
    },
    {
      capacity: "0xee9ffa6e66b00",
      lock: { code_hash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", hash_type: "type", args: "0x8e42b1999f265a0078503c4acec4d5e134534297" },
      type: null
    }
  ],
  outputs_data: [
    "0x64000000000000000000000000000000640000000000000000000000000000000000",
    "0x64000000000000000000000000000000",
    "0x64000000000000000000000000000000",
    "0x"
  ],
  witnesses: []
};

fs.writeFileSync('mint.json', JSON.stringify({ transaction: tx, multisig_configs: {}, signatures: {} }, null, 2));
console.log("Transaction built");
EONODE

ckb-cli tx sign-inputs --tx-file mint.json --privkey-path privkey.txt --add-signatures --skip-check
ckb-cli tx send --tx-file mint.json --skip-check
