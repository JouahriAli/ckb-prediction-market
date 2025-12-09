#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

console.log("=== Testing Always-Success Lock with ckb-debugger ===\n");

// Read the contract binary
const contractPath = path.join(
  __dirname,
  "../contracts/always-success/build/always-success"
);

if (!fs.existsSync(contractPath)) {
  console.error("❌ Contract binary not found. Run: cd contracts/always-success && make");
  process.exit(1);
}

const contractBinary = fs.readFileSync(contractPath);
console.log(`✅ Contract binary loaded: ${contractBinary.length} bytes\n`);

// Create a minimal mock transaction for testing
const mockTx = {
  mock_info: {
    inputs: [
      {
        input: {
          previous_output: {
            tx_hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
            index: "0x0"
          },
          since: "0x0"
        },
        output: {
          capacity: "0x174876e800",
          lock: {
            code_hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
            hash_type: "data2",
            args: "0x"
          },
          type: null
        },
        data: "0x"
      }
    ],
    cell_deps: [],
    header_deps: []
  },
  tx: {
    version: "0x0",
    cell_deps: [],
    header_deps: [],
    inputs: [
      {
        previous_output: {
          tx_hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          index: "0x0"
        },
        since: "0x0"
      }
    ],
    outputs: [
      {
        capacity: "0x174876e800",
        lock: {
          code_hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          hash_type: "type",
          args: "0x"
        },
        type: null
      }
    ],
    outputs_data: ["0x"],
    witnesses: ["0x"]
  }
};

// Write mock transaction to file
const mockTxPath = path.join(__dirname, "test-always-success-tx.json");
fs.writeFileSync(mockTxPath, JSON.stringify(mockTx, null, 2));
console.log(`✅ Mock transaction written to: ${mockTxPath}\n`);

// Run ckb-debugger
console.log("🔍 Running ckb-debugger...\n");

try {
  const result = execSync(
    `ckb-debugger --tx-file "${mockTxPath}" --script-group-type lock --cell-index 0 --mode full`,
    {
      cwd: __dirname,
      env: {
        ...process.env,
        CKB_RUNNING_SETUP: contractPath
      },
      encoding: "utf-8"
    }
  );

  console.log(result);
  console.log("\n✅ Always-success lock script passed!");
  console.log("The lock always returns 0 (success), allowing anyone to unlock the cell.\n");
} catch (err) {
  console.error("❌ ckb-debugger failed:");
  console.error(err.stdout || err.message);
  process.exit(1);
}

// Clean up
fs.unlinkSync(mockTxPath);
console.log("✅ Test completed successfully!");
