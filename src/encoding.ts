/**
 * Cell Data Encoding/Decoding for Prediction Market (CSMM + xUDT Design)
 *
 * CKB cells store data as raw bytes. We need to:
 * 1. Encode TypeScript objects → bytes (to write to blockchain)
 * 2. Decode bytes → TypeScript objects (to read from blockchain)
 *
 * Encoding format (manual for MVP - Phase 2 will use Molecule schema):
 *
 * MarketData (114 bytes total):
 *   [0-16]    yesSupply (u128, 16 bytes, little-endian) - total YES tokens in circulation
 *   [16-32]   noSupply (u128, 16 bytes, little-endian) - total NO tokens in circulation
 *   [32-40]   totalBets (u64, 8 bytes, little-endian)
 *   [40]      resolved (1 byte: 0x00=false, 0x01=true)
 *   [41]      outcome (1 byte: 0x00=false, 0x01=true)
 *   [42-50]   deadline (u64, 8 bytes, little-endian)
 *   [50-82]   yesTokenTypeHash (32 bytes) - YES xUDT type script hash
 *   [82-114]  noTokenTypeHash (32 bytes) - NO xUDT type script hash
 *
 * PositionData (DEPRECATED - kept for reference):
 *   Users now hold xUDT tokens in standard xUDT cells instead of position cells.
 */

import { MarketData, PositionData } from "./types.js";

/**
 * Helper: Convert bigint to little-endian bytes
 * @param value - The bigint value to convert
 * @param bytes - Number of bytes to use (8 for u64, 16 for u128)
 */
function bigintToLeBytes(value: bigint, bytes: number): Uint8Array {
  const result = new Uint8Array(bytes);
  let v = value;

  for (let i = 0; i < bytes; i++) {
    result[i] = Number(v & 0xFFn);
    v >>= 8n;
  }

  return result;
}

/**
 * Helper: Convert little-endian bytes to bigint
 * @param bytes - The byte array to convert
 */
function leBytesToBigint(bytes: Uint8Array): bigint {
  let result = 0n;

  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i]);
  }

  return result;
}

/**
 * Helper: Convert hex string to Uint8Array
 * @param hex - Hex string (with or without 0x prefix)
 */
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}

/**
 * Helper: Convert Uint8Array to hex string
 * @param bytes - Byte array to convert
 */
function bytesToHex(bytes: Uint8Array): string {
  return "0x" + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Encode MarketData into bytes (114 bytes total)
 *
 * This converts our TypeScript MarketData object into raw bytes
 * that can be stored in a cell's data field.
 *
 * New format includes yesSupply/noSupply (token amounts) and type script hashes.
 *
 * @param data - The market data to encode
 * @returns Hex string of encoded bytes
 */
export function encodeMarketData(data: MarketData): string {
  const buffer = new Uint8Array(114); // 16+16+8+1+1+8+32+32 = 114 bytes
  let offset = 0;

  // yesSupply: u128 (16 bytes) - total YES tokens in circulation
  buffer.set(bigintToLeBytes(data.yesSupply, 16), offset);
  offset += 16;

  // noSupply: u128 (16 bytes) - total NO tokens in circulation
  buffer.set(bigintToLeBytes(data.noSupply, 16), offset);
  offset += 16;

  // totalBets: u64 (8 bytes)
  buffer.set(bigintToLeBytes(data.totalBets, 8), offset);
  offset += 8;

  // resolved: bool (1 byte)
  buffer[offset++] = data.resolved ? 0x01 : 0x00;

  // outcome: bool (1 byte)
  buffer[offset++] = data.outcome ? 0x01 : 0x00;

  // deadline: u64 (8 bytes)
  buffer.set(bigintToLeBytes(data.deadline, 8), offset);
  offset += 8;

  // yesTokenTypeHash: 32 bytes
  const yesTypeHashBytes = hexToBytes(data.yesTokenTypeHash);
  if (yesTypeHashBytes.length !== 32) {
    throw new Error(`Invalid yesTokenTypeHash length: expected 32 bytes, got ${yesTypeHashBytes.length}`);
  }
  buffer.set(yesTypeHashBytes, offset);
  offset += 32;

  // noTokenTypeHash: 32 bytes
  const noTypeHashBytes = hexToBytes(data.noTokenTypeHash);
  if (noTypeHashBytes.length !== 32) {
    throw new Error(`Invalid noTokenTypeHash length: expected 32 bytes, got ${noTypeHashBytes.length}`);
  }
  buffer.set(noTypeHashBytes, offset);

  return bytesToHex(buffer);
}

/**
 * Decode bytes into MarketData
 *
 * This converts raw bytes from a cell back into our TypeScript object.
 *
 * @param hex - Hex string of encoded market data
 * @returns Decoded MarketData object
 */
export function decodeMarketData(hex: string): MarketData {
  const bytes = hexToBytes(hex);

  if (bytes.length < 114) {
    throw new Error(`Invalid market data length: expected 114 bytes, got ${bytes.length}`);
  }

  let offset = 0;

  // yesSupply: u128 (16 bytes)
  const yesSupply = leBytesToBigint(bytes.slice(offset, offset + 16));
  offset += 16;

  // noSupply: u128 (16 bytes)
  const noSupply = leBytesToBigint(bytes.slice(offset, offset + 16));
  offset += 16;

  // totalBets: u64 (8 bytes)
  const totalBets = leBytesToBigint(bytes.slice(offset, offset + 8));
  offset += 8;

  // resolved: bool (1 byte)
  const resolved = bytes[offset++] === 0x01;

  // outcome: bool (1 byte)
  const outcome = bytes[offset++] === 0x01;

  // deadline: u64 (8 bytes)
  const deadline = leBytesToBigint(bytes.slice(offset, offset + 8));
  offset += 8;

  // yesTokenTypeHash: 32 bytes → hex string
  const yesTokenTypeHash = bytesToHex(bytes.slice(offset, offset + 32));
  offset += 32;

  // noTokenTypeHash: 32 bytes → hex string
  const noTokenTypeHash = bytesToHex(bytes.slice(offset, offset + 32));

  return {
    yesSupply,
    noSupply,
    totalBets,
    resolved,
    outcome,
    deadline,
    yesTokenTypeHash,
    noTokenTypeHash,
  };
}

/**
 * Encode PositionData into bytes (58 bytes total)
 *
 * This converts our TypeScript PositionData object into raw bytes.
 *
 * @param data - The position data to encode
 * @returns Hex string of encoded bytes
 */
export function encodePositionData(data: PositionData): string {
  const buffer = new Uint8Array(57); // Updated: 32+1+16+8 = 57 bytes
  let offset = 0;

  // marketId: 32 bytes (hex string → bytes)
  const marketIdBytes = hexToBytes(data.marketId);
  if (marketIdBytes.length !== 32) {
    throw new Error(`Invalid marketId length: expected 32 bytes, got ${marketIdBytes.length}`);
  }
  buffer.set(marketIdBytes, offset);
  offset += 32;

  // side: bool (1 byte)
  buffer[offset++] = data.side ? 0x01 : 0x00;

  // amount: u128 (16 bytes)
  buffer.set(bigintToLeBytes(data.amount, 16), offset);
  offset += 16;

  // timestamp: u64 (8 bytes)
  buffer.set(bigintToLeBytes(data.timestamp, 8), offset);

  return bytesToHex(buffer);
}

/**
 * Decode bytes into PositionData
 *
 * This converts raw bytes from a position cell back into our TypeScript object.
 *
 * @param hex - Hex string of encoded position data
 * @returns Decoded PositionData object
 */
export function decodePositionData(hex: string): PositionData {
  const bytes = hexToBytes(hex);

  if (bytes.length < 57) {
    throw new Error(`Invalid position data length: expected 57 bytes, got ${bytes.length}`);
  }

  let offset = 0;

  // marketId: 32 bytes → hex string
  const marketId = bytesToHex(bytes.slice(offset, offset + 32));
  offset += 32;

  // side: bool (1 byte)
  const side = bytes[offset++] === 0x01;

  // amount: u128 (16 bytes)
  const amount = leBytesToBigint(bytes.slice(offset, offset + 16));
  offset += 16;

  // timestamp: u64 (8 bytes)
  const timestamp = leBytesToBigint(bytes.slice(offset, offset + 8));

  return {
    marketId,
    side,
    amount,
    timestamp,
  };
}
