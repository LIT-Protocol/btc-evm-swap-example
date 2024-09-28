import * as ecc from "@bitcoin-js/tiny-secp256k1-asmjs";
import * as bitcoin from "bitcoinjs-lib";
import pkg from "elliptic";
const { ec: EC } = pkg;
import { ethers } from "ethers";
import { ECPairFactory } from "ecpair";
const ECPair = ECPairFactory(ecc);
const ec = new EC("secp256k1");
bitcoin.initEccLib(ecc);

let privateKey =
    "d653763be1854048e1a70dd9fc94d47c09c790fb1530a01ee65257b0b698c352";

// sendTxAllUTXO()
sendTxSelectedUTXO();

// Function to generate P2PKH address for testnet
function generateBtcAddressP2PKH(publicKey) {
    if (publicKey.startsWith("0x")) {
        publicKey = publicKey.slice(2);
    }
    const pubKeyBuffer = Buffer.from(publicKey, "hex");

    const payment = bitcoin.payments.p2pkh({
        pubkey: pubKeyBuffer,
        network: bitcoin.networks.testnet,
    });
    return payment.address;
}

// Function to compute public key from private key using ethers.js
function computePublicKey(privateKey) {
    if (!privateKey.startsWith("0x")) {
        privateKey = "0x" + privateKey;
    }
    return ethers.utils.computePublicKey(privateKey);
}

// Sending transaction with P2PKH UTXO
export async function sendTxSelectedUTXO() {
    console.log("starting...");

    const publicKeySender = computePublicKey(privateKey);
    const senderAddress = generateBtcAddressP2PKH(publicKeySender);
    const recipientAddress = "mmnxChcUSLdPGuvSmkpUr7ngrNjfTYKcRq"
    // const senderAddress = generateBtcAddressP2PKH(pkp.publicKey);
    // const recipientAddress = "mmnxChcUSLdPGuvSmkpUr7ngrNjfTYKcRq";
    // const Btc_Endpoint = "https://mempool.space";
    const Btc_Endpoint = "https://blockstream.info";
    const amount = BigInt(600);
    const fee = BigInt(300);
    const network = bitcoin.networks.testnet;
    
    const endpoint = `${Btc_Endpoint}/testnet/api/address/${senderAddress}/utxo`;
    const result = await fetch(endpoint);
    const utxos = await result.json();
    const selectedUtxo = utxos[0];

    const rawTxEndpoint = `${Btc_Endpoint}/testnet/api/tx/${selectedUtxo.txid}/hex`;
    const rawTxResult = await fetch(rawTxEndpoint);
    const rawTxHex = await rawTxResult.text();
    
    console.log("utxos", utxos);
    console.log("selectedUtxo", selectedUtxo);
    console.log("pkp btc address", senderAddress);
    console.log("recipient btc address", recipientAddress);
    console.log("rawTxHex", rawTxHex);

    if (BigInt(selectedUtxo.value) - amount - fee < 0) {
        throw new Error("Insufficient funds");
    }

    const changeAmount = BigInt(selectedUtxo.value) - amount - fee;

    if (changeAmount - fee < 0) {
        throw new Error("Insufficient change funds");
    }

    const psbt = new bitcoin.Psbt({ network });
    // Adding input with nonWitnessUtxo (legacy transaction input)
    psbt.addInput({
        hash: selectedUtxo.txid,
        index: selectedUtxo.vout,
        nonWitnessUtxo: Buffer.from(rawTxHex, 'hex'), // Raw transaction is needed for nonWitnessUtxo
    });

    // Adding output
    psbt.addOutput({
        address: recipientAddress,
        value: amount,
    });

    psbt.addOutput({
        address: senderAddress,  // Sending the change back to the sender
        value: changeAmount,  // The remaining amount after subtracting the amount and fee
    });
    

    const txHex = psbt.data.globalMap.unsignedTx.tx.toHex();
    console.log("unsigned tx", txHex);

    // Signing the input
    const keyPair = ECPair.fromPrivateKey(Buffer.from(privateKey, "hex"), {
        network,
    });

    psbt.signAllInputs(keyPair);

    console.log("PSBT before finalization:", psbt.toBase64());
    psbt.finalizeAllInputs();

    const signedTxHex = psbt.extractTransaction().toHex();
    console.log("Signed Transaction Hex:", signedTxHex);

    // Broadcasting the transaction (uncomment below lines if needed)
    // const broadcastResponse = await fetch(`${Btc_Endpoint}/testnet/api/tx`, {
    //     method: "POST",
    //     headers: {
    //         "Content-Type": "text/plain",
    //     },
    //     body: signedTxHex,
    // });
    // console.log("Broadcast Response", broadcastResponse);
}