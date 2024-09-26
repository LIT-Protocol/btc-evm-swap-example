import { LitNodeClient } from "@lit-protocol/lit-node-client";
import { LitNetwork } from "@lit-protocol/constants";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoin-js/tiny-secp256k1-asmjs";
import { ec as EC } from "elliptic";
import { ethers } from "ethers";
import {
    createSiweMessageWithRecaps,
    generateAuthSig,
} from "@lit-protocol/auth-helpers";

bitcoin.initEccLib(ecc);
const ec = new EC("secp256k1");

const litNodeClient = new LitNodeClient({
    litNetwork: LitNetwork.DatilDev,
    debug: true,
});

export async function runBtcEthSwapLitAction({
    pkpPublicKey,
    ipfsId,
    sessionSig,
    signer,
    evmParams,
    btcParams,
    ethGasConfig,
    btcFeeRate,
    originTime,
    BTC_ENDPOINT,
}) {

    const pkpBtcAddress = generateBtcAddress(pkpPublicKey);

    const endpoint = `${BTC_ENDPOINT}/testnet/api/address/${pkpBtcAddress}/utxo`;
    const result = await fetch(endpoint);
    const utxos = await result.json();
    const firstUtxo = utxos[0];
    // console.log("utxos", utxos)

    const { transaction: btcSuccessTransaction, transactionHash: successHash } =
        prepareBtcTransaction({
            utxo: firstUtxo,
            recipientAddress: evmParams.btcAddress,
            fee: btcFeeRate,
            pkpBtcAddress,
        });

        console.log("btcSuccessTransaction", btcSuccessTransaction.toHex())

    const { transaction: btcClawbackTransaction, transactionHash: clawbackHash } =
        prepareBtcTransaction({
            utxo: firstUtxo,
            recipientAddress: btcParams.counterPartyAddress,
            fee: btcFeeRate,
            pkpBtcAddress,
        });

    const authSig = await getAuthSig(signer);

    await litNodeClient.connect();

    const response = await litNodeClient.executeJs({
        ipfsId: ipfsId,
        sessionSigs: sessionSig,
        jsParams: {
            pkpAddress: ethers.utils.computeAddress(pkpPublicKey),
            pkpBtcAddress: generateBtcAddress(pkpPublicKey),
            pkpPublicKey: pkpPublicKey,
            authSig: authSig,
            // passedFirstUtxo: firstUtxo,
            passedInUtxo: firstUtxo,
            originTime,
            BTC_ENDPOINT,
            ethGasConfig: ethGasConfig,
            btcFeeRate: btcFeeRate,
            successHash: successHash,
            clawbackHash: clawbackHash,
            successTxHex: btcSuccessTransaction.toHex(),
            clawbackTxHex: btcClawbackTransaction.toHex(),
        },
    });
    return response;
}

function prepareBtcTransaction({
    utxo,
    recipientAddress,
    fee,
    pkpBtcAddress,
}) {
    const transaction = new bitcoin.Transaction();
    transaction.version = 2;
    transaction.addInput(Buffer.from(utxo.txid, "hex").reverse(), utxo.vout);

    const VBYTES_PER_TX = 410;
    const utxoValue = BigInt(utxo.value);
    const feeAmount = BigInt(VBYTES_PER_TX) * BigInt(fee);
    const outputAmount = utxoValue - feeAmount;

    if (outputAmount <= BigInt(0)) {
        throw new Error(
            `Insufficient funds: output amount is non-positive (${outputAmount}).`
        );
    }

    transaction.addOutput(
        bitcoin.address.toOutputScript(
            recipientAddress,
            bitcoin.networks.testnet
        ),
        outputAmount
    );

    // const scriptPubKeyBuffer = Buffer.from(utxo.scriptPubKey, "hex");
    // const decompiled = bitcoin.script.decompile(scriptPubKeyBuffer);
    // const transactionHash = transaction.hashForSignature(
    //   0,
    //   bitcoin.script.compile(decompiled),
    //   bitcoin.Transaction.SIGHASH_ALL
    // );

    const transactionHash = transaction.hashForSignature(
        0,
        bitcoin.address.toOutputScript(
            pkpBtcAddress,
            bitcoin.networks.testnet
        ),
        bitcoin.Transaction.SIGHASH_ALL
    );

    return { transaction, transactionHash };
}

// helper functions ----------------------------

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

export function generateBtcAddress(ethPublicKey) {
    const compressedPubKeyHex = compressPublicKey(ethPublicKey);
    const compressedPubKey = Buffer.from(compressedPubKeyHex, "hex");

    const { address } = bitcoin.payments.p2wpkh({
        pubkey: compressedPubKey,
        network: bitcoin.networks.testnet,
    });

    if (!address) throw new Error("Could not generate address");
    return address;
}

export async function getAuthSig(_signer) {
    await litNodeClient.connect();

    const toSign = await createSiweMessageWithRecaps({
        uri: "http://localhost:3000",
        expiration: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), // 24 hours
        walletAddress: await _signer.getAddress(),
        nonce: await litNodeClient.getLatestBlockhash(),
        litNodeClient,
    });

    const authSig = await generateAuthSig({
        signer: _signer,
        toSign,
    });
    return authSig;
}
