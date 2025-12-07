/**
 * TypeScript types for the Prediction Market MVP
 *
 * These types define the structure of data stored in cells:
 * - MarketData: Stored in the Market Cell
 * - PositionData: Stored in each Position Cell (user bets)
 */

/**
 * Market Cell Data Structure (CSMM + xUDT Design)
 *
 * This represents the entire prediction market state.
 * The market cell acts as an ESCROW holding all CKB bets in its capacity.
 * Users receive YES/NO xUDT tokens when they bet, minted based on CSMM pricing.
 */
export interface MarketData {
  /** Total YES tokens in circulation (u128) */
  yesSupply: bigint;

  /** Total NO tokens in circulation (u128) */
  noSupply: bigint;

  /** Total number of bets placed (for tracking) */
  totalBets: bigint;

  /** Whether the market has been resolved (outcome declared) */
  resolved: boolean;

  /** The final outcome: true = YES wins, false = NO wins */
  outcome: boolean;

  /** Unix timestamp (seconds) when betting closes */
  deadline: bigint;

  /** YES token xUDT type script hash (32 bytes) */
  yesTokenTypeHash: string;

  /** NO token xUDT type script hash (32 bytes) */
  noTokenTypeHash: string;
}

/**
 * Position Cell Data Structure (DEPRECATED in xUDT design)
 *
 * Note: With the CSMM + xUDT design, we no longer use position cells.
 * Instead, users hold YES/NO xUDT tokens in standard xUDT cells.
 * This interface is kept for reference but will not be used in the new implementation.
 */
export interface PositionData {
  marketId: string;
  side: boolean;
  amount: bigint;
  timestamp: bigint;
}

/**
 * Market Configuration
 *
 * Used when creating a new market.
 * This is NOT stored on-chain, but used to initialize the market cell.
 */
export interface MarketConfig {
  /** Description of the event being predicted */
  question: string;

  /** Unix timestamp (seconds) when betting closes */
  deadline: bigint;

  /** Initial CKB to lock in market cell (in shannons) */
  initialCapacity: bigint;
}

/**
 * Constants for the prediction market (CSMM + xUDT Design with Virtual Liquidity)
 */
export const CONSTANTS = {
  /** Minimum bet amount in CKB */
  MIN_BET_CKB: 100n,

  /** Minimum capacity for a basic cell (61 CKB in shannons) */
  MIN_CELL_CAPACITY: 61_00000000n, // 61 CKB

  /** Minimum market cell capacity that must remain after payouts (structure + data + buffer) */
  MIN_MARKET_CAPACITY: 280_00000000n, // 280 CKB

  /** xUDT cell capacity (for holding YES/NO tokens) */
  XUDT_CELL_CAPACITY: 143_00000000n, // 143 CKB (xUDT cell with type script overhead)

  /**
   * Virtual liquidity for CSMM pricing (tokens, 8 decimals)
   * This is added to both YES and NO supplies in price calculations
   * to provide smooth pricing from the start, without actually minting tokens.
   * Only affects pricing, NOT payouts.
   */
  VIRTUAL_LIQUIDITY: 1000_00000000n, // 1000 tokens

  /** 1 CKB = 10^8 shannons */
  CKB_SHANNON_RATIO: 100000000n,

  /** Token decimals (matching CKB's 8 decimals) */
  TOKEN_DECIMALS: 8n,
} as const;

/**
 * Helper type for transaction results
 */
export interface TransactionResult {
  /** Transaction hash */
  txHash: string;

  /** Output index of the created cell (if applicable) */
  outputIndex?: number;
}
