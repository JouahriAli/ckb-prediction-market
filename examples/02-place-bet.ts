/**
 * Example 2: Place Bets on a Market
 *
 * This example shows how to place YES and NO bets on a prediction market.
 *
 * Prerequisites: Run 01-create-market.ts first
 * Run: pnpm exec tsx examples/02-place-bet.ts
 */

import { ccc } from "@ckb-ccc/core";
import { placeBet } from "../src/betting.js";
import { CONSTANTS } from "../src/types.js";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║             PLACE BET EXAMPLE                        ║");
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
  // Replace these with the values from 01-create-market.ts output
  const MARKET_TX_HASH = process.env.MARKET_TX_HASH || "0x...";
  const MARKET_OUTPUT_INDEX = parseInt(process.env.MARKET_OUTPUT_INDEX || "0");

  if (MARKET_TX_HASH === "0x...") {
    console.log("❌ Error: Please set MARKET_TX_HASH and MARKET_OUTPUT_INDEX");
    console.log("\nAdd to your .env file:");
    console.log("MARKET_TX_HASH=0x...");
    console.log("MARKET_OUTPUT_INDEX=0\n");
    console.log("(Get these values from the output of 01-create-market.ts)");
    process.exit(1);
  }

  console.log(`📊 Market: ${MARKET_TX_HASH.slice(0, 10)}...${MARKET_TX_HASH.slice(-8)}:${MARKET_OUTPUT_INDEX}\n`);

  // Step 3: Choose bet parameters
  const betSide = false; // true = YES, false = NO
  const betAmountCKB = 120n; // 120 CKB bet amount
  const betAmount = betAmountCKB * CONSTANTS.CKB_SHANNON_RATIO;

  console.log("🎲 Bet Details:");
  console.log(`   Side: ${betSide ? "YES ✅" : "NO ❌"}`);
  console.log(`   Bet amount: ${betAmountCKB} CKB`);
  console.log(`   Receipt cell: 120 CKB (overhead)`);
  console.log(`   Total cost: ${betAmountCKB + 120n} CKB\n`);

  // Step 4: Place the bet
  try {
    const result = await placeBet(
      signer,
      MARKET_TX_HASH,
      MARKET_OUTPUT_INDEX,
      betSide,
      betAmount
    );

    console.log("\n╔══════════════════════════════════════════════════════╗");
    console.log("║               BET PLACED SUCCESSFULLY                 ║");
    console.log("╚══════════════════════════════════════════════════════╝\n");

    console.log("📝 Position details:\n");
    console.log(`POSITION_TX_HASH=${result.txHash}`);
    console.log(`POSITION_OUTPUT_INDEX=${result.outputIndex}\n`);

    console.log("🔗 View on explorer:");
    console.log(`https://pudge.explorer.nervos.org/transaction/${result.txHash}\n`);

    console.log("💡 Note: The market cell has been updated!");
    console.log(`   New market OutPoint: ${result.txHash}:0\n`);

    console.log("⏭️  Next steps:");
    console.log("   1. Update MARKET_TX_HASH in .env to the new value above");
    console.log("   2. Place more bets (run this script again)");
    console.log("   3. View market state: pnpm exec tsx examples/03-view-market.ts");
  } catch (error) {
    console.error("\n❌ Error placing bet:", error);
    process.exit(1);
  }
}

main();
