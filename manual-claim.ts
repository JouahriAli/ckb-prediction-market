import { ccc } from "@ckb-ccc/core";
import { claimWinnings } from "./src/resolution.js";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const privateKey = process.env.PRIVATE_KEY!;
  const client = new ccc.ClientPublicTestnet();
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);

  console.log("Claiming 240 NO tokens");

  const result = await claimWinnings(
    signer,
    "0xa2b2130d109457c2a42bdd5fc7ea332cf6fa8093ff496f46256ec6fa689e14f7", // Resolved market
    0,
    "0x2f56d3e286550d8fe1a74c51c9130ba4f7c3b8877a62bb6f469d78270cdc24d6", // Token cell from bet
    1
  );

  console.log("\n✅ Success! Total received:", Number(result.payout) / Number(100_00000000n), "CKB");
}

main();
