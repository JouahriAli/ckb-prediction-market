/**
 * Query Functions (CSMM + xUDT Design)
 *
 * This module provides functions to query the CKB blockchain for:
 * - Market cells (current market state with token supplies)
 * - xUDT token cells (user's YES/NO tokens)
 *
 * In CKB, we query cells using:
 * 1. OutPoint (txHash + index) - if we know the exact cell
 * 2. Lock script - to find all cells owned by an address
 * 3. Type script - to find all cells of a certain token type
 */

import { ccc } from "@ckb-ccc/core";
import { MarketData, CONSTANTS } from "./types.js";
import { decodeMarketData } from "./encoding.js";

/**
 * Fetch and decode a market cell
 *
 * Given the OutPoint (txHash + index) of a market cell,
 * this fetches it from the blockchain and decodes its data.
 *
 * @param client - CCC client
 * @param txHash - Transaction hash that created the market
 * @param outputIndex - Output index of the market cell
 * @returns Market cell with decoded data, or null if not found
 */
export async function getMarketCell(
  client: ccc.Client,
  txHash: string,
  outputIndex: number
): Promise<{ cell: ccc.Cell; data: MarketData } | null> {
  console.log(`\n=== Fetching Market Cell ===`);
  console.log(`OutPoint: ${txHash}:${outputIndex}`);

  try {
    // Fetch the transaction and extract the cell data
    const tx = await client.getTransaction(txHash);
    if (!tx || !tx.transaction) {
      console.log("❌ Transaction not found");
      return null;
    }

    const output = tx.transaction.outputs[outputIndex];
    const outputData = tx.transaction.outputsData[outputIndex];

    if (!output) {
      console.log("❌ Output index not found");
      return null;
    }

    // Check if cell is still live (not spent)
    const cellStatus = await client.getCellLive({ txHash, index: outputIndex }, false);
    if (cellStatus && cellStatus.status === "dead") {
      console.log("❌ Market cell already spent");
      return null;
    }

    const cell: any = {
      cellOutput: output,
      outputData: outputData,
      outPoint: { txHash, index: outputIndex },
    };

    // Decode the market data
    const marketData = decodeMarketData(outputData);

    console.log("✅ Market cell found:");
    console.log(`  Escrow: ${Number(cell.cellOutput.capacity) / Number(CONSTANTS.CKB_SHANNON_RATIO)} CKB`);
    console.log(`  YES supply: ${Number(marketData.yesSupply) / Number(CONSTANTS.CKB_SHANNON_RATIO)} tokens`);
    console.log(`  NO supply: ${Number(marketData.noSupply) / Number(CONSTANTS.CKB_SHANNON_RATIO)} tokens`);
    console.log(`  Total bets: ${marketData.totalBets}`);
    console.log(`  Resolved: ${marketData.resolved}`);
    if (marketData.resolved) {
      console.log(`  Outcome: ${marketData.outcome ? "YES" : "NO"} wins`);
    }
    console.log(`  Deadline: ${new Date(Number(marketData.deadline) * 1000).toISOString()}`);

    return { cell, data: marketData };
  } catch (error) {
    console.error("Error fetching market cell:", error);
    return null;
  }
}

/**
 * Decode xUDT token amount from cell data
 *
 * xUDT cells store token amount as 16-byte little-endian u128
 *
 * @param data - Cell output data (hex string)
 * @returns Token amount as bigint
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
 * Find all xUDT token cells (YES/NO) owned by a user for a specific market
 *
 * This searches for xUDT cells by scanning all user cells and checking their type scripts.
 *
 * @param client - CCC client
 * @param userAddress - User's CKB address
 * @param marketData - Market data (contains token type hashes)
 * @returns Array of token holdings with amounts
 */
export async function findUserPositions(
  client: ccc.Client,
  userAddress: string,
  marketData?: MarketData
): Promise<Array<{ side: boolean; amount: bigint; outPoint: ccc.OutPointLike }>> {
  console.log(`\n=== Finding User Token Holdings ===`);
  console.log(`User: ${userAddress}`);

  if (!marketData) {
    console.log("⚠️  No market data provided, cannot query tokens");
    return [];
  }

  try {
    // Parse user address to get lock script
    const address = await ccc.Address.fromString(userAddress, client);
    const userLock = address.script;

    console.log("\nSearching for xUDT token cells by scanning user's cells...");

    const tokens: Array<{ side: boolean; amount: bigint; outPoint: ccc.OutPointLike }> = [];

    // Scan all user's cells and check if they match the market's token type hashes
    const collector = client.findCellsByLock(userLock, undefined, true);

    for await (const cell of collector) {
      // Check if cell has a type script
      if (!cell.cellOutput.type) {
        continue;
      }

      const typeHash = cell.cellOutput.type.hash();

      // Check if it matches YES token
      if (typeHash === marketData.yesTokenTypeHash) {
        const amount = decodeXudtAmount(cell.outputData);
        if (amount > 0n) {
          tokens.push({
            side: true,
            amount,
            outPoint: cell.outPoint!,
          });
          console.log(`  Found YES tokens: ${Number(amount) / Number(CONSTANTS.CKB_SHANNON_RATIO)}`);
        }
      }

      // Check if it matches NO token
      if (typeHash === marketData.noTokenTypeHash) {
        const amount = decodeXudtAmount(cell.outputData);
        if (amount > 0n) {
          tokens.push({
            side: false,
            amount,
            outPoint: cell.outPoint!,
          });
          console.log(`  Found NO tokens: ${Number(amount) / Number(CONSTANTS.CKB_SHANNON_RATIO)}`);
        }
      }
    }

    console.log(`\n✅ Found ${tokens.length} token holding(s)`);

    return tokens;
  } catch (error) {
    console.error("Error finding user tokens:", error);
    return [];
  }
}

/**
 * Calculate potential payout for token holdings (CSMM model)
 *
 * In the CSMM + xUDT model, users hold tokens, not direct CKB positions.
 * If their side wins, they can redeem tokens 1:1 for CKB from the escrow.
 *
 * Formula:
 *   If user's side wins:
 *     payout = tokenAmount (1:1 redemption)
 *   If user's side loses:
 *     payout = 0
 *
 * @param tokenAmount - Number of YES or NO tokens held
 * @param side - true = YES tokens, false = NO tokens
 * @param marketData - Current market state
 * @returns Potential payout in shannons
 */
export function calculatePayout(
  tokenAmount: bigint,
  side: boolean,
  marketData: MarketData
): { winningPayout: bigint; losingPayout: bigint } {
  // In CSMM, winning tokens redeem 1:1 for CKB
  // Losing tokens are worthless
  return {
    winningPayout: tokenAmount,  // 1:1 redemption if wins
    losingPayout: 0n,             // Worthless if loses
  };
}

/**
 * Display market summary (CSMM model)
 *
 * Pretty-prints market state with token supplies and implied probabilities.
 *
 * @param marketData - Decoded market data
 */
export function displayMarketSummary(marketData: MarketData): void {
  console.log("\n╔════════════════════════════════════════╗");
  console.log("║   PREDICTION MARKET SUMMARY (CSMM)     ║");
  console.log("╠════════════════════════════════════════╣");

  // Calculate effective supplies (actual + virtual liquidity)
  const virtualLiq = CONSTANTS.VIRTUAL_LIQUIDITY;
  const effectiveYes = marketData.yesSupply + virtualLiq;
  const effectiveNo = marketData.noSupply + virtualLiq;
  const totalEffective = effectiveYes + effectiveNo;

  // Implied probabilities based on effective supplies
  const yesProb = totalEffective > 0n ? Number((effectiveYes * 100n) / totalEffective) : 50;
  const noProb = totalEffective > 0n ? Number((effectiveNo * 100n) / totalEffective) : 50;

  console.log(`║ YES Supply:    ${(Number(marketData.yesSupply) / Number(CONSTANTS.CKB_SHANNON_RATIO)).toFixed(2).padStart(15)} tok ║`);
  console.log(`║ NO Supply:     ${(Number(marketData.noSupply) / Number(CONSTANTS.CKB_SHANNON_RATIO)).toFixed(2).padStart(15)} tok ║`);
  console.log("╠════════════════════════════════════════╣");
  console.log(`║ YES Implied:   ${yesProb.toFixed(1).padStart(15)}%   ║`);
  console.log(`║ NO Implied:    ${noProb.toFixed(1).padStart(15)}%   ║`);
  console.log("╠════════════════════════════════════════╣");
  console.log(`║ Total Bets:    ${marketData.totalBets.toString().padStart(19)} ║`);
  console.log(`║ Status:        ${(marketData.resolved ? "RESOLVED" : "ACTIVE").padStart(19)} ║`);

  if (marketData.resolved) {
    console.log(`║ Winner:        ${(marketData.outcome ? "YES" : "NO").padStart(19)} ║`);
  } else {
    const deadline = new Date(Number(marketData.deadline) * 1000);
    console.log(`║ Deadline:      ${deadline.toISOString().slice(0, 19)} ║`);
  }

  console.log("╚════════════════════════════════════════╝");
}
