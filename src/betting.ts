/**
 * Betting Functionality (CSMM + xUDT + Virtual Liquidity)
 *
 * This module handles placing bets on prediction markets using:
 * - Constant Sum Market Maker (CSMM) for pricing
 * - xUDT tokens (YES/NO) for positions
 * - Virtual liquidity (1000 tokens) for smooth pricing without initial minting
 *
 * Transaction Flow for Placing a Bet:
 * -------------------------------------
 * Inputs:
 *   - Market cell (current state)
 *   - User's CKB cells (for bet amount)
 *
 * Outputs:
 *   - Updated market cell (escrow increased, token supply updated)
 *   - User's xUDT cell (newly minted YES or NO tokens)
 *   - Change cell
 *
 * Key validations (Phase 1 - client side only):
 *   1. Market not resolved yet
 *   2. Current time < deadline
 *   3. Bet amount >= minimum
 */

import { ccc } from "@ckb-ccc/core";
import { MarketData, TransactionResult, CONSTANTS } from "./types.js";
import { encodeMarketData, decodeMarketData } from "./encoding.js";
import { updateEnvMarketOutPoint } from "./utils.js";

/**
 * Calculate tokens to mint using CSMM with virtual liquidity
 *
 * Formula: tokens = (betAmount × totalEffective) / effectiveCurrentSupply
 * where effective supply = actual supply + VIRTUAL_LIQUIDITY
 *
 * @param betAmount - CKB amount being bet (in shannons)
 * @param actualCurrentSupply - Actual tokens minted on the bet side
 * @param actualOtherSupply - Actual tokens minted on the other side
 * @returns Number of tokens to mint (in token units, 8 decimals)
 */
function calculateTokensToMint(
  betAmount: bigint,
  actualCurrentSupply: bigint,
  actualOtherSupply: bigint
): bigint {
  const virtualLiquidity = CONSTANTS.VIRTUAL_LIQUIDITY;

  // Add virtual liquidity to both sides
  const effectiveCurrentSupply = actualCurrentSupply + virtualLiquidity;
  const effectiveOtherSupply = actualOtherSupply + virtualLiquidity;
  const totalEffective = effectiveCurrentSupply + effectiveOtherSupply;

  // Calculate tokens: (betAmount × totalEffective) / effectiveCurrentSupply
  // Multiply before divide to avoid precision loss
  const tokens = (betAmount * totalEffective) / effectiveCurrentSupply;

  return tokens;
}

/**
 * Place a bet on a prediction market
 *
 * This function builds a transaction that:
 * 1. Consumes the market cell (to update it)
 * 2. Creates a new market cell with updated escrow and token supply
 * 3. Creates an xUDT cell with minted YES/NO tokens for the bettor
 *
 * @param signer - CCC signer (the bettor)
 * @param marketTxHash - Transaction hash that created the market
 * @param marketOutputIndex - Output index of the market cell
 * @param side - true = bet on YES, false = bet on NO
 * @param betAmount - Amount to bet in shannons (CKB going into escrow)
 * @returns Transaction hash and xUDT cell output index
 */
export async function placeBet(
  signer: ccc.Signer,
  marketTxHash: string,
  marketOutputIndex: number,
  side: boolean,
  betAmount: bigint
): Promise<TransactionResult> {
  console.log("\n=== Placing Bet (CSMM + xUDT) ===");
  console.log(`Market: ${marketTxHash}:${marketOutputIndex}`);
  console.log(`Side: ${side ? "YES" : "NO"}`);
  console.log(`Bet amount: ${betAmount / CONSTANTS.CKB_SHANNON_RATIO} CKB`);

  // Step 1: Validate bet amount
  const minBet = CONSTANTS.MIN_BET_CKB * CONSTANTS.CKB_SHANNON_RATIO;
  if (betAmount < minBet) {
    throw new Error(`Bet amount too low. Minimum: ${CONSTANTS.MIN_BET_CKB} CKB`);
  }

  // Step 2: Fetch the current market cell
  console.log("\nFetching market cell...");
  const marketOutPoint = {
    txHash: marketTxHash,
    index: marketOutputIndex,
  };

  let marketCellData;
  try {
    const tx = await signer.client.getTransaction(marketTxHash);
    if (!tx || !tx.transaction) {
      throw new Error(`Transaction ${marketTxHash} not found`);
    }

    const output = tx.transaction.outputs[marketOutputIndex];
    const outputData = tx.transaction.outputsData[marketOutputIndex];

    if (!output) {
      throw new Error(`Output index ${marketOutputIndex} not found in transaction`);
    }

    // Check if cell is still live (not spent)
    const cellStatus = await signer.client.getCellLive(marketOutPoint, false);
    if (cellStatus && cellStatus.status === "dead") {
      throw new Error("Market cell already spent");
    }

    marketCellData = {
      cell: {
        cellOutput: output,
        outputData: outputData,
      },
    };

    console.log("✅ Market cell found");
  } catch (error) {
    console.error("Error fetching market cell:", error);
    throw new Error("Market cell not found or already spent");
  }

  // Step 3: Decode current market data
  const currentMarketData = decodeMarketData(marketCellData.cell.outputData);
  console.log("\nCurrent market state:");
  console.log(`  YES supply: ${Number(currentMarketData.yesSupply) / Number(CONSTANTS.CKB_SHANNON_RATIO)} tokens`);
  console.log(`  NO supply: ${Number(currentMarketData.noSupply) / Number(CONSTANTS.CKB_SHANNON_RATIO)} tokens`);
  console.log(`  Total bets: ${currentMarketData.totalBets}`);
  console.log(`  Resolved: ${currentMarketData.resolved}`);

  // Step 4: Validate market state
  if (currentMarketData.resolved) {
    throw new Error("Market already resolved. Cannot place bets.");
  }

  const nowTimestamp = BigInt(Math.floor(Date.now() / 1000));
  if (nowTimestamp >= currentMarketData.deadline) {
    throw new Error("Betting deadline has passed");
  }

  // Step 5: Calculate tokens to mint using CSMM
  const tokensToMint = calculateTokensToMint(
    betAmount,
    side ? currentMarketData.yesSupply : currentMarketData.noSupply,
    side ? currentMarketData.noSupply : currentMarketData.yesSupply
  );

  console.log(`\nCSMM Calculation:`);
  console.log(`  Virtual liquidity: ${Number(CONSTANTS.VIRTUAL_LIQUIDITY) / Number(CONSTANTS.CKB_SHANNON_RATIO)} tokens`);
  console.log(`  Tokens to mint: ${Number(tokensToMint) / Number(CONSTANTS.CKB_SHANNON_RATIO)} ${side ? "YES" : "NO"} tokens`);

  // Step 6: Update market data
  const updatedMarketData: MarketData = {
    yesSupply: side ? currentMarketData.yesSupply + tokensToMint : currentMarketData.yesSupply,
    noSupply: !side ? currentMarketData.noSupply + tokensToMint : currentMarketData.noSupply,
    totalBets: currentMarketData.totalBets + 1n,
    resolved: currentMarketData.resolved,
    outcome: currentMarketData.outcome,
    deadline: currentMarketData.deadline,
    yesTokenTypeHash: currentMarketData.yesTokenTypeHash,
    noTokenTypeHash: currentMarketData.noTokenTypeHash,
  };

  console.log(`\nUpdated market state:`);
  console.log(`  YES supply: ${Number(updatedMarketData.yesSupply) / Number(CONSTANTS.CKB_SHANNON_RATIO)} tokens`);
  console.log(`  NO supply: ${Number(updatedMarketData.noSupply) / Number(CONSTANTS.CKB_SHANNON_RATIO)} tokens`);
  console.log(`  Total bets: ${updatedMarketData.totalBets}`);

  // Step 7: Get user lock and reconstruct xUDT type script
  const userLock = (await signer.getRecommendedAddressObj()).script;

  // Get the market owner's lock (the market cell is locked by the owner)
  const marketOwnerLock = marketCellData.cell.cellOutput.lock;

  // Reconstruct the xUDT type script using the market owner's lock hash + suffix
  // YES tokens: lock hash + 0x01, NO tokens: lock hash + 0x00
  const ownerLockHash = marketOwnerLock.hash();
  const tokenArgs = ownerLockHash + (side ? "01" : "00");

  const tokenType = await ccc.Script.fromKnownScript(
    signer.client,
    ccc.KnownScript.XUdt,
    tokenArgs
  );

  // Step 8: Calculate new market cell capacity (escrow increases by bet amount)
  const newMarketCapacity = marketCellData.cell.cellOutput.capacity + betAmount;

  // Step 9: Encode xUDT token amount (16 bytes, little-endian u128)
  const xudtAmount = new Uint8Array(16);
  let remaining = tokensToMint;
  for (let i = 0; i < 16; i++) {
    xudtAmount[i] = Number(remaining & 0xFFn);
    remaining >>= 8n;
  }
  const xudtData = "0x" + Array.from(xudtAmount).map(b => b.toString(16).padStart(2, "0")).join("");

  // Step 10: Build the transaction
  const tx = ccc.Transaction.from({
    inputs: [
      // Input 0: Current market cell
      {
        previousOutput: marketOutPoint,
        cellOutput: marketCellData.cell.cellOutput,
        outputData: marketCellData.cell.outputData,
      },
    ],
    outputs: [
      // Output 0: Updated market cell (escrow increased, supply updated)
      {
        lock: marketCellData.cell.cellOutput.lock,
        capacity: newMarketCapacity,
      },
      // Output 1: User's xUDT cell (newly minted tokens)
      {
        lock: userLock,
        type: tokenType,
        capacity: CONSTANTS.XUDT_CELL_CAPACITY, // 143 CKB for xUDT cell
      },
    ],
    outputsData: [
      encodeMarketData(updatedMarketData),
      xudtData, // Token amount in xUDT format
    ],
  });

  // Add xUDT script cell dep
  await tx.addCellDepsOfKnownScripts(signer.client, ccc.KnownScript.XUdt);

  console.log("\nBuilding transaction...");
  console.log(`  Inputs: 1 (market cell)`);
  console.log(`  Outputs: 2 (market + xUDT token cell)`);
  console.log(`  Market escrow: ${Number(marketCellData.cell.cellOutput.capacity) / Number(CONSTANTS.CKB_SHANNON_RATIO)} CKB → ${Number(newMarketCapacity) / Number(CONSTANTS.CKB_SHANNON_RATIO)} CKB`);

  // Step 11: Complete transaction (add inputs for xUDT cell capacity + fees)
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000);

  // Step 12: Sign and send
  const txHash = await signer.sendTransaction(tx);
  console.log(`\n✅ Bet placed successfully!`);
  console.log(`Transaction hash: ${txHash}`);
  console.log(`xUDT cell output index: 1`);
  console.log(`Tokens minted: ${Number(tokensToMint) / Number(CONSTANTS.CKB_SHANNON_RATIO)} ${side ? "YES" : "NO"}`);

  // Step 13: Wait for confirmation
  await signer.client.waitTransaction(txHash);
  console.log(`✅ Transaction confirmed!`);

  // Step 14: Auto-update .env with new market OutPoint
  updateEnvMarketOutPoint(txHash, 0); // Market cell always at index 0

  return {
    txHash,
    outputIndex: 1, // xUDT cell is always at output index 1
  };
}

