/**
 * Example 3: View Market State
 *
 * This example shows how to query and display the current state of a market.
 *
 * Run: pnpm exec tsx examples/03-view-market.ts
 */

import { ccc } from "@ckb-ccc/core";
import { getMarketCell, displayMarketSummary, findUserPositions, calculatePayout } from "../src/queries.js";
import { CONSTANTS } from "../src/types.js";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║             VIEW MARKET STATE EXAMPLE                ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  // Step 1: Set up client
  const client = new ccc.ClientPublicTestnet();

  // Step 2: Get market details from env
  const MARKET_TX_HASH = process.env.MARKET_TX_HASH || "0x...";
  const MARKET_OUTPUT_INDEX = parseInt(process.env.MARKET_OUTPUT_INDEX || "0");

  if (MARKET_TX_HASH === "0x...") {
    console.log("❌ Error: Please set MARKET_TX_HASH and MARKET_OUTPUT_INDEX in .env");
    process.exit(1);
  }

  console.log(`📊 Fetching market: ${MARKET_TX_HASH.slice(0, 10)}...${MARKET_TX_HASH.slice(-8)}:${MARKET_OUTPUT_INDEX}\n`);

  // Step 3: Fetch and display market
  try {
    const marketResult = await getMarketCell(client, MARKET_TX_HASH, MARKET_OUTPUT_INDEX);

    if (!marketResult) {
      console.log("❌ Market not found or already spent");
      process.exit(1);
    }

    const { data: marketData } = marketResult;

    // Display formatted summary
    displayMarketSummary(marketData);

    // Step 4: Query user token holdings (optional)
    if (process.env.PRIVATE_KEY) {
      const signer = new ccc.SignerCkbPrivateKey(client, process.env.PRIVATE_KEY);
      const userAddress = await signer.getRecommendedAddress();

      console.log("\n\n📋 YOUR TOKEN HOLDINGS:\n");

      const tokens = await findUserPositions(client, userAddress, marketData);

      if (tokens.length === 0) {
        console.log("   No tokens found for your address.");
      } else {
        console.log(`   Found ${tokens.length} token holding(s):\n`);

        for (let i = 0; i < tokens.length; i++) {
          const token = tokens[i];
          const payout = calculatePayout(token.amount, token.side, marketData);

          console.log(`   Holding ${i + 1}:`);
          const txHashStr = typeof token.outPoint.txHash === 'string' ? token.outPoint.txHash : ccc.hexFrom(token.outPoint.txHash);
          console.log(`     OutPoint: ${txHashStr.slice(0, 10)}...${txHashStr.slice(-8)}:${token.outPoint.index}`);
          console.log(`     Type: ${token.side ? "YES ✅" : "NO ❌"} tokens`);
          console.log(`     Amount: ${Number(token.amount) / Number(CONSTANTS.CKB_SHANNON_RATIO)} tokens`);

          if (marketData.resolved) {
            if (token.side === marketData.outcome) {
              console.log(`     Status: WON 🎉`);
              console.log(`     Redeemable: ${Number(payout.winningPayout) / Number(CONSTANTS.CKB_SHANNON_RATIO)} CKB (1:1)`);
            } else {
              console.log(`     Status: LOST 😢`);
              console.log(`     Value: 0 CKB (worthless)`);
            }
          } else {
            console.log(`     Potential value: ${Number(payout.winningPayout) / Number(CONSTANTS.CKB_SHANNON_RATIO)} CKB (if ${token.side ? "YES" : "NO"} wins)`);
          }

          console.log("");
        }
      }
    }

    console.log("\n⏭️  Next steps:");
    if (!marketData.resolved) {
      console.log("   - Place more bets: pnpm exec tsx examples/02-place-bet.ts");
      console.log("   - Resolve market: pnpm exec tsx examples/04-resolve.ts");
    } else {
      console.log("   - Claim winnings: pnpm exec tsx examples/05-claim.ts");
    }

  } catch (error) {
    console.error("\n❌ Error viewing market:", error);
    process.exit(1);
  }
}

main();
