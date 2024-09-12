import ecc from 'tiny-secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import fetch from 'node-fetch';

async function runBtcEthSwapLitAction({
    pkpPublicKey,
    code,
    authSig,
    ethGasConfig,
    btcFeeRate,
    ethParams,
    btcParams,
    isEthClawback = false,
    originTime,
    utxoIsValid,
    didSendBtcFromPkp,
}) {
    try {
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
        await this.connect();
        const response = await this.litClient.executeJs({
            code: code,
            authSig: authSig || (await this.generateAuthSig()),
            jsParams: {
                pkpAddress: ethers.utils.computeAddress(pkpPublicKey),
                pkpBtcAddress: generateBtcAddress(pkpPublicKey),
                pkpPublicKey: pkpPublicKey,
                authSig: authSig || (await this.generateAuthSig()),
                ethGasConfig: ethGasConfig,
                btcFeeRate: btcFeeRate,
                successHash: successHash,
                clawbackHash: clawbackHash,
                passedInUtxo: utxo,
                successTxHex,
                clawbackTxHex,
                utxoIsValid,
                didSendBtcFromPkp,
                originTime,
            },
        });
        return response;
    } catch (e) {
        throw new Error(`Error running btc eth swap lit action: ${e}`);
    }
}

async function prepareBtcSwapTransactions(
    btcParams,
    ethParams,
    code,
    pkpPublicKey,
    btcFeeRate
) {
    try {
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
                this.btcTestNet
                    ? bitcoin.networks.testnet
                    : bitcoin.networks.bitcoin
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
                this.btcTestNet
                    ? bitcoin.networks.testnet
                    : bitcoin.networks.bitcoin
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
    } catch (err) {
        throw new Error(`Error in prepareBtcSwapTransactions: ${err}`);
    }
}

function prepareTransactionForSignature({ utxo, recipientAddress, fee }) {
    const transaction = new bitcoin.Transaction();
    transaction.addInput(
        reverseBuffer(Buffer.from(utxo.txid, "hex")),
        utxo.vout
    );

    const outputScript = toOutputScript(
        recipientAddress,
        this.btcTestNet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin
    );
    transaction.addOutput(outputScript, utxo.value - VBYTES_PER_TX * fee);

    return transaction;
}

// helper functions ----------------------------

function generateBtcAddress(ethKey) {
    let compressedPoint;
    if (ethKey.length === 130) {
        compressedPoint = ecc.pointCompress(Buffer.from(ethKey, "hex"), true);
    } else if (ethKey.length === 132) {
        if (ethKey.slice(0, 2) !== "0x") {
            throw new Error("Invalid Ethereum public key");
        }
        compressedPoint = ecc.pointCompress(
            Buffer.from(ethKey.slice(2), "hex"),
            true
        );
    } else if (ethKey.length === 66) {
        compressedPoint = Buffer.from(ethKey, "hex");
    } else if (ethKey.length === 68) {
        if (ethKey.slice(0, 2) !== "0x") {
            throw new Error("Invalid Ethereum public key");
        }
        compressedPoint = Buffer.from(ethKey.slice(2), "hex");
    } else {
        throw new Error("Invalid Ethereum public key");
    }

    const { address } = bitcoin.payments.p2pkh({
        pubkey: Buffer.from(compressedPoint),
        network: this.btcTestNet
            ? bitcoin.networks.testnet
            : bitcoin.networks.bitcoin,
    });
    if (!address) throw new Error("Could not generate address");
    return address;
}

async function getUtxoByAddress(address) {
    try {
        const endpoint = `${this.btcApiEndpoint}/${
            this.btcTestNet ? "testnet/" : ""
        }api/address/${address}/utxo`;
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
    } catch (err) {
        throw new Error("Error fetching utxos: " + err);
    }
}


runBtcEthSwapLitAction();