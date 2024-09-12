const bitcoin = require('bitcoinjs-lib');
const axios = require('axios');

// Define network (for mainnet or testnet)
const network = bitcoin.networks.testnet; // or bitcoin.networks.bitcoin for mainnet

// Replace with your own details
const privateKeyWIF = 'your_private_key_in_WIF_format';
const sourceAddress = 'your_source_address';
const destinationAddress = 'destination_address';
const amountToSend = 10000; // amount in satoshis (1 BTC = 100,000,000 satoshis)
const fee = 500; // transaction fee in satoshis

async function sendTransaction() {
  try {
    // Fetch UTXOs (Unspent Transaction Outputs) for your source address
    const utxoUrl = `https://blockstream.info/testnet/api/address/${sourceAddress}/utxo`; // Adjust for mainnet
    const utxos = (await axios.get(utxoUrl)).data;

    // Create a key pair from the private key
    const keyPair = bitcoin.ECPair.fromWIF(privateKeyWIF, network);

    // Create a new transaction builder
    const psbt = new bitcoin.Psbt({ network });

    // Add the inputs (UTXOs)
    let totalInput = 0;
    utxos.forEach((utxo) => {
      psbt.addInput({
        hash: utxo.txid, // Transaction hash (id of the tx where the UTXO originated)
        index: utxo.vout, // Index of the output in the previous transaction
        nonWitnessUtxo: Buffer.from(utxo.hex, 'hex'), // Full transaction data in hex
      });
      totalInput += utxo.value;
    });

    // Add the output (destination address and amount)
    psbt.addOutput({
      address: destinationAddress,
      value: amountToSend,
    });

    // Add change output (return remaining balance minus fee to yourself)
    const change = totalInput - amountToSend - fee;
    if (change > 0) {
      psbt.addOutput({
        address: sourceAddress, // Change back to your own address
        value: change,
      });
    }

    // Sign each input
    psbt.signAllInputs(keyPair);
    psbt.finalizeAllInputs();

    // Build the transaction
    const tx = psbt.extractTransaction();
    const txHex = tx.toHex();

    // Broadcast the transaction
    const broadcastUrl = 'https://blockstream.info/testnet/api/tx'; // Use a different API for mainnet
    const broadcastResponse = await axios.post(broadcastUrl, txHex);
    
    console.log('Transaction broadcasted, TXID:', broadcastResponse.data);
  } catch (error) {
    console.error('Error sending transaction:', error);
  }
}

sendTransaction();