/**
 * Example 4: Resolve a Market
 *
 * This example shows how to resolve a prediction market by declaring the outcome.
 *
 * Prerequisites: Market must exist and have bets placed
 * Run: pnpm exec tsx examples/04-resolve.ts
 */

import { ccc } from "@ckb-ccc/core";
import { resolveMarket } from "../src/resolution.js";
import { getMarketCell } from "../src/queries.js";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║             RESOLVE MARKET EXAMPLE                   ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  // Step 1: Set up signer
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found in .env file");
  }

  const client = new ccc.ClientPublicTestnet();
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);

  console.log("📡 Connected to CKB Testnet");
  console.log(`🔑 Your address: ${await signer.getRecommendedAddress()}\n`);

  // Step 2: Get market details
  const MARKET_TX_HASH = process.env.MARKET_TX_HASH || "0x...";
  const MARKET_OUTPUT_INDEX = parseInt(process.env.MARKET_OUTPUT_INDEX || "0");

  if (MARKET_TX_HASH === "0x...") {
    console.log("❌ Error: Please set MARKET_TX_HASH and MARKET_OUTPUT_INDEX in .env");
    process.exit(1);
  }

  console.log(`📊 Market: ${MARKET_TX_HASH.slice(0, 10)}...${MARKET_TX_HASH.slice(-8)}:${MARKET_OUTPUT_INDEX}\n`);

  // Step 3: Fetch current market state
  const marketResult = await getMarketCell(client, MARKET_TX_HASH, MARKET_OUTPUT_INDEX);

  if (!marketResult) {
    console.log("❌ Market not found");
    process.exit(1);
  }

  if (marketResult.data.resolved) {
    console.log("⚠️  Market already resolved!");
    console.log(`Outcome: ${marketResult.data.outcome ? "YES" : "NO"} wins\n`);
    process.exit(0);
  }

  // Step 4: Determine outcome
  // For MVP, we hardcode the outcome (in production, this would come from an oracle)
  const OUTCOME = false; // true = YES wins, false = NO wins

  console.log("🎲 Declaring outcome...");
  console.log(`   Event: "Will BTC close above $100,000 on 2025-11-10?"`);
  console.log(`   Outcome: ${OUTCOME ? "YES ✅ (BTC closed above $100k)" : "NO ❌ (BTC closed below $100k)"}\n`);

  console.log("⚠️  Phase 1 Note: This is a deterministic/manual resolution.");
  console.log("   Phase 2+ will use oracles for real event outcomes.\n");

  // Step 5: Resolve the market
  try {
    const result = await resolveMarket(
      signer,
      MARKET_TX_HASH,
      MARKET_OUTPUT_INDEX,
      OUTCOME
    );

    console.log("\n╔══════════════════════════════════════════════════════╗");
    console.log("║             MARKET RESOLVED SUCCESSFULLY              ║");
    console.log("╚══════════════════════════════════════════════════════╝\n");

    console.log("📝 Updated market OutPoint:\n");
    console.log(`MARKET_TX_HASH=${result.txHash}`);
    console.log(`MARKET_OUTPUT_INDEX=${result.outputIndex}\n`);

    console.log("🔗 View on explorer:");
    console.log(`https://pudge.explorer.nervos.org/transaction/${result.txHash}\n`);

    console.log("⏭️  Next steps:");
    console.log("   1. Update MARKET_TX_HASH in .env to the new value above");
    console.log("   2. Winners can now claim: pnpm exec tsx examples/05-claim.ts");

  } catch (error) {
    console.error("\n❌ Error resolving market:", error);
    process.exit(1);
  }
}

main();
