/**
 * Debug script to check market cell status
 */

import { ccc } from "@ckb-ccc/core";
import { decodeMarketData } from "../src/encoding.js";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const client = new ccc.ClientPublicTestnet();

  // The transaction hash from your market creation
  const txHash = "0x0666c66b61bb6b2733453f0464e2866923ba03bbc2a92c992029095a752ce83c";

  console.log("Checking market cell...\n");

  try {
    // Check output 0 (should be the market cell)
    const cellStatus = await client.getCellLive({ txHash, index: 0 }, true);

    if (!cellStatus || !cellStatus.cell) {
      console.log("❌ Cell at index 0 not found or already spent");
      console.log("Status:", cellStatus?.status);
    } else {
      console.log("✅ Found cell at index 0:");
      console.log(`   Capacity: ${cellStatus.cell.cellOutput.capacity / 100000000n} CKB`);
      console.log(`   Data length: ${cellStatus.cell.outputData.length} chars`);

      // Try to decode as market data
      try {
        const marketData = decodeMarketData(cellStatus.cell.outputData);
        console.log("\n📊 Market Data:");
        console.log(`   YES pool: ${marketData.yesPool / 100000000n} CKB`);
        console.log(`   NO pool: ${marketData.noPool / 100000000n} CKB`);
        console.log(`   Total bets: ${marketData.totalBets}`);
        console.log(`   Resolved: ${marketData.resolved}`);
        console.log(`   Deadline: ${new Date(Number(marketData.deadline) * 1000).toISOString()}`);

        console.log("\n✅ This IS a valid market cell!");
        console.log(`\nAdd to your .env:`);
        console.log(`MARKET_TX_HASH=${txHash}`);
        console.log(`MARKET_OUTPUT_INDEX=0`);
      } catch (e) {
        console.log("\n❌ Failed to decode as market data:", e);
      }
    }

    // Also check the transaction itself
    console.log("\n\n📝 Transaction details:");
    const tx = await client.getTransaction(txHash);
    if (tx) {
      console.log(`   Status: ${tx.txStatus.status}`);
      console.log(`   Outputs: ${tx.transaction.outputs.length}`);

      for (let i = 0; i < tx.transaction.outputs.length; i++) {
        console.log(`   Output ${i}: ${tx.transaction.outputs[i].capacity / 100000000n} CKB`);
      }
    }

  } catch (error) {
    console.error("Error:", error);
  }
}

main();
