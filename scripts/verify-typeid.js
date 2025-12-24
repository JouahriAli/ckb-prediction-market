import { ccc } from "@ckb-ccc/ccc";

// Test data from the logs
const outpointHex = "0xbe740427bb71ef87e76fdb436bf8d3dff0f8e97d33b5399114f3e6b8269d584301000000";
const outputIndex = 0;

// Build the 44-byte input
const outpointBytes = ccc.bytesFrom(outpointHex);
const typeIdInput = new Uint8Array(44);
typeIdInput.set(outpointBytes, 0);
const view = new DataView(typeIdInput.buffer, 36, 8);
view.setBigUint64(0, BigInt(outputIndex), true);

console.log("Type ID input (44 bytes):", ccc.hexFrom(typeIdInput));

// Calculate Type ID using CCC
const typeId = ccc.hashCkb(ccc.hexFrom(typeIdInput));
console.log("Type ID (CCC):", typeId);

// Try alternative: use CKB's Type ID generation helper if it exists
// Type ID should be: blake2b(first_input_outpoint || output_index)
console.log("\nExpected from logs: 0x6bc85ae5b3ab20563637e0efff3a66f5b9b3ffaf959eca91aacb01d5daeb899e");
