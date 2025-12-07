/**
 * Simple market viewer (no position scanning)
 */

import { ccc } from "@ckb-ccc/core";
import { getMarketCell, displayMarketSummary } from "../src/queries.js";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const client = new ccc.ClientPublicTestnet();

  const MARKET_TX_HASH = process.env.MARKET_TX_HASH || "0x...";
  const MARKET_OUTPUT_INDEX = parseInt(process.env.MARKET_OUTPUT_INDEX || "0");

  if (MARKET_TX_HASH === "0x...") {
    console.log("❌ Error: Please set MARKET_TX_HASH in .env");
    process.exit(1);
  }

  console.log(`📊 Market: ${MARKET_TX_HASH.slice(0, 10)}...${MARKET_TX_HASH.slice(-8)}:${MARKET_OUTPUT_INDEX}\n`);

  const marketResult = await getMarketCell(client, MARKET_TX_HASH, MARKET_OUTPUT_INDEX);

  if (!marketResult) {
    console.log("❌ Market not found");
    process.exit(1);
  }

  displayMarketSummary(marketResult.data);
}

main();
