//! Market Token Type Script
//!
//! Custom UDT type script for prediction market YES/NO tokens.
//!
//! Validation logic:
//! - If market cell is in inputs: pass (market type script validates everything)
//! - If market cell is NOT in inputs: output_amount <= input_amount (no minting without market)

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

    debug!("Transfer/burn without market cell - output ({}) <= input ({})", output_amount, input_amount);
    Ok(())
}

#[cfg(not(test))]
ckb_std::entry!(program_entry);

#[cfg(not(test))]
ckb_std::default_alloc!();
