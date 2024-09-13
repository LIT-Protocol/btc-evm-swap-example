import { LitNodeClient } from "@lit-protocol/lit-node-client";
import { SiweMessage } from "siwe";
import { LitNetwork } from "@lit-protocol/constants";
import { ec as EC } from 'elliptic';
import * as bitcoin from 'bitcoinjs-lib';
import { toOutputScript } from "bitcoinjs-lib/src/address";

const ec = new EC('secp256k1');

const litNodeClient = new LitNodeClient({
    litNetwork: LitNetwork.DatilDev,
    debug: true,
});

export async function runBtcEthSwapLitAction({
    pkpPublicKey,
    code,
    sessionSig,
    ethGasConfig,
    btcFeeRate,
    ethParams,
    btcParams,
    isEthClawback = false,
    originTime,
}) {
    // try {
        let successHash, clawbackHash, utxo, successTxHex, clawbackTxHex;
        if (!isEthClawback) {
            ({ successHash, clawbackHash, utxo, successTxHex, clawbackTxHex } =
                await prepareBtcSwapTransactions(
                    btcParams,
                    ethParams,
                    code,
                    pkpPublicKey,
                    btcFeeRate
                ));
        }
        await litNodeClient.connect();
        const response = await litNodeClient.executeJs({
            code: code,
            authSig: sessionSig,
            jsParams: {
                pkpAddress: ethers.utils.computeAddress(pkpPublicKey),
                pkpBtcAddress: generateBtcAddress(pkpPublicKey),
                pkpPublicKey: pkpPublicKey,
                authSig: authSig || (await generateAuthSig()),
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
    // } catch (e) {
    //     throw new Error(`Error running btc eth swap lit action: ${e}`);
    // }
}

async function prepareBtcSwapTransactions(
    btcParams,
    ethParams,
    code,
    pkpPublicKey,
    btcFeeRate
) {
    // try {
        // const checksum = await getIPFSHash(
        //     await generateBtcEthSwapLitActionCode(btcParams, ethParams)
        // );
        // const codeChecksum = await getIPFSHash(code);
        // if (checksum !== codeChecksum) {
        //     throw new Error(
        //         "IPFS CID does not match generated Lit Action code. You may have incorrect parameters."
        //     );
        // }
        const btcAddress = generateBtcAddress(pkpPublicKey);
        const utxo = await getUtxoByAddress(btcAddress);

        const btcSuccessTransaction = prepareTransactionForSignature({
            utxo,
            recipientAddress: ethParams.btcAddress,
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
    // } catch (err) {
    //     throw new Error(`Error in prepareBtcSwapTransactions: ${err}`);
    // }
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
    transaction.addOutput(outputScript, utxo.value - VBYTES_PER_TX * fee);

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

    const { address } = bitcoin.payments.p2pkh({
        pubkey: compressedPubKey,
        network: bitcoin.networks.testnet,
    });

    if (!address) throw new Error("Could not generate address");
    return address;
}

async function getUtxoByAddress(address) {
    // try {
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
    // } catch (err) {
    //     throw new Error("Error fetching utxos: " + err);
    // }
}

export async function generateAuthSig(
    signer,
    chainId = 1,
    uri = "https://localhost/login",
    version = "1"
) {
    const siweMessage = new SiweMessage({
        domain: "localhost",
        address: await signer.getAddress(),
        statement: "This is a key for Yacht",
        uri,
        version,
        chainId,
    });
    const messageToSign = siweMessage.prepareMessage();
    const sig = await signer.signMessage(messageToSign);
    return {
        sig,
        derivedVia: "web3.eth.personal.sign",
        signedMessage: messageToSign,
        address: await signer.getAddress(),
    };
}

// dead function----------------------------


// import * as ecc from 'tiny-secp256k1';

// function generateBtcAddress(pkpPublicKey) {
//     console.log("ethKey: ", pkpPublicKey);
//     let compressedPoint;
//     if (pkpPublicKey.length === 130) {
//         compressedPoint = ecc.pointCompress(
//             Buffer.from(pkpPublicKey, "hex"),
//             true
//         );
//     } else if (pkpPublicKey.length === 132) {
//         if (pkpPublicKey.slice(0, 2) !== "0x") {
//             throw new Error("Invalid Ethereum public key");
//         }
//         compressedPoint = ecc.pointCompress(
//             Buffer.from(pkpPublicKey.slice(2), "hex"),
//             true
//         );
//     } else if (pkpPublicKey.length === 66) {
//         compressedPoint = Buffer.from(ethKey, "hex");
//     } else if (pkpPublicKey.length === 68) {
//         if (pkpPublicKey.slice(0, 2) !== "0x") {
//             throw new Error("Invalid Ethereum public key");
//         }
//         compressedPoint = Buffer.from(pkpPublicKey.slice(2), "hex");
//     } else {
//         throw new Error("Invalid Ethereum public key");
//     }

//     const { address } = bitcoin.payments.p2pkh({
//         pubkey: Buffer.from(compressedPoint),
//         network: bitcoin.networks.testnet,
//     });
//     if (!address) throw new Error("Could not generate address");
//     return address;
// }