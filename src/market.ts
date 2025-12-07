/**
 * Market Creation and Management (CSMM + xUDT with Virtual Liquidity)
 *
 * This module handles creating new prediction markets on CKB with xUDT tokens.
 *
 * Transaction Flow for Creating a Market (Simplified!):
 * ------------------------------------------
 * Just 1 transaction:
 *   Inputs: User's CKB cells
 *   Outputs:
 *     - Market cell (escrow, contains MarketData)
 *     - Change
 *
 * No token cells are created initially! Virtual liquidity provides smooth pricing
 * without needing to mint 1000+1000 tokens upfront.
 *
 * The market cell will have:
 *   - Capacity: initialCapacity (escrow pool, starts at ~200 CKB)
 *   - Lock: User's address (owner can update/resolve)
 *   - Type: None (Phase 1 - Phase 2 will add type script for validation)
 *   - Data: Encoded MarketData (yesSupply=0, noSupply=0, type hashes, etc.)
 */

import { ccc } from "@ckb-ccc/core";
import { MarketConfig, MarketData, TransactionResult, CONSTANTS } from "./types.js";
import { encodeMarketData } from "./encoding.js";

/**
 * Create a new prediction market with xUDT tokens and virtual liquidity
 *
 * This function creates a market in just ONE transaction, using virtual liquidity
 * for pricing instead of minting initial tokens.
 *
 * @param signer - CCC signer (connected wallet/account)
 * @param config - Market configuration (question, deadline, initial capacity)
 * @returns Transaction hash and output index of created market cell
 *
 * Step-by-step explanation:
 * 1. Create xUDT type scripts (YES and NO) owned by market creator
 * 2. Build market data with zero initial supply (virtual liquidity handles pricing)
 * 3. Create market cell with encoded data
 * 4. Done! No seal cells or initial minting needed
 */
export async function createMarket(
  signer: ccc.Signer,
  config: MarketConfig
): Promise<TransactionResult> {
  console.log("\n=== Creating Prediction Market (xUDT + CSMM + Virtual Liquidity) ===");
  console.log(`Question: ${config.question}`);
  console.log(`Deadline: ${new Date(Number(config.deadline) * 1000).toISOString()}`);
  console.log(`Initial Capacity: ${config.initialCapacity / CONSTANTS.CKB_SHANNON_RATIO} CKB`);
  console.log(`Virtual Liquidity: ${CONSTANTS.VIRTUAL_LIQUIDITY / CONSTANTS.CKB_SHANNON_RATIO} tokens (pricing only)\n`);

  // Step 1: Get user's lock script (will be xUDT owner)
  console.log("Step 1/3: Setting up xUDT type scripts...");
  const userLock = (await signer.getRecommendedAddressObj()).script;

  // Step 2: Create xUDT type scripts
  // For YES and NO tokens, we need different args to create distinct tokens
  // Args = market owner's lock hash + 1 byte suffix (0x01 for YES, 0x00 for NO)
  // Phase 1: Trust market owner not to cheat
  // Phase 2: Replace with type script validation
  const ownerLockHash = userLock.hash();

  // YES token: owner lock hash + 0x01
  const yesTokenArgs = ownerLockHash + "01";
  const yesTokenType = await ccc.Script.fromKnownScript(
    signer.client,
    ccc.KnownScript.XUdt,
    yesTokenArgs
  );

  // NO token: owner lock hash + 0x00
  const noTokenArgs = ownerLockHash + "00";
  const noTokenType = await ccc.Script.fromKnownScript(
    signer.client,
    ccc.KnownScript.XUdt,
    noTokenArgs
  );

  console.log(`✅ YES token type hash: ${yesTokenType.hash()}`);
  console.log(`✅ NO token type hash: ${noTokenType.hash()}`);

  // Step 3: Build market data
  console.log("\nStep 2/3: Building market data...");

  // Start with ZERO tokens - virtual liquidity provides initial pricing
  const marketData: MarketData = {
    yesSupply: 0n,              // No actual tokens minted yet
    noSupply: 0n,               // Virtual liquidity (1000) used in formulas only
    totalBets: 0n,
    resolved: false,
    outcome: false,
    deadline: config.deadline,
    yesTokenTypeHash: yesTokenType.hash(),
    noTokenTypeHash: noTokenType.hash(),
  };

  const encodedData = encodeMarketData(marketData);
  console.log(`✅ Market data encoded (${encodedData.length / 2 - 1} bytes)`);

  // Step 4: Build transaction (just 1 output: market cell!)
  console.log("\nStep 3/3: Creating market cell...");

  const tx = ccc.Transaction.from({
    outputs: [
      // Output 0: Market cell (escrow)
      {
        lock: userLock,
        capacity: config.initialCapacity,
      },
    ],
    outputsData: [
      encodedData,  // Market data
    ],
  });

  // Complete inputs and fee
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000);

  console.log(`\nTransaction summary:`);
  console.log(`  - Inputs: ${tx.inputs.length} (capacity cells)`);
  console.log(`  - Outputs: ${tx.outputs.length} (market + change)`);

  // Send transaction
  const txHash = await signer.sendTransaction(tx);
  console.log(`\n✅ Market created!`);
  console.log(`Transaction hash: ${txHash}`);
  console.log(`Market cell: output index 0`);
  console.log(`\n💡 Virtual liquidity (${CONSTANTS.VIRTUAL_LIQUIDITY / CONSTANTS.CKB_SHANNON_RATIO} tokens) provides smooth pricing`);
  console.log(`   First bet will get price = 0.5 CKB/token automatically!`);

  // Wait for transaction to commit
  await signer.client.waitTransaction(txHash);
  console.log(`✅ Transaction committed!`);

  return {
    txHash,
    outputIndex: 0,
  };
}

/**
 * Helper function to generate a market ID from transaction
 *
 * In CKB, we identify cells by their "OutPoint":
 *   OutPoint = { txHash: string, index: number }
 *
 * For the market ID, we'll use a 32-byte identifier:
 *   First 31 bytes: txHash (truncated)
 *   Last byte: output index
 *
 * This links position cells to their market.
 *
 * @param txHash - Transaction hash that created the market
 * @param outputIndex - Output index of the market cell (usually 0)
 * @returns 32-byte market ID as hex string
 */
export function generateMarketId(txHash: string, outputIndex: number): string {
  // Remove 0x prefix if present
  const cleanHash = txHash.startsWith("0x") ? txHash.slice(2) : txHash;

  // Take first 62 hex chars (31 bytes) of txHash
  const hashPart = cleanHash.slice(0, 62);

  // Convert output index to single byte (hex)
  const indexByte = outputIndex.toString(16).padStart(2, "0");

  // Combine: 31 bytes hash + 1 byte index = 32 bytes total
  return "0x" + hashPart + indexByte;
}

/**
 * Helper function to parse market ID back to OutPoint
 *
 * This reverses the generateMarketId function.
 *
 * @param marketId - 32-byte market ID
 * @returns Object with txHash and index
 */
export function parseMarketId(marketId: string): { txHash: string; index: number } {
  const cleanId = marketId.startsWith("0x") ? marketId.slice(2) : marketId;

  if (cleanId.length !== 64) {
    throw new Error(`Invalid market ID length: expected 64 hex chars, got ${cleanId.length}`);
  }

  // First 62 chars = txHash (31 bytes)
  const hashPart = cleanId.slice(0, 62);

  // Last 2 chars = index byte
  const indexByte = cleanId.slice(62, 64);

  // Reconstruct full txHash (pad to 64 chars with zeros)
  const txHash = "0x" + hashPart + "00";

  // Parse index
  const index = parseInt(indexByte, 16);

  return { txHash, index };
}
