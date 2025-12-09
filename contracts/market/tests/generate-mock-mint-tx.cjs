#!/usr/bin/env node

/**
 * Generate mock transaction JSON for ckb-debugger testing
 * Simulates a valid minting transaction
 */

const fs = require('fs');
const path = require('path');

// Always-success lock script
const alwaysSuccessLock = {
  code_hash: "0x21854a7b67a2c4a71a8558c6d4023cf787e71db49d09cb4aa8748dbf6a8ef6ec",
  hash_type: "data2",
  args: "0x"
};

// Market type script (updated contract)
const marketTypeScript = {
  code_hash: "0x9c148507b50f31775f6df9f62f9c933d1e068fc5de9a2d7221f1c23501d55069",
  hash_type: "data2",
  args: "0x"
};

// Helper: encode u128 as little-endian hex
function encodeU128LE(value) {
  const low = BigInt(value) & BigInt("0xFFFFFFFFFFFFFFFF");
  const high = BigInt(value) >> BigInt(64);

  const lowHex = low.toString(16).padStart(16, '0');
  const highHex = high.toString(16).padStart(16, '0');

  // Reverse to little-endian
  const lowLE = lowHex.match(/../g).reverse().join('');
  const highLE = highHex.match(/../g).reverse().join('');

  return lowLE + highLE;
}

// Helper: create market data
function createMarketData(yesSupply, noSupply, resolved, outcome) {
  const yesHex = encodeU128LE(yesSupply);
  const noHex = encodeU128LE(noSupply);
  const resolvedByte = resolved ? "01" : "00";
  const outcomeByte = outcome ? "01" : "00";

  return "0x" + yesHex + noHex + resolvedByte + outcomeByte;
}

// Mock transaction: Mint 10 tokens (0 -> 10 YES + 10 NO)
const mockTx = {
  version: "0x0",
  cell_deps: [
    // Market contract cell dep
    {
      out_point: {
        tx_hash: "0x01b0adb188e00207dff84543807f59985976a017d07585f0a385b92f190dcfd6",
        index: "0x0"
      },
      dep_type: "code"
    },
    // Always-success contract cell dep
    {
      out_point: {
        tx_hash: "0xc64e8728778b57e7376d9ede254f2fe48e3e943cc2b047a47f6278a0b6b6f739",
        index: "0x0"
      },
      dep_type: "code"
    }
  ],
  header_deps: [],
  inputs: [
    {
      since: "0x0",
      previous_output: {
        tx_hash: "0x" + "00".repeat(32), // Mock hash
        index: "0x0"
      }
    }
  ],
  outputs: [
    {
      capacity: "0x" + (116 * 100_000_000 + 10 * 100 * 100_000_000).toString(16), // 116 + 1000 CKB
      lock: alwaysSuccessLock,
      type: marketTypeScript
    }
  ],
  outputs_data: [
    createMarketData(10, 10, false, false) // 10 YES, 10 NO, not resolved
  ],
  witnesses: []
};

// Mock inputs data (for ckb-debugger to load)
const mockInputsData = {
  mock_info: {
    inputs: [
      {
        input: {
          since: "0x0",
          previous_output: {
            tx_hash: "0x" + "00".repeat(32),
            index: "0x0"
          }
        },
        output: {
          capacity: "0x" + (116 * 100_000_000).toString(16), // 116 CKB
          lock: alwaysSuccessLock,
          type: marketTypeScript
        },
        data: createMarketData(0, 0, false, false), // Initial: 0 YES, 0 NO
        header: null
      }
    ],
    cell_deps: [
      {
        cell_dep: {
          out_point: {
            tx_hash: "0x01b0adb188e00207dff84543807f59985976a017d07585f0a385b92f190dcfd6",
            index: "0x0"
          },
          dep_type: "code"
        },
        output: {
          capacity: "0x0",
          lock: alwaysSuccessLock,
          type: null
        },
        data: "0x" + fs.readFileSync(path.join(__dirname, "../build/market")).toString('hex'),
        header: null
      },
      {
        cell_dep: {
          out_point: {
            tx_hash: "0xc64e8728778b57e7376d9ede254f2fe48e3e943cc2b047a47f6278a0b6b6f739",
            index: "0x0"
          },
          dep_type: "code"
        },
        output: {
          capacity: "0x0",
          lock: alwaysSuccessLock,
          type: null
        },
        data: "0x" + fs.readFileSync(path.join(__dirname, "../../../contracts/always-success/build/always-success")).toString('hex'),
        header: null
      }
    ],
    header_deps: []
  },
  tx: mockTx
};

// Write to file
const outputPath = path.join(__dirname, 'mock-mint-tx.json');
fs.writeFileSync(outputPath, JSON.stringify(mockInputsData, null, 2));

console.log("✅ Generated mock minting transaction:");
console.log(`   File: ${outputPath}`);
console.log(`   Input:  0 YES, 0 NO, 116 CKB`);
console.log(`   Output: 10 YES, 10 NO, 1116 CKB`);
console.log(`   Lock: Always-success (preserved)`);
console.log(`   Outcome: false (preserved)`);
console.log(`\nRun with:`);
console.log(`   ckb-debugger --tx-file ${outputPath} --script-group-type type -i 0 -e input`);
