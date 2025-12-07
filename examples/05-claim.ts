/**
 * Example 5: Claim Winnings (Burn xUDT Tokens)
 *
 * This example shows how winners can claim their share by burning winning tokens.
 *
 * Prerequisites: Market must be resolved
 * Run: pnpm exec tsx examples/05-claim.ts
 */

import { ccc } from "@ckb-ccc/core";
import { claimWinnings } from "../src/resolution.js";
import { getMarketCell, findUserPositions } from "../src/queries.js";
import { CONSTANTS } from "../src/types.js";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║             CLAIM WINNINGS EXAMPLE                   ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  // Step 1: Set up signer
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found in .env file");
  }

  const client = new ccc.ClientPublicTestnet();
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);

  console.log("📡 Connected to CKB Testnet");
  const userAddress = await signer.getRecommendedAddress();
  console.log(`🔑 Your address: ${userAddress}\n`);

  // Step 2: Get market details
  const MARKET_TX_HASH = process.env.MARKET_TX_HASH || "0x...";
  const MARKET_OUTPUT_INDEX = parseInt(process.env.MARKET_OUTPUT_INDEX || "0");

  if (MARKET_TX_HASH === "0x...") {
    console.log("❌ Error: Please set MARKET_TX_HASH and MARKET_OUTPUT_INDEX in .env");
    process.exit(1);
  }

  console.log(`📊 Market: ${MARKET_TX_HASH.slice(0, 10)}...${MARKET_TX_HASH.slice(-8)}:${MARKET_OUTPUT_INDEX}\n`);

  // Step 3: Fetch market state
  const marketResult = await getMarketCell(client, MARKET_TX_HASH, MARKET_OUTPUT_INDEX);

  if (!marketResult) {
    console.log("❌ Market not found");
    process.exit(1);
  }

  if (!marketResult.data.resolved) {
    console.log("❌ Market not resolved yet. Cannot claim.");
    console.log("   Run: pnpm exec tsx examples/04-resolve.ts first\n");
    process.exit(1);
  }

  console.log(`✅ Market resolved: ${marketResult.data.outcome ? "YES" : "NO"} wins\n`);

  // Step 4: Find user's token holdings
  console.log("🔍 Searching for your token holdings...\n");
  const tokens = await findUserPositions(client, userAddress, marketResult.data);

  if (tokens.length === 0) {
    console.log("❌ No token holdings found for your address.");
    process.exit(0);
  }

  console.log(`Found ${tokens.length} token holding(s):\n`);

  // Filter for winning tokens
  const winningTokens = tokens.filter(
    (token) => token.side === marketResult.data.outcome
  );

  if (winningTokens.length === 0) {
    console.log("😢 None of your tokens won. Better luck next time!\n");
    process.exit(0);
  }

  console.log(`🎉 You have ${winningTokens.length} winning token holding(s)!\n`);

  // Step 5: Claim each winning token holding
  // Track the current market OutPoint (changes after each claim)
  let currentMarketTxHash = MARKET_TX_HASH;
  let currentMarketOutputIndex = MARKET_OUTPUT_INDEX;

  for (let i = 0; i < winningTokens.length; i++) {
    const token = winningTokens[i];
    const txHashStr = typeof token.outPoint.txHash === 'string' ? token.outPoint.txHash : ccc.hexFrom(token.outPoint.txHash);

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Claiming tokens ${i + 1}/${winningTokens.length}:`);
    console.log(`  Token Cell: ${txHashStr.slice(0, 10)}...${txHashStr.slice(-8)}:${token.outPoint.index}`);
    console.log(`  Type: ${token.side ? "YES ✅" : "NO ❌"} tokens`);
    console.log(`  Amount: ${Number(token.amount) / Number(CONSTANTS.CKB_SHANNON_RATIO)} tokens`);
    console.log(`  Expected payout: ${Number(token.amount) / Number(CONSTANTS.CKB_SHANNON_RATIO)} CKB (1:1 redemption)`);

    try {
      const result = await claimWinnings(
        signer,
        currentMarketTxHash,
        currentMarketOutputIndex,
        txHashStr,
        Number(token.outPoint.index)
      );

      console.log(`\n✅ Claim successful!`);
      console.log(`   Transaction: ${result.txHash.slice(0, 10)}...${result.txHash.slice(-8)}`);
      console.log(`   Total received: ${Number(result.payout) / Number(CONSTANTS.CKB_SHANNON_RATIO)} CKB`);

      // Update market OutPoint for next claim
      // (market cell gets updated after each claim)
      currentMarketTxHash = result.txHash;
      currentMarketOutputIndex = 0;

      console.log(`\n📝 Market OutPoint updated: ${result.txHash.slice(0, 10)}...${result.txHash.slice(-8)}:0`);

      // Wait longer between claims to ensure transaction confirmation
      if (i < winningTokens.length - 1) {
        console.log("\n⏳ Waiting 15 seconds for transaction confirmation...");
        await new Promise((resolve) => setTimeout(resolve, 15000));
      }

    } catch (error) {
      console.error(`\n❌ Error claiming tokens ${i + 1}:`, error);
      console.log("\n⚠️  Skipping to next token holding. The market OutPoint may have changed.");
      console.log("   If claims continue to fail, check the explorer and update MARKET_TX_HASH manually.");

      // Wait even on error to avoid spamming the network
      if (i < winningTokens.length - 1) {
        console.log("\n⏳ Waiting 15 seconds before retry...");
        await new Promise((resolve) => setTimeout(resolve, 15000));
      }
    }
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║         ALL WINNINGS CLAIMED SUCCESSFULLY!            ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  console.log("🎊 Congratulations! Check your wallet balance.\n");
}

main();
