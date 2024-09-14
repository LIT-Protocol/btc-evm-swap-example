import { LitNodeClient } from "@lit-protocol/lit-node-client";
import { LitNetwork } from "@lit-protocol/constants";
import { ec as EC } from 'elliptic';
import * as bitcoin from 'bitcoinjs-lib';
import { toOutputScript } from "bitcoinjs-lib/src/address";
import * as ecc from '@bitcoin-js/tiny-secp256k1-asmjs';
import { ethers } from "ethers";
import {
    createSiweMessageWithRecaps,
    generateAuthSig,
} from "@lit-protocol/auth-helpers";

bitcoin.initEccLib(ecc);
const ec = new EC('secp256k1');

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
    isEthClawback = false,
    originTime,
}) {
        let successHash, clawbackHash, utxo, successTxHex, clawbackTxHex;
        if (!isEthClawback) {
            ({ successHash, clawbackHash, utxo, successTxHex, clawbackTxHex } =
                await prepareBtcSwapTransactions(
                    btcParams,
                    evmParams,
                    pkpPublicKey,
                    btcFeeRate
                ));
        }

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
                ethGasConfig: ethGasConfig,
                btcFeeRate: btcFeeRate,
                successHash: successHash,
                clawbackHash: clawbackHash,
                passedInUtxo: utxo,
                successTxHex,
                clawbackTxHex,
                originTime,
            },
        });
        return response;
}

async function prepareBtcSwapTransactions(
    btcParams,
    evmParams,
    pkpPublicKey,
    btcFeeRate
) {
        const btcAddress = generateBtcAddress(pkpPublicKey);
        const utxo = await getUtxoByAddress(btcAddress);

        const btcSuccessTransaction = prepareTransactionForSignature({
            utxo,
            recipientAddress: evmParams.btcAddress,
            fee: btcFeeRate,
        });

        const successHash = btcSuccessTransaction.hashForSignature(
            0,
            bitcoin.address.toOutputScript(
                btcAddress,
                bitcoin.networks.testnet
            ),
            bitcoin.Transaction.SIGHASH_ALL
        );

        const btcClawbackTransaction = prepareTransactionForSignature({
            utxo,
            recipientAddress: btcParams.counterPartyAddress,
            fee: btcFeeRate,
        });

        const clawbackHash = btcClawbackTransaction.hashForSignature(
            0,
            bitcoin.address.toOutputScript(
                btcAddress,
                bitcoin.networks.testnet
            ),
            bitcoin.Transaction.SIGHASH_ALL
        );

        return {
            successTxHex: btcSuccessTransaction.toHex(),
            successHash,
            clawbackTxHex: btcClawbackTransaction.toHex(),
            clawbackHash,
            utxo,
        };
}

function prepareTransactionForSignature({ utxo, recipientAddress, fee }) {
    const transaction = new bitcoin.Transaction();
    transaction.addInput(
        reverseBuffer(Buffer.from(utxo.txid, "hex")),
        utxo.vout
    );

    const outputScript = toOutputScript(
        recipientAddress,
        bitcoin.networks.testnet
    );

    // console.log("utxo.value", utxo.value)
    // console.log("VBYTES_PER_TX", VBYTES_PER_TX)
    // console.log("fee", fee)

    const VBYTES_PER_TX = 192;

    const utxoValue = BigInt(utxo.value);
    const feeAmount = BigInt(VBYTES_PER_TX) * BigInt(fee);
    const outputAmount = utxoValue - feeAmount;

    if (outputAmount <= BigInt(0)) {
        throw new Error(`Insufficient funds: output amount is non-positive (${outputAmount}).`);
    }

    transaction.addOutput(outputScript, outputAmount);

    return transaction;
}

// helper functions ----------------------------

function compressPublicKey(pubKeyHex) {
    if (pubKeyHex.startsWith('0x') || pubKeyHex.startsWith('0X')) {
        pubKeyHex = pubKeyHex.slice(2);
    }
    
    if (pubKeyHex.length === 130) {
        if (!pubKeyHex.startsWith('04')) {
            throw new Error('Invalid Ethereum public key format');
        }
    } else if (pubKeyHex.length === 128) {
        pubKeyHex = '04' + pubKeyHex;
    } else if (pubKeyHex.length === 66) {
        if (!pubKeyHex.startsWith('02') && !pubKeyHex.startsWith('03')) {
            throw new Error('Invalid compressed public key format');
        }
        return pubKeyHex;
    } else if (pubKeyHex.length === 64) {
        throw new Error('Invalid compressed public key length');
    } else {
        throw new Error('Invalid public key length');
    }

    const keyPair = ec.keyFromPublic(pubKeyHex, 'hex');
    const compressedPubKeyHex = keyPair.getPublic(true, 'hex');
    return compressedPubKeyHex;
}

export function generateBtcAddress(ethPublicKey) {
    const compressedPubKeyHex = compressPublicKey(ethPublicKey);
    const compressedPubKey = Buffer.from(compressedPubKeyHex, 'hex');

    const { address } = bitcoin.payments.p2wpkh({
        pubkey: compressedPubKey,
        network: bitcoin.networks.testnet,
    });

    if (!address) throw new Error("Could not generate address");
    return address;
}

async function getUtxoByAddress(address) {
        const endpoint = `https://blockstream.info/${"testnet/"}api/address/${address}/utxo`;
        const result = await fetch(endpoint);
        if (!result.ok)
            throw new Error(
                `Could not get utxos from endpoint ${endpoint} ${result.statusText}`
            );

        const utxos = await result.json();
        const firstUtxo = utxos[0];
        if (!firstUtxo) {
            throw new Error("No utxos found for address");
        }
        return firstUtxo;
}

export function reverseBuffer(buffer) {
    if (buffer.length < 1) return buffer;
    let j = buffer.length - 1;
    let tmp = 0;
    for (let i = 0; i < buffer.length / 2; i++) {
      tmp = buffer[i];
      buffer[i] = buffer[j];
      buffer[j] = tmp;
      j--;
    }
    return buffer;
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