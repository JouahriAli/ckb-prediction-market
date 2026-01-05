//! Market Token Type Script
//!
//! Custom UDT type script for prediction market YES/NO tokens.
//!
//! Validation logic:
//! 1. If market cell is in inputs: pass (market type script validates everything)
//! 2. If market cell is NOT in inputs:
//!    a. Token conservation: output_amount <= input_amount (no minting without market)
//!    b. Limit order validation (CUMULATIVE per seller):
//!       - Group all limit order inputs by seller_lock_hash
//!       - For each seller, sum required payments across ALL their orders
//!       - Validate: sum(CKB outputs to seller) == total_required_for_seller
//!       - This enables multi-order market buys in a single transaction!
//!
//! Limit order cell structure:
//! - Lock: AlwaysSuccess (permissionless spending)
//! - Lock args: Seller's payment lock hash (32 bytes) - where CKB payment goes
//! - Type: Token type script
//! - Data: [amount: u128][limit_price: u128] (32 bytes)
//!
//! Security notes:
//! - Limit orders use AlwaysSuccess lock (permissionless fills)
//! - Lock args stores seller's REAL lock hash (payment destination)
//! - CKB payment must go to seller's real lock (NOT to AlwaysSuccess!)
//! - Partial fill: remaining tokens must have SAME price (no price changes!)
//! - Price changes NOT allowed (including setting to 0 - would enable theft)
//! - Cancellation: Seller must pay themselves full amount to retrieve tokens
//! - Payment validation is CUMULATIVE per seller (supports multi-order fills)

#![no_std]
#![cfg_attr(not(test), no_main)]

use ckb_std::{
    ckb_constants::Source,
    ckb_types::prelude::*,
    debug,
    high_level::{
        load_cell_capacity, load_cell_data, load_cell_lock, load_cell_lock_hash,
        load_cell_type, load_cell_type_hash, load_script, QueryIter,
    },
};

/// Error codes
#[repr(i8)]
enum Error {
    IndexOutOfBound = 1,
    ItemMissing,
    LengthNotEnough,
    Encoding,
    // Token validation errors
    InvalidTokenId = 10,
    UnauthorizedMinting = 11,
    InvalidDataLength = 12,
    // Limit order validation errors
    LimitOrderPaymentMismatch = 20,
    LimitOrderInvalidAmount = 21,
}

impl From<ckb_std::error::SysError> for Error {
    fn from(err: ckb_std::error::SysError) -> Self {
        match err {
            ckb_std::error::SysError::IndexOutOfBound => Error::IndexOutOfBound,
            ckb_std::error::SysError::ItemMissing => Error::ItemMissing,
            ckb_std::error::SysError::LengthNotEnough(_) => Error::LengthNotEnough,
            ckb_std::error::SysError::Encoding => Error::Encoding,
            _ => Error::IndexOutOfBound,
        }
    }
}

/// Token type: YES or NO
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TokenType {
    Yes = 0x01,
    No = 0x02,
}

impl TokenType {
    fn from_u8(value: u8) -> Result<Self, Error> {
        match value {
            0x01 => Ok(TokenType::Yes),
            0x02 => Ok(TokenType::No),
            _ => Err(Error::InvalidTokenId),
        }
    }
}

/// Type script args structure
/// Format:
/// - bytes 0-31: market_type_hash (32 bytes)
/// - byte 32: token_id (1 byte: 0x01 = YES, 0x02 = NO)
struct TypeScriptArgs {
    market_type_hash: [u8; 32],
    token_id: TokenType,
}

impl TypeScriptArgs {
    fn from_bytes(data: &[u8]) -> Result<Self, Error> {
        if data.len() < 33 {
            return Err(Error::LengthNotEnough);
        }

        let mut market_type_hash = [0u8; 32];
        market_type_hash.copy_from_slice(&data[0..32]);

        let token_id = TokenType::from_u8(data[32])?;

        Ok(TypeScriptArgs {
            market_type_hash,
            token_id,
        })
    }
}

/// Parse token cell data
/// Returns: (amount, limit_price)
/// Supports both 16-byte (old) and 32-byte (new with limit_price) formats
fn parse_token_data(data: &[u8]) -> Result<(u128, u128), Error> {
    if data.len() == 16 {
        // Backward compatible: old format (just amount)
        let amount = u128::from_le_bytes(
            data[0..16].try_into().map_err(|_| Error::Encoding)?
        );
        Ok((amount, 0))
    } else if data.len() == 32 {
        // New format: amount + limit_price
        let amount = u128::from_le_bytes(
            data[0..16].try_into().map_err(|_| Error::Encoding)?
        );
        let limit_price = u128::from_le_bytes(
            data[16..32].try_into().map_err(|_| Error::Encoding)?
        );
        Ok((amount, limit_price))
    } else {
        Err(Error::InvalidDataLength)
    }
}

/// Sum token amounts from inputs or outputs
fn sum_token_amounts(source: Source) -> Result<u128, Error> {
    let mut total: u128 = 0;

    // Load current script to compare type scripts
    let current_script = load_script()?;
    let current_script_hash = current_script.calc_script_hash();

    // Iterate through all cells in the source
    for (i, cell_type_hash) in QueryIter::new(load_cell_type_hash, source).enumerate() {
        if let Some(type_hash) = cell_type_hash {
            // Check if this cell has the same type script
            if type_hash.as_slice() == current_script_hash.as_slice() {
                // Load cell data and parse token amount + limit_price
                let data = load_cell_data(i, source)?;
                let (amount, _limit_price) = parse_token_data(&data)?;

                total = total.checked_add(amount).ok_or(Error::Encoding)?;
            }
        }
    }

    Ok(total)
}

/// Check if market cell exists in inputs
fn market_cell_in_inputs(market_type_hash: &[u8; 32]) -> bool {
    for cell_type_hash in QueryIter::new(load_cell_type_hash, Source::Input) {
        if let Some(type_hash) = cell_type_hash {
            if type_hash.as_slice() == market_type_hash {
                return true;
            }
        }
    }
    false
}

/// Find matching output token cell for partial fill validation
/// Returns the amount in the matching output, or 0 if not found
///
/// SECURITY: For partial fills, the remaining tokens must:
/// 1. Have same type script (same token)
/// 2. Have AlwaysSuccess lock (same code_hash as input)
/// 3. Have same lock args (same seller - their payment destination)
/// 4. Have same price OR price = 0 (cancel)
fn find_matching_output_amount(input_index: usize, input_price: u128) -> Result<u128, Error> {
    let current_script = load_script()?;
    let current_script_hash = current_script.calc_script_hash();

    // Get input lock (to compare code_hash and args)
    let input_lock = load_cell_lock(input_index, Source::Input)?;
    let input_lock_code_hash = input_lock.code_hash();
    let input_lock_args = input_lock.args();

    // Search outputs for valid remaining order cell
    for (i, output_type_hash) in QueryIter::new(load_cell_type_hash, Source::Output).enumerate() {
        if let Some(type_hash) = output_type_hash {
            // Check if same type script (same token)
            if type_hash.as_slice() == current_script_hash.as_slice() {
                // Get output lock
                let output_lock = load_cell_lock(i, Source::Output)?;

                // SECURITY: Must be same lock code_hash (AlwaysSuccess)
                // This ensures remaining tokens stay on order book
                if output_lock.code_hash().as_slice() != input_lock_code_hash.as_slice() {
                    continue;
                }

                // SECURITY: Must be same lock args (same seller)
                // This ensures only the original seller can receive payment
                if output_lock.args().raw_data() != input_lock_args.raw_data() {
                    continue;
                }

                // Parse output data and check price
                let data = load_cell_data(i, Source::Output)?;
                let (amount, output_price) = parse_token_data(&data)?;

                // SECURITY: Only consider it a "remaining order" if same price
                // NO price changes allowed (including setting to 0)!
                // This prevents attackers from "cancelling" orders and stealing tokens
                if output_price == input_price {
                    return Ok(amount);
                }

                // Different price (including 0) = not a valid remainder
                // Treat as complete fill - must pay for ALL tokens
            }
        }
    }

    // No matching output found = complete fill
    Ok(0)
}

/// Calculate NET CKB payment to seller (outputs - inputs with seller's lock)
///
/// The seller's payment destination is stored in the limit order's lock.args
/// We calculate: sum(CKB outputs to seller) - sum(CKB inputs from seller)
/// Also returns whether buyer == seller (detected by CKB inputs from seller's lock)
fn calc_net_ckb_payment_to_seller(input_index: usize) -> Result<(u128, bool), Error> {
    // Get seller's payment lock hash from input lock args
    // Limit order structure: AlwaysSuccess lock with args = seller's lock hash (32 bytes)
    let input_lock = load_cell_lock(input_index, Source::Input)?;
    let seller_lock_hash = input_lock.args().raw_data();

    debug!("Seller's payment lock hash: {:?}", &seller_lock_hash[..seller_lock_hash.len().min(32)]);

    let mut output_total: u128 = 0;
    let mut input_total: u128 = 0;
    let mut buyer_is_seller = false;

    // Sum CKB outputs to seller (no type script)
    for (i, output_type) in QueryIter::new(load_cell_type, Source::Output).enumerate() {
        if output_type.is_none() {
            let output_lock_hash = load_cell_lock_hash(i, Source::Output)?;
            if output_lock_hash.as_slice() == seller_lock_hash {
                let capacity = load_cell_capacity(i, Source::Output)?;
                output_total = output_total.checked_add(capacity as u128).ok_or(Error::Encoding)?;
                debug!("Output {} to seller: {} CKB", i, capacity);
            }
        }
    }

    // Subtract CKB inputs from seller (no type script)
    // If any CKB input has seller's lock, buyer == seller
    for (i, input_type) in QueryIter::new(load_cell_type_hash, Source::Input).enumerate() {
        if input_type.is_none() {
            let input_lock_hash = load_cell_lock_hash(i, Source::Input)?;
            if input_lock_hash.as_slice() == seller_lock_hash {
                let capacity = load_cell_capacity(i, Source::Input)?;
                input_total = input_total.checked_add(capacity as u128).ok_or(Error::Encoding)?;
                buyer_is_seller = true;  // Buyer is using seller's CKB
                debug!("Input {} from seller: {} CKB (buyer == seller)", i, capacity);
            }
        }
    }

    debug!("Output total: {}, Input total: {}, buyer_is_seller: {}", output_total, input_total, buyer_is_seller);

    // Net payment = outputs - inputs (saturating to 0 if negative)
    let net_payment = output_total.saturating_sub(input_total);
    debug!("Net payment to seller: {}", net_payment);

    Ok((net_payment, buyer_is_seller))
}

/// Calculate required payment for a single limit order input
/// Returns: (sold_amount, required_payment)
fn calc_required_payment(input_index: usize, input_amount: u128, limit_price: u128) -> Result<u128, Error> {
    debug!("Calculating payment for input {}: amount={}, price={}", input_index, input_amount, limit_price);

    // Find matching output (same type, AlwaysSuccess lock, same args, same price)
    let output_amount = find_matching_output_amount(input_index, limit_price)?;

    debug!("Found matching output amount: {}", output_amount);

    // Calculate sold amount
    if output_amount > input_amount {
        debug!("Output amount > input amount - invalid!");
        return Err(Error::LimitOrderInvalidAmount);
    }

    let sold_amount = input_amount - output_amount;
    let required_payment = sold_amount.checked_mul(limit_price).ok_or(Error::Encoding)?;

    debug!("Sold: {}, Required payment: {} Shannon", sold_amount, required_payment);
    Ok(required_payment)
}

/// Check if seller at input_index was already processed (any earlier input has same seller)
fn seller_already_processed(input_index: usize, seller_lock_hash: &[u8], current_script_hash: &[u8]) -> Result<bool, Error> {
    for (j, cell_type_hash) in QueryIter::new(load_cell_type_hash, Source::Input).enumerate() {
        if j >= input_index {
            break; // Only check earlier inputs
        }

        if let Some(type_hash) = cell_type_hash {
            if type_hash.as_slice() == current_script_hash {
                let data = load_cell_data(j, Source::Input)?;
                let (_amount, limit_price) = parse_token_data(&data)?;

                if limit_price > 0 {
                    let lock = load_cell_lock(j, Source::Input)?;
                    let other_seller = lock.args().raw_data();
                    if other_seller.as_ref() == seller_lock_hash {
                        return Ok(true); // Same seller found earlier
                    }
                }
            }
        }
    }
    Ok(false)
}

/// Validate limit order payments with CUMULATIVE validation per seller
///
/// Groups all limit order inputs by seller_lock_hash and validates that
/// the total payment to each seller equals the sum of all their order requirements.
/// This enables multi-order market buys in a single transaction.
fn validate_limit_orders_cumulative(current_script_hash: &[u8; 32]) -> Result<(), Error> {
    debug!("Starting cumulative limit order validation");

    for (i, cell_type_hash) in QueryIter::new(load_cell_type_hash, Source::Input).enumerate() {
        if let Some(type_hash) = cell_type_hash {
            if type_hash.as_slice() == current_script_hash.as_slice() {
                let data = load_cell_data(i, Source::Input)?;
                let (amount, limit_price) = parse_token_data(&data)?;

                if limit_price > 0 {
                    // This is a limit order
                    let input_lock = load_cell_lock(i, Source::Input)?;
                    let seller_lock_hash = input_lock.args().raw_data();

                    // Check if we already processed this seller (from an earlier input)
                    if seller_already_processed(i, &seller_lock_hash, current_script_hash.as_slice())? {
                        debug!("Input {} seller already processed, skipping", i);
                        continue;
                    }

                    debug!("Processing seller group starting at input {}", i);

                    // First occurrence of this seller - sum ALL required payments from this seller
                    let mut total_required: u128 = 0;

                    // Sum required payment from this input
                    let req = calc_required_payment(i, amount, limit_price)?;
                    total_required = total_required.checked_add(req).ok_or(Error::Encoding)?;

                    // Sum required payment from any later inputs with same seller
                    for (j, cell_type_hash_j) in QueryIter::new(load_cell_type_hash, Source::Input).enumerate() {
                        if j <= i {
                            continue; // Skip current and earlier inputs
                        }

                        if let Some(type_hash_j) = cell_type_hash_j {
                            if type_hash_j.as_slice() == current_script_hash.as_slice() {
                                let data_j = load_cell_data(j, Source::Input)?;
                                let (amount_j, limit_price_j) = parse_token_data(&data_j)?;

                                if limit_price_j > 0 {
                                    let lock_j = load_cell_lock(j, Source::Input)?;
                                    let seller_j = lock_j.args().raw_data();

                                    if seller_j.as_ref() == seller_lock_hash.as_ref() {
                                        // Same seller - add to total
                                        let req_j = calc_required_payment(j, amount_j, limit_price_j)?;
                                        total_required = total_required.checked_add(req_j).ok_or(Error::Encoding)?;
                                        debug!("Added input {} to seller group, subtotal: {}", j, total_required);
                                    }
                                }
                            }
                        }
                    }

                    debug!("Total required for seller: {} Shannon", total_required);

                    // Calculate actual payment to this seller
                    let (actual_payment, buyer_is_seller) = calc_net_ckb_payment_to_seller(i)?;

                    debug!("Actual payment: {}, buyer_is_seller: {}", actual_payment, buyer_is_seller);

                    // Validate payment (skip if buyer == seller)
                    if !buyer_is_seller && actual_payment != total_required {
                        debug!("CUMULATIVE payment mismatch! Required: {}, Actual: {}", total_required, actual_payment);
                        return Err(Error::LimitOrderPaymentMismatch);
                    }

                    debug!("Seller group validated successfully!");
                }
            }
        }
    }

    debug!("All limit order validations passed!");
    Ok(())
}

/// Main entry point
pub fn program_entry() -> i8 {
    match main() {
        Ok(_) => 0,
        Err(err) => err as i8,
    }
}

fn main() -> Result<(), Error> {
    // Load current type script
    let script = load_script()?;

    // Parse type script args
    let args_raw = script.args().raw_data();

    debug!("Args length: {}", args_raw.len());
    debug!("Args (first 33 bytes): {:?}", &args_raw[..args_raw.len().min(33)]);

    let args = TypeScriptArgs::from_bytes(&args_raw)?;

    debug!("Token type script running for token: {:?}", args.token_id);
    debug!("Market type hash from args: {:?}", args.market_type_hash);

    // Sum token amounts from inputs and outputs
    let input_amount = sum_token_amounts(Source::Input)?;
    let output_amount = sum_token_amounts(Source::Output)?;

    debug!("Input amount: {}, Output amount: {}", input_amount, output_amount);

    // Check if market cell is in inputs
    if market_cell_in_inputs(&args.market_type_hash) {
        // Market cell present - market type script will validate everything
        debug!("Market cell found in inputs - delegating validation to market type script");
        return Ok(());
    }

    // No market cell - only allow transfers/burns (output <= input)
    if output_amount > input_amount {
        debug!("Minting without market cell is not allowed");
        return Err(Error::UnauthorizedMinting);
    }

    debug!("Token conservation check passed - output ({}) <= input ({})", output_amount, input_amount);

    // Validate limit order payments (CUMULATIVE per seller)
    // This groups all orders by seller and validates total payment per seller
    let current_script_hash = script.calc_script_hash();
    let hash_bytes: [u8; 32] = current_script_hash.as_slice().try_into().map_err(|_| Error::Encoding)?;
    validate_limit_orders_cumulative(&hash_bytes)?;

    debug!("All validations passed!");
    Ok(())
}

#[cfg(not(test))]
ckb_std::entry!(program_entry);

#[cfg(not(test))]
ckb_std::default_alloc!();
