/**
 * Find all market cells owned by your address
 */

import { ccc } from "@ckb-ccc/core";
import { decodeMarketData } from "../src/encoding.js";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found");
  }

  const client = new ccc.ClientPublicTestnet();
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
  const userAddress = await signer.getRecommendedAddress();

  console.log("🔍 Searching for market cells...");
  console.log(`Your address: ${userAddress}\n`);

  const address = await ccc.Address.fromString(userAddress, client);
  const userLock = address.script;

  const collector = client.findCellsByLock(userLock, undefined, true);

  let foundMarkets = 0;

  for await (const cell of collector) {
    // Try to decode as market data (50 bytes)
    if (cell.outputData.length === 102) { // 0x + 50*2 hex chars = 102
      try {
        const marketData = decodeMarketData(cell.outputData);

        foundMarkets++;
        console.log(`\n✅ MARKET ${foundMarkets} FOUND!`);
        console.log(`   OutPoint: ${cell.outPoint!.txHash}:${cell.outPoint!.index}`);
        console.log(`   Capacity: ${cell.cellOutput.capacity / 100000000n} CKB`);
        console.log(`   YES pool: ${marketData.yesPool / 100000000n} CKB`);
        console.log(`   NO pool: ${marketData.noPool / 100000000n} CKB`);
        console.log(`   Total bets: ${marketData.totalBets}`);
        console.log(`   Resolved: ${marketData.resolved}`);
        console.log(`   Deadline: ${new Date(Number(marketData.deadline) * 1000).toISOString()}`);

        console.log(`\n📝 Add to .env:`);
        console.log(`MARKET_TX_HASH=${cell.outPoint!.txHash}`);
        console.log(`MARKET_OUTPUT_INDEX=${cell.outPoint!.index}`);
      } catch {
        // Not a valid market cell
      }
    }
  }

  if (foundMarkets === 0) {
    console.log("❌ No market cells found owned by your address.");
    console.log("\nPossible reasons:");
    console.log("1. Market was already spent (bet placed, resolved, etc.)");
    console.log("2. Market creation failed");
    console.log("3. Need to create a new market: pnpm run create");
  }
}

main();
