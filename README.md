<div align="center">

![Switchboard Logo](https://github.com/switchboard-xyz/core-sdk/raw/main/website/static/img/icons/switchboard/avatar.png)

# Switchboard On-Demand: Lottery Example
This example demonstrates how to build a decentralized lottery using Switchboard's On-Demand Randomness functionality.

</div>

## Getting Started

Welcome to the Switchboard Lottery example. This project showcases how to build a secure and fair lottery system using Switchboard's on-demand randomness solution on Solana.

To read more about the security guarantees that Switchboard Randomness On-Demand provides, please see: [https://docs.switchboard.xyz/docs/switchboard/switchboard-randomness](https://docs.switchboard.xyz/docs/switchboard/switchboard-randomness)

#### PLEASE ENSURE YOU USE ANCHOR VERSION 0.30.0

Configure the `anchor.toml` file to point to your solana wallet and the Solana cluster of your choice - Devnet, Mainnet, etc.

Then, build the program:

```bash
anchor build
```

After building, take note of your program address and insert it in your program `lib.rs` file:
*Note:* You can view your program address with `anchor keys list`
```rust
declare_id!("[YOUR_PROGRAM_ADDRESS]");
```

Rebuild your program and deploy:
```bash
anchor build
anchor deploy
anchor idl init --filepath target/idl/lottery.json YOUR_PROGRAM_ADDRESS
```
Note: You may need to use `anchor idl upgrade --filepath target/idl/lottery.json YOUR_PROGRAM_ADDRESS` if you are upgrading the program.

Install dependencies:
```bash
pnpm i 
pnpm update
```

## About the Lottery

This example implements a decentralized lottery with the following features:

- Multiple concurrent lotteries identified by unique IDs
- Configurable entry fees and end times
- Fair winner selection using Switchboard's verifiable randomness
- 90% prize pool distribution to winner, 10% to developer
- Automatic prize claiming system

## Test Setup & Execution

### Prerequisites
1. Install Solana Tool Suite (1.17.0 or later)
2. Install Anchor (0.30.0):
   ```bash
   cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
   avm install 0.30.0
   avm use 0.30.0
   ```
3. Install Node.js and pnpm
4. Configure Solana CLI for devnet:
   ```bash
   solana config set --url devnet
   ```
5. Create a test wallet and fund it:
   ```bash
   solana-keygen new -o test-wallet.json
   solana airdrop 2 test-wallet.json --url devnet
   ```

### Setup Steps
1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd lottery
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build the program:
   ```bash
   anchor clean  # Clean any existing build artifacts
   anchor build
   ```

4. Get your program ID:
   ```bash
   anchor keys list
   ```

5. Update program ID in two places:
   - In `programs/lottery/src/lib.rs`:
     ```rust
     declare_id!("YOUR_PROGRAM_ID");
     ```
   - In `Anchor.toml`:
     ```toml
     [programs.devnet]
     lottery = "YOUR_PROGRAM_ID"
     ```

6. Build and deploy:
   ```bash
   anchor build
   anchor deploy
   ```

7. Initialize IDL:
   ```bash
   anchor idl init --filepath target/idl/lottery.json YOUR_PROGRAM_ID
   ```

### Running Tests
1. Ensure you have sufficient SOL for testing:
   ```bash
   solana balance  # Should show at least 1 SOL
   ```

2. Run the test suite:
   ```bash
   anchor test
   ```

### Troubleshooting Common Test Issues
- If tests fail with account errors:
  ```bash
  anchor clean
  anchor build
  anchor deploy
  ```

- If you see program ID mismatches:
  1. Get the correct program ID:
     ```bash
     anchor keys list
     ```
  2. Update both locations mentioned in Setup Step 5
  3. Rebuild and redeploy

- If you get IDL errors:
  ```bash
  anchor idl upgrade --filepath target/idl/lottery.json YOUR_PROGRAM_ID
  ```

Note: Always ensure you're on devnet and have sufficient SOL before running tests.

## Debugging

### Common Issues

1. **Account Size Errors / Program Changes**
   When making significant changes to the program's state or instruction parameters, you may need to:
   ```bash
   anchor clean
   solana-keygen new -o target/deploy/lottery-keypair.json
   # Update program ID in lib.rs and Anchor.toml
   anchor build
   anchor deploy
   ```

   This is necessary when:
   - Adding/removing fields in account structs
   - Changing account sizes
   - Modifying instruction parameters
   - Getting program/account size mismatch errors
   - Encountering IDL inconsistencies

2. **Program ID Mismatches**
   If you see errors related to program IDs:
   ```bash
   anchor keys list  # View your program address
   # Update declare_id!() in lib.rs
   # Update Anchor.toml
   anchor build
   anchor deploy
   ```

3. **IDL Updates**
   After making program changes:
   ```bash
   anchor idl init --filepath target/idl/lottery.json YOUR_PROGRAM_ADDRESS
   # Or if upgrading:
   anchor idl upgrade --filepath target/idl/lottery.json YOUR_PROGRAM_ADDRESS
   ```

### Build System Cleaning

**`anchor clean` vs `cargo clean`**:
- `anchor clean`: Cleans Anchor-specific build artifacts including:
  - Program keypairs
  - IDL files
  - Program deployment info
  - TypeScript bindings
  - All Cargo build artifacts

- `cargo clean`: Only cleans Rust/Cargo build artifacts:
  - Compiled program files
  - Dependencies
  - Does not touch Anchor-specific files

Use `anchor clean` when you need a complete reset of your program's build state, especially after structural changes. Use `cargo clean` when you only need to rebuild the Rust code.
