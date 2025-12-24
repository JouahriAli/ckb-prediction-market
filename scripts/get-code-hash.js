import { ccc } from "@ckb-ccc/ccc";
import fs from "fs";

const binary = fs.readFileSync('../contracts/market/build/market');
const dataHex = "0x" + binary.toString("hex");
const codeHash = ccc.hashCkb(dataHex);
console.log(codeHash);
