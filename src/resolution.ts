/**
 * Market Resolution and Claiming (CSMM + xUDT Design)
 *
 * This module handles:
 * 1. Resolving a market (declaring the outcome)
 * 2. Claiming winnings (winners burn tokens for CKB)
 *
 * Transaction Flow for Resolution:
 * ---------------------------------
 * Inputs:  [Market cell]
 * Outputs: [Resolved market cell (outcome = true/false, resolved = true)]
 *
 * Transaction Flow for Claiming:
 * -------------------------------
 * Inputs:  [Market cell, User's xUDT cell (winning tokens)]
 * Outputs: [Updated market cell (escrow reduced), Payout cell, Change]
 *
 * Key Change from Position Cells:
 * - Winners burn xUDT tokens to claim
 * - Payout: 1:1 redemption (1 winning token = 1 CKB from escrow)
 * - Losing tokens are worthless (cannot be redeemed)
 *
 * Security Note (Phase 1):
 * - Resolution is centralized (market owner decides outcome)
 * - No dispute mechanism
 * - Phase 2+ will use oracles and time locks
 */

import { ccc } from "@ckb-ccc/core";
import { MarketData, TransactionResult, CONSTANTS } from "./types.js";
import { encodeMarketData, decodeMarketData } from "./encoding.js";
import { updateEnvMarketOutPoint } from "./utils.js";

/**
 * Resolve a prediction market
 *
 * This sets the final outcome (YES or NO) and marks the market as resolved.
 * After resolution, no more bets can be placed, and winners can claim.
 *
 * @param signer - CCC signer (must be market owner)
 * @param marketTxHash - Transaction hash of market cell
 * @param marketOutputIndex - Output index of market cell
 * @param outcome - Final outcome: true = YES wins, false = NO wins
 * @returns Transaction hash
 */
export async function resolveMarket(
  signer: ccc.Signer,
  marketTxHash: string,
  marketOutputIndex: number,
  outcome: boolean
): Promise<TransactionResult> {
  console.log("\n=== Resolving Market ===");
  console.log(`Market: ${marketTxHash}:${marketOutputIndex}`);
  console.log(`Outcome: ${outcome ? "YES WINS" : "NO WINS"}`);

  // Step 1: Fetch current market cell
  console.log("\nFetching market cell...");
  const marketOutPoint = { txHash: marketTxHash, index: marketOutputIndex };

  // Use reliable cell fetching method
  const marketTxData = await signer.client.getTransaction(marketTxHash);
  if (!marketTxData || !marketTxData.transaction) {
    throw new Error(`Transaction ${marketTxHash} not found`);
  }

  const output = marketTxData.transaction.outputs[marketOutputIndex];
  const outputData = marketTxData.transaction.outputsData[marketOutputIndex];

  if (!output) {
    throw new Error(`Output index ${marketOutputIndex} not found`);
  }

  const cellStatus = await signer.client.getCellLive(marketOutPoint, false);
  if (cellStatus && cellStatus.status === "dead") {
    throw new Error("Market cell already spent");
  }

  const marketCell = {
    cell: {
      cellOutput: output,
      outputData: outputData,
    },
  };

  console.log("✅ Market cell found");

  // Step 2: Decode and validate current state
  const currentData = decodeMarketData(outputData);

  if (currentData.resolved) {
    throw new Error("Market already resolved");
  }

  console.log("\nCurrent market state:");
  console.log(`  Escrow: ${Number(output.capacity) / Number(CONSTANTS.CKB_SHANNON_RATIO)} CKB`);
  console.log(`  YES supply: ${Number(currentData.yesSupply) / Number(CONSTANTS.CKB_SHANNON_RATIO)} tokens`);
  console.log(`  NO supply: ${Number(currentData.noSupply) / Number(CONSTANTS.CKB_SHANNON_RATIO)} tokens`);
  console.log(`  Total bets: ${currentData.totalBets}`);

  // Step 3: Create resolved market data
  const resolvedData: MarketData = {
    ...currentData,
    resolved: true,
    outcome,
  };

  console.log(`\n📊 Resolution: ${outcome ? "YES" : "NO"} side wins!`);
  const winningSupply = outcome ? currentData.yesSupply : currentData.noSupply;
  const losingSupply = outcome ? currentData.noSupply : currentData.yesSupply;
  console.log(`  Winning tokens: ${Number(winningSupply) / Number(CONSTANTS.CKB_SHANNON_RATIO)} tokens`);
  console.log(`  Losing tokens: ${Number(losingSupply) / Number(CONSTANTS.CKB_SHANNON_RATIO)} tokens (worthless)`);
  console.log(`  Winners can redeem: 1 token = 1 CKB from escrow`);

  // Step 4: Build transaction
  const tx = ccc.Transaction.from({
    inputs: [
      {
        previousOutput: marketOutPoint,
        cellOutput: marketCell.cell.cellOutput,
        outputData: marketCell.cell.outputData,
      },
    ],
    outputs: [
      {
        lock: marketCell.cell.cellOutput.lock, // Same lock (market owner)
        capacity: marketCell.cell.cellOutput.capacity, // Keep same capacity (fees from extra inputs)
      },
    ],
    outputsData: [
      encodeMarketData(resolvedData), // Updated data with outcome
    ],
  });

  console.log("\nBuilding resolution transaction...");

  // Complete fee (will add inputs for fees + change output if needed)
  // Don't use completeInputsByCapacity - it confuses CCC when market cell is already an input
  try {
    await tx.completeFeeBy(signer, 1000);
  } catch (e: any) {
    console.error("\n⚠️  Transaction completion failed:", e.message);
    console.error("This might be due to:");
    console.error("1. Recent transaction not fully indexed by RPC (wait 30-60s)");
    console.error("2. Cell already spent in another transaction");
    console.error("3. Insufficient balance for fees\n");
    throw e;
  }

  // Sign and send
  const signedTx = await signer.signTransaction(tx);

  // Try sending with validation disabled if standard send fails
  let txHash: string;
  try {
    // Standard send (with validation)
    txHash = await signer.client.sendTransaction(signedTx);
  } catch (resolveError: any) {
    if (resolveError.code === -301 && resolveError.data?.includes('Unknown(OutPoint')) {
      console.log("\n⚠️  RPC failed to resolve outpoint (caching issue)");
      console.log("Attempting to send with relaxed validation...\n");

      // Try with "passthrough" validator which skips some checks
      txHash = await signer.client.sendTransaction(signedTx, "passthrough");
    } else {
      throw resolveError;
    }
  }
  console.log(`\n✅ Market resolved!`);
  console.log(`Transaction hash: ${txHash}`);
  console.log(`Outcome: ${outcome ? "YES WINS 🎉" : "NO WINS 🎉"}`);

  // Auto-update .env with new market OutPoint
  updateEnvMarketOutPoint(txHash, 0);

  return { txHash, outputIndex: 0 };
}

/**
 * Decode xUDT token amount from cell data
 */
function decodeXudtAmount(data: string): bigint {
  const cleanHex = data.startsWith("0x") ? data.slice(2) : data;
  const bytes = new Uint8Array(cleanHex.length / 2);

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }

  // Parse first 16 bytes as little-endian u128
  let result = 0n;
  for (let i = Math.min(15, bytes.length - 1); i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i]);
  }

  return result;
}

/**
 * Claim winnings from a resolved market (xUDT token burning)
 *
 * Winners burn their xUDT tokens (YES or NO) to redeem CKB from escrow.
 *
 * Payout formula (CSMM with xUDT):
 *   payout = tokenAmount (1:1 redemption)
 *
 * @param signer - CCC signer (token holder)
 * @param marketTxHash - Transaction hash of resolved market
 * @param marketOutputIndex - Output index of market cell
 * @param tokenTxHash - Transaction hash of xUDT cell
 * @param tokenOutputIndex - Output index of xUDT cell
 * @returns Transaction hash and payout amount
 */
export async function claimWinnings(
  signer: ccc.Signer,
  marketTxHash: string,
  marketOutputIndex: number,
  tokenTxHash: string,
  tokenOutputIndex: number
): Promise<{ txHash: string; payout: bigint }> {
  console.log("\n=== Claiming Winnings (Burning xUDT Tokens) ===");
  console.log(`Market: ${marketTxHash}:${marketOutputIndex}`);
  console.log(`Token cell: ${tokenTxHash}:${tokenOutputIndex}`);

  // Step 1: Fetch market cell (using reliable method)
  const marketOutPoint = { txHash: marketTxHash, index: marketOutputIndex };

  const marketTxData = await signer.client.getTransaction(marketTxHash);
  if (!marketTxData || !marketTxData.transaction) {
    throw new Error("Market transaction not found");
  }

  const marketOutput = marketTxData.transaction.outputs[marketOutputIndex];
  const marketOutputData = marketTxData.transaction.outputsData[marketOutputIndex];

  if (!marketOutput) {
    throw new Error("Market cell output not found");
  }

  const marketCellStatus = await signer.client.getCellLive(marketOutPoint, false);
  if (marketCellStatus && marketCellStatus.status === "dead") {
    throw new Error("Market cell already spent");
  }

  const marketCell = {
    cell: {
      cellOutput: marketOutput,
      outputData: marketOutputData,
    },
  };

  const marketData = decodeMarketData(marketOutputData);

  // Step 2: Validate market is resolved
  if (!marketData.resolved) {
    throw new Error("Market not resolved yet. Cannot claim.");
  }

  console.log(`\nMarket resolved: ${marketData.outcome ? "YES" : "NO"} wins`);

  // Step 3: Fetch xUDT token cell
  const tokenOutPoint = { txHash: tokenTxHash, index: tokenOutputIndex };

  const tokenTxData = await signer.client.getTransaction(tokenTxHash);
  if (!tokenTxData || !tokenTxData.transaction) {
    throw new Error("Token transaction not found");
  }

  const tokenOutput = tokenTxData.transaction.outputs[tokenOutputIndex];
  const tokenOutputData = tokenTxData.transaction.outputsData[tokenOutputIndex];

  if (!tokenOutput) {
    throw new Error("Token cell output not found");
  }

  const tokenCellStatus = await signer.client.getCellLive(tokenOutPoint, false);
  if (tokenCellStatus && tokenCellStatus.status === "dead") {
    throw new Error("Token cell already spent (already claimed?)");
  }

  const tokenCell = {
    cell: {
      cellOutput: tokenOutput,
      outputData: tokenOutputData,
    },
  };

  // Decode token amount
  const tokenAmount = decodeXudtAmount(tokenOutputData);

  // Determine token side by checking type script hash
  const tokenTypeHash = tokenOutput.type?.hash();
  const isYesToken = tokenTypeHash === marketData.yesTokenTypeHash;
  const isNoToken = tokenTypeHash === marketData.noTokenTypeHash;

  if (!isYesToken && !isNoToken) {
    throw new Error("Token is not from this market");
  }

  const tokenSide = isYesToken;

  console.log(`\nToken details:`);
  console.log(`  Type: ${tokenSide ? "YES" : "NO"} tokens`);
  console.log(`  Amount: ${Number(tokenAmount) / Number(CONSTANTS.CKB_SHANNON_RATIO)} tokens`);

  // Step 4: Check if user won
  if (tokenSide !== marketData.outcome) {
    throw new Error("These are losing tokens. No payout available.");
  }

  console.log("✅ These are WINNING tokens!");

  // Step 5: Calculate payout using ACTUAL escrow and ACTUAL supply
  // NOT 1:1! Virtual liquidity affects minting prices but not redemption

  // Available escrow = market capacity - structural minimum
  const availableEscrow = marketCell.cell.cellOutput.capacity - CONSTANTS.MIN_MARKET_CAPACITY;

  // Actual winning token supply (no virtual liquidity)
  const actualWinningSupply = tokenSide ? marketData.yesSupply : marketData.noSupply;

  if (actualWinningSupply === 0n) {
    throw new Error("No winning tokens exist (should not happen)");
  }

  // Redemption rate = available escrow / actual winning supply
  // User payout = (user tokens / total winning tokens) × available escrow
  const payout = (tokenAmount * availableEscrow) / actualWinningSupply;

  console.log(`\nPayout calculation (proportional redemption):`);
  console.log(`  Available escrow: ${Number(availableEscrow) / Number(CONSTANTS.CKB_SHANNON_RATIO)} CKB`);
  console.log(`  Actual winning supply: ${Number(actualWinningSupply) / Number(CONSTANTS.CKB_SHANNON_RATIO)} tokens`);
  console.log(`  Your tokens: ${Number(tokenAmount) / Number(CONSTANTS.CKB_SHANNON_RATIO)} tokens`);
  console.log(`  Your share: ${Number((tokenAmount * 100n) / actualWinningSupply)}%`);
  console.log(`  CKB payout: ${Number(payout) / Number(CONSTANTS.CKB_SHANNON_RATIO)} CKB`);
  console.log(`  Redemption rate: ${Number(availableEscrow) / Number(actualWinningSupply)} CKB per token`);

  // Step 6: Calculate new market capacity
  // Market acts as ESCROW - reduce capacity by payout amount
  const newMarketCapacity = marketCell.cell.cellOutput.capacity - payout;

  // Sanity check: should never go below minimum (payout calculation already accounts for this)
  if (newMarketCapacity < CONSTANTS.MIN_MARKET_CAPACITY) {
    throw new Error(
      `Internal error: payout would leave insufficient market capacity. ` +
      `This should not happen with proportional payouts.`
    );
  }

  // Step 7: Get user address
  const userAddress = await signer.getRecommendedAddress();
  const userLock = (await ccc.Address.fromString(userAddress, signer.client)).script;

  // Step 8: Build transaction
  // Consume: Market cell + xUDT token cell (tokens being burned)
  // Create: Updated market cell + Payout cell
  const tx = ccc.Transaction.from({
    inputs: [
      // Input 0: Market cell (ESCROW being reduced)
      {
        previousOutput: marketOutPoint,
        cellOutput: marketCell.cell.cellOutput,
        outputData: marketCell.cell.outputData,
      },
      // Input 1: xUDT token cell (TOKENS being burned)
      {
        previousOutput: tokenOutPoint,
        cellOutput: tokenCell.cell.cellOutput,
        outputData: tokenCell.cell.outputData,
      },
    ],
    outputs: [
      // Output 0: Updated market cell (reduced escrow)
      {
        lock: marketCell.cell.cellOutput.lock,
        capacity: newMarketCapacity,
      },
      // Output 1: Payout to winner (+ xUDT cell capacity returned)
      {
        lock: userLock,
        capacity: payout + tokenCell.cell.cellOutput.capacity, // Payout + token cell capacity
      },
    ],
    outputsData: [
      // Market data stays the same (supplies frozen at resolution)
      marketCell.cell.outputData,
      // Payout cell has no data
      "0x",
    ],
  });

  // Add xUDT script cell dep (needed for burning tokens)
  await tx.addCellDepsOfKnownScripts(signer.client, ccc.KnownScript.XUdt);

  console.log("\nBuilding claim transaction...");
  console.log(`  Market escrow: ${Number(marketCell.cell.cellOutput.capacity) / Number(CONSTANTS.CKB_SHANNON_RATIO)} CKB → ${Number(newMarketCapacity) / Number(CONSTANTS.CKB_SHANNON_RATIO)} CKB`);
  console.log(`  Tokens burned: ${Number(tokenAmount) / Number(CONSTANTS.CKB_SHANNON_RATIO)}`);
  console.log(`  CKB payout: ${Number(payout) / Number(CONSTANTS.CKB_SHANNON_RATIO)} CKB (proportional)`);
  console.log(`  Token cell capacity: ${Number(tokenCell.cell.cellOutput.capacity) / Number(CONSTANTS.CKB_SHANNON_RATIO)} CKB (returned to user)`);

  // Complete transaction (CCC handles witnesses automatically)
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000);

  // Sign and send
  const txHash = await signer.sendTransaction(tx);
  const totalReceived = payout + tokenCell.cell.cellOutput.capacity;

  console.log(`\n🎉 Winnings claimed successfully!`);
  console.log(`Transaction hash: ${txHash}`);
  console.log(`Tokens burned: ${Number(tokenAmount) / Number(CONSTANTS.CKB_SHANNON_RATIO)}`);
  console.log(`CKB payout: ${Number(payout) / Number(CONSTANTS.CKB_SHANNON_RATIO)} CKB`);
  console.log(`Token cell capacity returned: ${Number(tokenCell.cell.cellOutput.capacity) / Number(CONSTANTS.CKB_SHANNON_RATIO)} CKB`);
  console.log(`Total received: ${Number(totalReceived) / Number(CONSTANTS.CKB_SHANNON_RATIO)} CKB`);

  // Auto-update .env with new market OutPoint
  updateEnvMarketOutPoint(txHash, 0);

  return { txHash, payout: totalReceived };
}
