import * as ecc from "@bitcoin-js/tiny-secp256k1-asmjs";
import * as bitcoin from "bitcoinjs-lib";
import pkg from "elliptic";
const { ec: EC } = pkg;
import { ethers } from "ethers";
import { ECPairFactory } from "ecpair";
const ECPair = ECPairFactory(ecc);

const ec = new EC("secp256k1");
bitcoin.initEccLib(ecc);

// This code uses PSBT class to sign using local private key and broadcast the segwit transaction

// let privateKey = process.env.NEXT_PUBLIC_PRIVATE_KEY
let privateKey0 =
    "d653763be1854048e1a70dd9fc94d47c09c790fb1530a01ee65257b0b698c352";
let privateKey1 =
    "e36a688fe085087299ea6225c6be269f05d1f2e63bfe00d41c1627a826c69789";
let privateKey3 = "a169b38267e4134dc2413ca0eb29cc27a6e80e6a412855a839cfb81e342da950"
let publicKeyRecipient =
    "0x040b670b840bdce35bd1d14e43757d443fefea38560a48f7bf768b94f1626cb9c3d211429983c6eeee626ea90db846bb76dbf378ccd3f7d0a6826ee25292aab40d";


// sendTxAllUTXO()

sendTxSelectedUTXO();

// https://bitcoinfaucet.uo1.net/send.php
// address generation segwit for testnet
function generateBtcAddressBech32(pubKeyHex) {
    if (pubKeyHex.startsWith("0x") || pubKeyHex.startsWith("0X")) {
        pubKeyHex = pubKeyHex.slice(2);
    }
    const keyPair = ec.keyFromPublic(pubKeyHex, "hex");
    const compressedPubKeyHex = keyPair.getPublic(true, "hex");
    const compressedPubKey = Buffer.from(compressedPubKeyHex, "hex");

    const { address } = bitcoin.payments.p2wpkh({
        pubkey: compressedPubKey,
        network: bitcoin.networks.testnet,
    });
    return address;
}

// https://coinfaucet.eu/en/btc-testnet/
// address generation p2pkh for testnet
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

function computePublicKey(privateKey) {
    if (!privateKey.startsWith("0x")) {
        privateKey = "0x" + privateKey;
    }
    return ethers.utils.computePublicKey(privateKey);
}

// sends last utxo's remain to the recipient address
export async function sendTxSelectedUTXO() {
    const publicKeySender = computePublicKey(privateKey0);
    console.log("publicKeySender", publicKeySender);
    const senderAddress = generateBtcAddressBech32(publicKeySender);
    const recipientAddress = "tb1qmz9zpxjzcqdym2ahyvlvjqkrtuzdh7q8m7xl74";
    const Btc_Endpoint = "https://mempool.space";
    // const Btc_Endpoint = "https://blockstream.info";
    // const fee = BigInt(400);
    const amount = BigInt(450);
    const network = bitcoin.networks.testnet;
    
    const endpoint = `${Btc_Endpoint}/testnet/api/address/${senderAddress}/utxo`;
    const result = await fetch(endpoint);
    const utxos = await result.json();
    const selectedUtxo = utxos[0];
    
    console.log("sender", senderAddress);
    console.log("utxos", utxos);

    if (BigInt(selectedUtxo.value) - amount < 0) {
        throw new Error("Insufficient funds");
    }

    const psbt = new bitcoin.Psbt({ network });

    const p2wpkh = bitcoin.payments.p2wpkh({
        address: senderAddress,
        network: network,
    });

    psbt.addInput({
        hash: selectedUtxo.txid,
        index: selectedUtxo.vout,
        witnessUtxo: {
            script: p2wpkh.output,
            value: BigInt(selectedUtxo.value),
        },
    });

    psbt.addOutput({
        address: recipientAddress,
        value: amount,
    });

    const txHex = psbt.data.globalMap.unsignedTx.tx.toHex();
    console.log("unsigned tx", txHex);

    const keyPair = ECPair.fromPrivateKey(Buffer.from(privateKey1, "hex"), {
        network,
    });

    psbt.signAllInputs(keyPair);
    // psbt.signInput(0, keyPair);
    // psbt.validateSignaturesOfInput(0);
    console.log("PSBT before finalization:", psbt.toBase64());
    psbt.finalizeAllInputs();

    const signedTxHex = psbt.extractTransaction().toHex();
    console.log("Signed Transaction Hex:", signedTxHex);

    // const broadcastResponse = await fetch(`${Btc_Endpoint}/testnet/api/tx`, {
    //     method: "POST",
    //     headers: {
    //         "Content-Type": "text/plain",
    //     },
    //     body: signedTxHex,
    // });

    // const txid = await broadcastResponse.text();
    // console.log("Transaction broadcast successfully. TXID:", txid);
    // return txid;
}

async function sendTxAllUTXO() {
    const publicKeySender = computePublicKey(privateKey);
    const senderAddress = generateBtcAddressBech32(publicKeySender);
    const recipientAddress = "tb1qmz9zpxjzcqdym2ahyvlvjqkrtuzdh7q8m7xl74";
    const amount = BigInt(100);
    // const Btc_Endpoint = "https://mempool.space";
    const Btc_Endpoint = "https://blockstream.info";
    const fee = BigInt(400);
    const network = bitcoin.networks.testnet;
    const psbt = new bitcoin.Psbt({ network });

    const endpoint = `${Btc_Endpoint}/testnet/api/address/${senderAddress}/utxo`;
    const result = await fetch(endpoint);
    const utxos = await result.json();

    const totalInput = BigInt(utxos.reduce((sum, utxo) => sum + utxo.value, 0));
    console.log("sender", senderAddress);
    console.log("utxos", utxos);
    console.log("total input", Number(totalInput));

    if (totalInput - amount - fee < 0) {
        throw new Error("Insufficient funds");
    }

    const p2wpkh = bitcoin.payments.p2wpkh({
        address: senderAddress,
        network: network,
    });

    utxos.forEach((utxo) => {
        psbt.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            witnessUtxo: {
                script: p2wpkh.output,
                value: BigInt(utxo.value),
            },
        });
    });

    psbt.addOutput({
        address: recipientAddress,
        value: amount,
    });

    const keyPair = ECPair.fromPrivateKey(Buffer.from(privateKey, "hex"), {
        network,
    });

    psbt.signAllInputs(keyPair);

    psbt.finalizeAllInputs();

    const signedTxHex = psbt.extractTransaction().toHex();
    console.log("Signed Transaction Hex:", signedTxHex);

    const broadcastResponse = await fetch(`${Btc_Endpoint}/testnet/api/tx`, {
        method: "POST",
        headers: {
            "Content-Type": "text/plain",
        },
        body: signedTxHex,
    });

    const txid = await broadcastResponse.text();
    console.log("Transaction broadcast successfully. TXID:", txid);

    return txid;
}
