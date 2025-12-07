/**
 * Utility functions for the prediction market
 */

import * as fs from "fs";
import * as path from "path";

/**
 * Update the .env file with new market OutPoint
 *
 * This automatically updates MARKET_TX_HASH and MARKET_OUTPUT_INDEX
 * after transactions that modify the market cell.
 *
 * @param txHash - New transaction hash
 * @param outputIndex - Output index (usually 0 for market cell)
 */
export function updateEnvMarketOutPoint(txHash: string, outputIndex: number = 0): void {
  try {
    // Find the .env file (in project root)
    const envPath = path.join(process.cwd(), ".env");

    // Read current .env content
    let envContent = "";
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, "utf-8");
    }

    // Update or add MARKET_TX_HASH
    if (envContent.includes("MARKET_TX_HASH=")) {
      envContent = envContent.replace(
        /MARKET_TX_HASH=.*/,
        `MARKET_TX_HASH=${txHash}`
      );
    } else {
      envContent += `\nMARKET_TX_HASH=${txHash}`;
    }

    // Update or add MARKET_OUTPUT_INDEX
    if (envContent.includes("MARKET_OUTPUT_INDEX=")) {
      envContent = envContent.replace(
        /MARKET_OUTPUT_INDEX=.*/,
        `MARKET_OUTPUT_INDEX=${outputIndex}`
      );
    } else {
      envContent += `\nMARKET_OUTPUT_INDEX=${outputIndex}`;
    }

    // Write back to .env
    fs.writeFileSync(envPath, envContent, "utf-8");

    console.log("\n✅ .env updated automatically:");
    console.log(`   MARKET_TX_HASH=${txHash}`);
    console.log(`   MARKET_OUTPUT_INDEX=${outputIndex}`);
  } catch (error) {
    console.error("\n⚠️  Warning: Could not update .env file:", error);
    console.log("Please manually update .env with:");
    console.log(`MARKET_TX_HASH=${txHash}`);
    console.log(`MARKET_OUTPUT_INDEX=${outputIndex}`);
  }
}

/**
 * Update .env with position OutPoint (for reference)
 *
 * This saves the latest position cell for claiming later.
 *
 * @param txHash - Position transaction hash
 * @param outputIndex - Position output index
 */
export function updateEnvPositionOutPoint(txHash: string, outputIndex: number): void {
  try {
    const envPath = path.join(process.cwd(), ".env");

    let envContent = "";
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, "utf-8");
    }

    // Update or add POSITION_TX_HASH
    if (envContent.includes("POSITION_TX_HASH=")) {
      envContent = envContent.replace(
        /POSITION_TX_HASH=.*/,
        `POSITION_TX_HASH=${txHash}`
      );
    } else {
      envContent += `\nPOSITION_TX_HASH=${txHash}`;
    }

    // Update or add POSITION_OUTPUT_INDEX
    if (envContent.includes("POSITION_OUTPUT_INDEX=")) {
      envContent = envContent.replace(
        /POSITION_OUTPUT_INDEX=.*/,
        `POSITION_OUTPUT_INDEX=${outputIndex}`
      );
    } else {
      envContent += `\nPOSITION_OUTPUT_INDEX=${outputIndex}`;
    }

    fs.writeFileSync(envPath, envContent, "utf-8");

    console.log("   POSITION_TX_HASH=${txHash}");
    console.log("   POSITION_OUTPUT_INDEX=${outputIndex}");
  } catch (error) {
    // Silent failure - position tracking is optional
  }
}
