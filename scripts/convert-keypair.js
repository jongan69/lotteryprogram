const fs = require('fs');
const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

function keypairToBase58(filePath) {
  // Read the keypair.json file
  const keypairJson = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Convert the JSON array to Uint8Array
  const secretKey = new Uint8Array(keypairJson);

  // Create a Keypair object
  const keypair = Keypair.fromSecretKey(secretKey);

  // Convert the secret key to Base58
  return bs58.encode(keypair.secretKey);
}

// Main function for CLI
function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error('Usage: node convert-keypair.js <path-to-keypair.json>');
    process.exit(1);
  }

  const filePath = args[0];
  try {
    const base58String = keypairToBase58(filePath);
    console.log('Base58 Encoded Keypair:', base58String);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
