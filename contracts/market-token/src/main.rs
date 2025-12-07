//! Market Token Type Script
//!
//! Custom UDT type script for prediction market YES/NO tokens.
//! Validates that tokens are only minted/burned according to market rules.

#![no_std]
#![cfg_attr(not(test), no_main)]

use ckb_std::{
    ckb_constants::Source,
    ckb_types::prelude::*,
    debug,
    high_level::{
        load_cell_data, load_cell_type_hash, load_script, QueryIter,
    },
};
use alloc::vec::Vec;

/// Error codes
#[repr(i8)]
enum Error {
    IndexOutOfBound = 1,
    ItemMissing,
    LengthNotEnough,
    Encoding,
    // Token validation errors
    InvalidTokenId = 10,
    MarketCellNotFound = 11,
    SupplyMismatch = 12,
    UnequalMinting = 13,
    UnequalBurning = 14,
    BurningLosingTokens = 15,
    InvalidMarketState = 16,
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

/// Market data structure (simplified for token type script)
/// This matches the full MarketData from the market type script
struct MarketData {
    yes_supply: u128,
    no_supply: u128,
    resolved: bool,
    outcome: bool, // true = YES wins, false = NO wins
}

impl MarketData {
    /// Parse market data from cell data
    /// Format (simplified):
    /// - bytes 0-15: yes_supply (u128 LE)
    /// - bytes 16-31: no_supply (u128 LE)
    /// - byte 32: resolved (0 or 1)
    /// - byte 33: outcome (0 or 1)
    /// ... (other fields we don't need)
    fn from_bytes(data: &[u8]) -> Result<Self, Error> {
        if data.len() < 34 {
            return Err(Error::LengthNotEnough);
        }

        let yes_supply = u128::from_le_bytes(
            data[0..16].try_into().map_err(|_| Error::Encoding)?
        );
        let no_supply = u128::from_le_bytes(
            data[16..32].try_into().map_err(|_| Error::Encoding)?
        );
        let resolved = data[32] != 0;
        let outcome = data[33] != 0;

        Ok(MarketData {
            yes_supply,
            no_supply,
            resolved,
            outcome,
        })
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
                // Load cell data and parse token amount (first 16 bytes)
                let data = load_cell_data(i, source)?;
                if data.len() < 16 {
                    return Err(Error::LengthNotEnough);
                }

                let amount = u128::from_le_bytes(
                    data[0..16].try_into().map_err(|_| Error::Encoding)?
                );
                total = total.checked_add(amount).ok_or(Error::Encoding)?;
            }
        }
    }

    Ok(total)
}

/// Find market cell by type hash
fn find_market_cell(market_type_hash: &[u8; 32], source: Source) -> Result<(usize, Vec<u8>), Error> {
    debug!("Looking for market type hash: {:?}", market_type_hash);

    for (i, cell_type_hash) in QueryIter::new(load_cell_type_hash, source).enumerate() {
        if let Some(type_hash) = cell_type_hash {
            debug!("Found cell {} with type hash: {:?}", i, type_hash.as_slice());
            if type_hash.as_slice() == market_type_hash {
                let data = load_cell_data(i, source)?;
                return Ok((i, data));
            }
        } else {
            debug!("Cell {} has no type script", i);
        }
    }
    Err(Error::MarketCellNotFound)
}

/// Validate minting operation
fn validate_minting(
    args: &TypeScriptArgs,
    input_amount: u128,
    output_amount: u128,
) -> Result<(), Error> {
    let minted = output_amount
        .checked_sub(input_amount)
        .ok_or(Error::Encoding)?;

    debug!("Minting {} tokens (type: {:?})", minted, args.token_id);

    // Find market cell in inputs and outputs
    let (_, market_input_data) = find_market_cell(&args.market_type_hash, Source::Input)?;
    let (_, market_output_data) = find_market_cell(&args.market_type_hash, Source::Output)?;

    let data_in = MarketData::from_bytes(&market_input_data)?;
    let data_out = MarketData::from_bytes(&market_output_data)?;

    // Check supply increase matches minted amount
    match args.token_id {
        TokenType::Yes => {
            let yes_increase = data_out
                .yes_supply
                .checked_sub(data_in.yes_supply)
                .ok_or(Error::SupplyMismatch)?;

            if yes_increase != minted {
                debug!("YES supply mismatch: market says {}, tokens say {}", yes_increase, minted);
                return Err(Error::SupplyMismatch);
            }

            // Verify equal NO tokens also minted
            let no_increase = data_out
                .no_supply
                .checked_sub(data_in.no_supply)
                .ok_or(Error::SupplyMismatch)?;

            if yes_increase != no_increase {
                debug!("Unequal minting: YES {}, NO {}", yes_increase, no_increase);
                return Err(Error::UnequalMinting);
            }
        }
        TokenType::No => {
            let no_increase = data_out
                .no_supply
                .checked_sub(data_in.no_supply)
                .ok_or(Error::SupplyMismatch)?;

            if no_increase != minted {
                debug!("NO supply mismatch: market says {}, tokens say {}", no_increase, minted);
                return Err(Error::SupplyMismatch);
            }

            // Verify equal YES tokens also minted
            let yes_increase = data_out
                .yes_supply
                .checked_sub(data_in.yes_supply)
                .ok_or(Error::SupplyMismatch)?;

            if no_increase != yes_increase {
                debug!("Unequal minting: NO {}, YES {}", no_increase, yes_increase);
                return Err(Error::UnequalMinting);
            }
        }
    }

    debug!("Minting validation passed");
    Ok(())
}

/// Validate burning operation
fn validate_burning(
    args: &TypeScriptArgs,
    input_amount: u128,
    output_amount: u128,
) -> Result<(), Error> {
    let burned = input_amount
        .checked_sub(output_amount)
        .ok_or(Error::Encoding)?;

    debug!("Burning {} tokens (type: {:?})", burned, args.token_id);

    // Find market cell in inputs and outputs
    let (_, market_input_data) = find_market_cell(&args.market_type_hash, Source::Input)?;
    let (_, market_output_data) = find_market_cell(&args.market_type_hash, Source::Output)?;

    let data_in = MarketData::from_bytes(&market_input_data)?;
    let data_out = MarketData::from_bytes(&market_output_data)?;

    if !data_in.resolved {
        // BURNING COMPLETE SET (before resolution)
        debug!("Burning complete set (market not resolved)");

        match args.token_id {
            TokenType::Yes => {
                let yes_decrease = data_in
                    .yes_supply
                    .checked_sub(data_out.yes_supply)
                    .ok_or(Error::SupplyMismatch)?;

                if yes_decrease != burned {
                    debug!("YES supply mismatch: market says {}, tokens say {}", yes_decrease, burned);
                    return Err(Error::SupplyMismatch);
                }

                // Must burn equal NO tokens
                let no_decrease = data_in
                    .no_supply
                    .checked_sub(data_out.no_supply)
                    .ok_or(Error::SupplyMismatch)?;

                if yes_decrease != no_decrease {
                    debug!("Unequal burning: YES {}, NO {}", yes_decrease, no_decrease);
                    return Err(Error::UnequalBurning);
                }
            }
            TokenType::No => {
                let no_decrease = data_in
                    .no_supply
                    .checked_sub(data_out.no_supply)
                    .ok_or(Error::SupplyMismatch)?;

                if no_decrease != burned {
                    debug!("NO supply mismatch: market says {}, tokens say {}", no_decrease, burned);
                    return Err(Error::SupplyMismatch);
                }

                // Must burn equal YES tokens
                let yes_decrease = data_in
                    .yes_supply
                    .checked_sub(data_out.yes_supply)
                    .ok_or(Error::SupplyMismatch)?;

                if no_decrease != yes_decrease {
                    debug!("Unequal burning: NO {}, YES {}", no_decrease, yes_decrease);
                    return Err(Error::UnequalBurning);
                }
            }
        }
    } else {
        // CLAIMING PAYOUT (after resolution)
        debug!("Claiming payout (market resolved, outcome: {})", if data_in.outcome { "YES" } else { "NO" });

        // Verify burning winning tokens only
        let winning_side = if data_in.outcome {
            TokenType::Yes
        } else {
            TokenType::No
        };

        if args.token_id != winning_side {
            debug!("Trying to burn losing tokens");
            return Err(Error::BurningLosingTokens);
        }

        match args.token_id {
            TokenType::Yes => {
                let yes_decrease = data_in
                    .yes_supply
                    .checked_sub(data_out.yes_supply)
                    .ok_or(Error::SupplyMismatch)?;

                if yes_decrease != burned {
                    debug!("YES supply mismatch: market says {}, tokens say {}", yes_decrease, burned);
                    return Err(Error::SupplyMismatch);
                }

                // NO supply must not change
                if data_in.no_supply != data_out.no_supply {
                    debug!("NO supply changed during YES claim");
                    return Err(Error::InvalidMarketState);
                }
            }
            TokenType::No => {
                let no_decrease = data_in
                    .no_supply
                    .checked_sub(data_out.no_supply)
                    .ok_or(Error::SupplyMismatch)?;

                if no_decrease != burned {
                    debug!("NO supply mismatch: market says {}, tokens say {}", no_decrease, burned);
                    return Err(Error::SupplyMismatch);
                }

                // YES supply must not change
                if data_in.yes_supply != data_out.yes_supply {
                    debug!("YES supply changed during NO claim");
                    return Err(Error::InvalidMarketState);
                }
            }
        }
    }

    debug!("Burning validation passed");
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

    // Determine operation type and validate
    if output_amount > input_amount {
        // MINTING
        debug!("Detected minting operation");
        validate_minting(&args, input_amount, output_amount)?;
    } else if input_amount > output_amount {
        // BURNING
        debug!("Detected burning operation");
        validate_burning(&args, input_amount, output_amount)?;
    } else {
        // TRANSFER - no supply change, just verify amounts match
        debug!("Transfer operation - amounts match");
    }

    Ok(())
}

#[cfg(not(test))]
ckb_std::entry!(program_entry);

#[cfg(not(test))]
ckb_std::default_alloc!();
