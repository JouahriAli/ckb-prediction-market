# CKB Cell Structure Reference

This document defines cell structures for communicating architecture decisions.

---

## Base Cell Structure

Every CKB cell has this structure:

```json
{
  "capacity": "u64 (CKB amount in shannons, 1 CKB = 100_000_000 shannons)",
  "lock": {
    "code_hash": "0x... (32 bytes)",
    "hash_type": "type | data | data1 | data2",
    "args": "0x... (variable length)"
  },
  "type": {
    "code_hash": "0x... (32 bytes)",
    "hash_type": "type | data | data1 | data2",
    "args": "0x... (variable length)"
  },
  "data": "0x... (variable length)"
}
```

**Notes:**
- `capacity` must cover: 8 (capacity) + lock size + type size + data size + overhead
- `lock` is required (controls who can spend)
- `type` is optional (defines cell semantics)
- `data` is optional (arbitrary bytes)

---

## Prediction Market Cells

### Market Cell

```json
{
  "capacity": "variable (200 CKB base + collateral)",
  "lock": {
    "code_hash": "ALWAYS_SUCCESS_CODE_HASH",
    "hash_type": "type",
    "args": "0x"
  },
  "type": {
    "code_hash": "MARKET_CODE_HASH",
    "hash_type": "data1",
    "args": "TYPE_ID (32 bytes, unique identifier)"
  },
  "data": {
    "_format": "35 bytes total",
    "token_code_hash": "32 bytes - hash of token contract binary",
    "hash_type": "1 byte - token contract hash type (2 = data1)",
    "resolved": "1 byte - 0 = active, 1 = resolved",
    "outcome": "1 byte - 0 = NO wins, 1 = YES wins"
  }
}
```

### Token Cell (Standard Holding)

```json
{
  "capacity": "~150 CKB (covers cell overhead)",
  "lock": {
    "code_hash": "USER_LOCK_CODE_HASH",
    "hash_type": "type",
    "args": "user's lock args"
  },
  "type": {
    "code_hash": "TOKEN_CODE_HASH",
    "hash_type": "data1",
    "args": {
      "_format": "33 bytes total",
      "market_type_hash": "32 bytes - hash of market's type script",
      "token_id": "1 byte - 0x01 = YES, 0x02 = NO"
    }
  },
  "data": {
    "_format": "16 bytes (xUDT compatible)",
    "amount": "u128 little-endian - token amount"
  }
}
```

### Token Cell (Limit Order)

```json
{
  "capacity": "~150 CKB",
  "lock": {
    "code_hash": "USER_LOCK_CODE_HASH",
    "hash_type": "type",
    "args": "user's lock args (seller)"
  },
  "type": {
    "code_hash": "TOKEN_CODE_HASH",
    "hash_type": "data1",
    "args": {
      "market_type_hash": "32 bytes",
      "token_id": "1 byte"
    }
  },
  "data": {
    "_format": "32 bytes (extended format)",
    "amount": "u128 little-endian - token amount",
    "limit_price": "u128 little-endian - CKB per token (0 = not for sale)"
  }
}
```

---

## Common Lock Scripts

### Always Success (Permissionless)
```json
{
  "code_hash": "0x...",
  "hash_type": "type",
  "args": "0x"
}
```
Anyone can spend. Used for market cells (type script enforces rules).

### JoyID (Passkey)
```json
{
  "code_hash": "JOYID_CODE_HASH",
  "hash_type": "type",
  "args": "user's JoyID pubkey hash"
}
```
Requires biometric authentication to spend.

### Secp256k1 (Standard)
```json
{
  "code_hash": "SECP256K1_CODE_HASH",
  "hash_type": "type",
  "args": "20 bytes - blake160(pubkey)"
}
```
Requires private key signature to spend.

---

## Template: Define Your Cell

Use this template when proposing new cell structures:

```json
{
  "_name": "Cell Name",
  "_purpose": "What this cell represents",

  "capacity": "amount or formula",
  "lock": {
    "code_hash": "which lock script",
    "hash_type": "type | data1",
    "args": "describe args"
  },
  "type": {
    "code_hash": "which type script (or null)",
    "hash_type": "type | data1",
    "args": {
      "_format": "total bytes",
      "field1": "description",
      "field2": "description"
    }
  },
  "data": {
    "_format": "total bytes",
    "field1": "type - description",
    "field2": "type - description"
  }
}
```

---

## Size Calculation

Minimum cell capacity = 8 + lock_size + type_size + data_size + 4 bytes

```
lock_size = 32 (code_hash) + 1 (hash_type) + args.length
type_size = 32 (code_hash) + 1 (hash_type) + args.length  (or 0 if null)
data_size = data.length
```

**Common sizes:**
- Empty cell (no type, no data): ~61 CKB
- Token cell (33-byte args, 16-byte data): ~142 CKB
- Market cell (32-byte args, 35-byte data): ~144 CKB

---

## Usage Example

When proposing a new feature, describe cells like:

> "I want to add an Oracle cell that stores the resolution authority:"
>
> ```json
> {
>   "_name": "Oracle Authority Cell",
>   "capacity": "~100 CKB",
>   "lock": { "code_hash": "MULTISIG", "args": "3-of-5 pubkeys" },
>   "type": { "code_hash": "ORACLE_CODE_HASH", "args": "market_type_hash" },
>   "data": { "authority_pubkey": "32 bytes" }
> }
> ```

This makes it clear what cells exist and how they relate.
## Limit buy order "intent" cell structure
{
  "capacity": Desired buy amount in ckb + capacity overhead,
  "lock": {
    "code_hash": AlwaysSuccess,
    "hash_type": usual (data or whatever variant we're using),
    "args": "0x... (variable length)"
  },
  "type": {
    "code_hash": "0x... (32 bytes)",
    "hash_type": "type | data | data1 | data2",
    "args": "0x... (variable length)"
  },
  "data": "0x... (variable length)"
}