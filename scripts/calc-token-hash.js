import { ccc } from "@ckb-ccc/ccc";
import fs from "fs";

const binary = fs.readFileSync('../contracts/market-token/target/riscv64imac-unknown-none-elf/release/market-token');
const dataHex = "0x" + binary.toString("hex");
const codeHash = ccc.hashCkb(dataHex);
console.log("New Token Contract Code Hash:");
console.log(codeHash);
