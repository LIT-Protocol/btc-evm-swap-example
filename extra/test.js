import ECPair from "ecpair";
import * as bitcoin from "bitcoinjs-lib";
import mempool from "@mempool/mempool.js";
import { ethers } from "ethers";
import { ec as EC } from "elliptic";
import axios from "axios";

const ec = new EC("secp256k1");

let mintedPKP = {
        tokenId:
            "50202233540837129411155367829024341022546334492979792100268790842102423049011",
        publicKey:
            "0x040b670b840bdce35bd1d14e43757d443fefea38560a48f7bf768b94f1626cb9c3d211429983c6eeee626ea90db846bb76dbf378ccd3f7d0a6826ee25292aab40d",
        ethAddress: "0x6071623DFa2FaEf23E7b93f8AC535cE608326f75",
    },
    action_ipfs = "QmZDSFML4DmgiAbvab7neKbg57em3PZbG5jUZ2M2ThkMA2";
const Btc_Endpoint = "https://mempool.space";

// ----------------------------
// ----------------------------
// ----------------------------

export async function createAndSignTx1() {
    console.log("dropping some bitcoin..");
    let privateKey = process.env.NEXT_PUBLIC_PRIVATE_KEY;
    const amountInSats = 1000;

    if (!privateKey.startsWith("0x")) {
        privateKey = "0x" + privateKey;
    }
    const publicKey = ethers.utils.computePublicKey(privateKey);

    const btcFrom = generateBtcAddress(publicKey);
    const btcTo = generateBtcAddress(mintedPKP.publicKey);

    console.log("from", btcFrom, "to", btcTo);

    const utxoResponse = await axios.get(
        `${Btc_Endpoint}/testnet/api/address/${btcFrom}/utxo`
    );
    const fetchUtxo = await utxoResponse.data;
    const utxoToSpend = fetchUtxo[0];
    console.log("utxoToSpend ", utxoToSpend);

    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });

    psbt.addInput({
        hash: utxoToSpend.txid,
        index: utxoToSpend.vout,
        witnessUtxo: {
            script: Buffer.from(
                bitcoin.address.toOutputScript(
                    btcFrom,
                    bitcoin.networks.testnet
                )
            ),
            value: BigInt(utxoToSpend.value),
        },
    });

    psbt.addOutput({
        address: btcTo,
        // script: Buffer.from(
        //     bitcoin.address.toOutputScript(btcTo, bitcoin.networks.testnet)
        // ),
        value: amountInSats,
    });

    console.log(psbt);
    const ecpair = ECPair.fromPrivateKey(
        Buffer.from(privateKey.slice(2), "hex")
    );

    psbt.signInput(0, ecpair);
    psbt.finalizeAllInputs();

    const txHex = psbt.extractTransaction().toHex();
    console.log("Signed Raw Transaction Hex:", txHex);

    // const mempoolJS = mempool();
    // const { bitcoin: bitcoinMempool } = mempoolJS({ hostname: 'mempool.space', network: 'testnet' });

    // const result = await bitcoinMempool.tx.broadcastTx({ txHex });
    // console.log('Transaction broadcast result:', result);
}

export async function createAndSignTx2() {
    console.log("dropping some bitcoin..");
    let privateKey = process.env.NEXT_PUBLIC_PRIVATE_KEY;
    const amountInSats = 1000;

    if (!privateKey.startsWith("0x")) {
        privateKey = "0x" + privateKey;
    }
    const publicKey = ethers.utils.computePublicKey(privateKey);

    const btcFrom = generateBtcAddress(publicKey);
    const btcTo = generateBtcAddress(mintedPKP.publicKey);

    console.log("from", btcFrom, "to", btcTo);

    const utxoResponse = await axios.get(
        `${Btc_Endpoint}/testnet/api/address/${btcFrom}/utxo`
    );
    console.log("my", btcFrom);

    const fetchUtxo = await utxoResponse.data;
    const utxoToSpend = fetchUtxo[0];
    console.log("utxoToSpend ", utxoToSpend);

    
    // psbt.addInput({
    //     hash: utxoToSpend.txid,
    //     index: utxoToSpend.vout,
    //     witnessUtxo: {
    //         script: Buffer.from(
    //             bitcoin.address.toOutputScript(
    //                 btcFrom,
    //                 bitcoin.networks.testnet
    //             )
    //         ),
    //         value: BigInt(utxoToSpend.value),
    //     },
    // });
    
    const transaction = new bitcoin.Transaction();

    const txidBuffer = Buffer.from(utxoToSpend.txid, "hex").reverse();
    transaction.addInput(txidBuffer, utxoToSpend.value);

    const scriptPubKey = bitcoin.address.toOutputScript(
        btcTo,
        bitcoin.networks.testnet
    );
    const amountInSatsBigInt = BigInt(amountInSats);
    transaction.addOutput(scriptPubKey, amountInSatsBigInt);

    console.log("transaction", transaction);
    console.log(transaction.toHex())
    // const mempoolJS = mempool();
    // const { bitcoin: bitcoinMempool } = mempoolJS({ hostname: 'mempool.space', network: 'testnet' });

    // const result = await bitcoinMempool.tx.broadcastTx({ txHex });
    // console.log('Transaction broadcast result:', result);
}

// ----------------------------
// ----------------------------
// ----------------------------

export function generateBtcAddress(_evmPublicKey) {
    let pubicKey;
    _evmPublicKey
        ? (pubicKey = _evmPublicKey)
        : (pubicKey = mintedPKP.publicKey);

    const compressedPubKeyHex = compressPublicKey(pubicKey);
    const compressedPubKey = Buffer.from(compressedPubKeyHex, "hex");

    const { address } = bitcoin.payments.p2wpkh({
        pubkey: compressedPubKey,
        network: bitcoin.networks.testnet,
    });

    if (!address) throw new Error("Could not generate address");
    return address;
}

function compressPublicKey(pubKeyHex) {
    if (pubKeyHex.startsWith("0x") || pubKeyHex.startsWith("0X")) {
        pubKeyHex = pubKeyHex.slice(2);
    }

    if (pubKeyHex.length === 130) {
        if (!pubKeyHex.startsWith("04")) {
            throw new Error("Invalid Ethereum public key format");
        }
    } else if (pubKeyHex.length === 128) {
        pubKeyHex = "04" + pubKeyHex;
    } else if (pubKeyHex.length === 66) {
        if (!pubKeyHex.startsWith("02") && !pubKeyHex.startsWith("03")) {
            throw new Error("Invalid compressed public key format");
        }
        return pubKeyHex;
    } else if (pubKeyHex.length === 64) {
        throw new Error("Invalid compressed public key length");
    } else {
        throw new Error("Invalid public key length");
    }

    const keyPair = ec.keyFromPublic(pubKeyHex, "hex");
    const compressedPubKeyHex = keyPair.getPublic(true, "hex");
    return compressedPubKeyHex;
}
