/**
 * Example 1: Create a Prediction Market
 *
 * This example shows how to create a new prediction market on CKB.
 *
 * Run: pnpm exec tsx examples/01-create-market.ts
 */

import { ccc } from "@ckb-ccc/core";
import { createMarket } from "../src/market.js";
import { MarketConfig, CONSTANTS } from "../src/types.js";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

// Load environment variables
dotenv.config();

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║        CREATE PREDICTION MARKET EXAMPLE              ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  // Step 1: Set up CKB client and signer
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found in .env file");
  }

  // Connect to CKB testnet
  const client = new ccc.ClientPublicTestnet();
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);

  console.log("📡 Connected to CKB Testnet (Pudge)");
  console.log(`🔑 Your address: ${await signer.getRecommendedAddress()}\n`);

  // Check balance
  const balance = await signer.getBalance();
  console.log(`💰 Your balance: ${ccc.fixedPointToString(balance)} CKB\n`);

  if (balance < 300n * CONSTANTS.CKB_SHANNON_RATIO) {
    console.log("⚠️  Warning: Low balance. You need at least 300 CKB for this example.");
    console.log("Get testnet CKB from: https://faucet.nervos.org/\n");
  }

  // Step 2: Define market configuration
  const config: MarketConfig = {
    question: "Will BTC close above $100,000 on 2025-12-31?",

    // Deadline: 1 hour before the event (2025-12-31 23:00:00 UTC)
    deadline: BigInt(Math.floor(new Date("2025-12-31T23:00:00Z").getTime() / 1000)),

    // Initial capacity: 300 CKB (280 CKB for structure + 20 CKB buffer)
    // All bets add to this capacity (escrow)
    initialCapacity: 300n * CONSTANTS.CKB_SHANNON_RATIO,
  };

  console.log("📋 Market Configuration:");
  console.log(`   Question: ${config.question}`);
  console.log(`   Deadline: ${new Date(Number(config.deadline) * 1000).toISOString()}`);
  console.log(`   Initial Capacity: ${config.initialCapacity / CONSTANTS.CKB_SHANNON_RATIO} CKB\n`);

  // Step 3: Create the market
  try {
    const result = await createMarket(signer, config);

    console.log("\n╔══════════════════════════════════════════════════════╗");
    console.log("║               MARKET CREATED SUCCESSFULLY             ║");
    console.log("╚══════════════════════════════════════════════════════╝\n");

    console.log("📝 Market details:\n");
    console.log(`MARKET_TX_HASH=${result.txHash}`);
    console.log(`MARKET_OUTPUT_INDEX=${result.outputIndex}\n`);

    // Update .env file with new market outpoint
    const envPath = path.join(process.cwd(), ".env");
    let envContent = fs.readFileSync(envPath, "utf8");

    // Update MARKET_TX_HASH
    if (envContent.includes("MARKET_TX_HASH=")) {
      envContent = envContent.replace(/MARKET_TX_HASH=.*/g, `MARKET_TX_HASH=${result.txHash}`);
    } else {
      envContent += `\nMARKET_TX_HASH=${result.txHash}`;
    }

    // Update MARKET_OUTPUT_INDEX
    if (envContent.includes("MARKET_OUTPUT_INDEX=")) {
      envContent = envContent.replace(/MARKET_OUTPUT_INDEX=.*/g, `MARKET_OUTPUT_INDEX=${result.outputIndex}`);
    } else {
      envContent += `\nMARKET_OUTPUT_INDEX=${result.outputIndex}`;
    }

    fs.writeFileSync(envPath, envContent);
    console.log("✅ Updated .env file with new market outpoint\n");

    console.log("🔗 View on explorer:");
    console.log(`https://pudge.explorer.nervos.org/transaction/${result.txHash}\n`);

    console.log("⏭️  Next steps:");
    console.log("   1. Wait for transaction confirmation (~15 seconds)");
    console.log("   2. Run: pnpm exec tsx examples/02-place-bet.ts");
  } catch (error) {
    console.error("\n❌ Error creating market:", error);
    process.exit(1);
  }
}

main();
