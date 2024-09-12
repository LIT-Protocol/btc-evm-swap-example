import ecc from "tiny-secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { ethers } from "ethers";

// Define types for UTXO and swap parameters
interface Utxo {
    txid: string;
    vout: number;
    value: number;
}

interface BtcParams {
    counterPartyAddress: string;
    network: string;
    value: number;
    ethAddress: string;
}

interface EthParams {
    counterPartyAddress: string;
    chain: string;
    amount: string;
    btcAddress: string;
}

// Type for the prepare transaction signature params
interface PrepareTransactionSignatureParams {
    utxo: Utxo;
    recipientAddress: string;
    fee: number;
}

// Generate a BTC address from an Ethereum public key
function generateBtcAddress(ethKey: string): string {
    let compressedPoint: Buffer;

    if (ethKey.length === 130) {
        compressedPoint = ecc.pointCompress(Buffer.from(ethKey, "hex"), true);
    } else if (ethKey.length === 132) {
        if (ethKey.slice(0, 2) !== "0x") {
            throw new Error("Invalid Ethereum public key");
        }
        compressedPoint = ecc.pointCompress(Buffer.from(ethKey.slice(2), "hex"), true);
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
        network: this.btcTestNet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin,
    });

    if (!address) throw new Error("Could not generate address");
    return address;
}

// Fetch UTXO for a given Bitcoin address
async function getUtxoByAddress(address: string): Promise<Utxo> {
    try {
        const endpoint = `${this.btcApiEndpoint}/${this.btcTestNet ? "testnet/" : ""}api/address/${address}/utxo`;
        const result = await fetch(endpoint, {});

        if (!result.ok) {
            throw new Error(`Could not get UTXOs from endpoint ${endpoint}: ${result.statusText}`);
        }

        const utxos: Utxo[] = await result.json();
        const firstUtxo = utxos[0];

        if (!firstUtxo) {
            throw new Error("No UTXOs found for the address");
        }
        return firstUtxo;
    } catch (err) {
        throw new Error(`Error fetching UTXOs: ${err}`);
    }
}

// Prepare a Bitcoin transaction for signing
function prepareTransactionForSignature({
    utxo,
    recipientAddress,
    fee,
}: PrepareTransactionSignatureParams): bitcoin.Transaction {
    const transaction = new bitcoin.Transaction();
    transaction.addInput(Buffer.from(utxo.txid, "hex").reverse(), utxo.vout);

    const outputScript = bitcoin.address.toOutputScript(
        recipientAddress,
        this.btcTestNet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin
    );
    transaction.addOutput(outputScript, utxo.value - fee);

    return transaction;
}

// Run a BTC-ETH swap Lit Action
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
}: {
    pkpPublicKey: string;
    code: string;
    authSig?: any;
    ethGasConfig: any;
    btcFeeRate: number;
    ethParams: EthParams;
    btcParams: BtcParams;
    isEthClawback?: boolean;
    originTime: number;
    utxoIsValid: boolean;
    didSendBtcFromPkp: boolean;
}): Promise<any> {
    try {
        let successHash, clawbackHash, utxo, successTxHex, clawbackTxHex;

        if (!isEthClawback) {
            ({
                successHash,
                clawbackHash,
                utxo,
                successTxHex,
                clawbackTxHex,
            } = await prepareBtcSwapTransactions(btcParams, ethParams, code, pkpPublicKey, btcFeeRate));
        }

        await this.connect();

        const response = await this.litClient.executeJs({
            code,
            authSig: authSig || (await this.generateAuthSig()),
            jsParams: {
                pkpAddress: ethers.utils.computeAddress(pkpPublicKey),
                pkpBtcAddress: generateBtcAddress(pkpPublicKey),
                pkpPublicKey,
                authSig: authSig || (await this.generateAuthSig()),
                ethGasConfig,
                btcFeeRate,
                successHash,
                clawbackHash,
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
        throw new Error(`Error running BTC-ETH swap Lit action: ${e}`);
    }
}

// Prepare BTC swap transactions
async function prepareBtcSwapTransactions(
    btcParams: BtcParams,
    ethParams: EthParams,
    code: string,
    pkpPublicKey: string,
    btcFeeRate: number
): Promise<any> {
    try {
        const checksum = await getIPFSHash(await generateBtcEthSwapLitActionCode(btcParams, ethParams));
        const codeChecksum = await getIPFSHash(code);

        if (checksum !== codeChecksum) {
            throw new Error("IPFS CID does not match generated Lit Action code. Check the parameters.");
        }

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
                this.btcTestNet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin
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
                this.btcTestNet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin
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

// Generate Lit Action code for BTC-ETH swap
async function generateBtcEthSwapLitActionCode(
    btcParams: BtcParams,
    ethParams: EthParams,
    fileName?: string
): Promise<string> {
    const evmConditions = generateEVMNativeSwapCondition(ethParams);
    const unsignedEthTransaction = generateUnsignedEVMNativeTransaction({
        counterPartyAddress: btcParams.ethAddress,
        chain: ethParams.chain,
        amount: ethParams.amount,
    });

    const unsignedEthClawbackTransaction = generateUnsignedEVMNativeTransaction({
        counterPartyAddress: ethParams.counterPartyAddress,
        chain: ethParams.chain,
        amount: ethParams.amount,
    });

    const variablesToReplace = {
        btcSwapParams: JSON.stringify(btcParams),
        ethSwapParams: JSON.stringify(ethParams),
        evmConditions: JSON.stringify(evmConditions),
        evmTransaction: JSON.stringify(unsignedEthTransaction),
        evmClawbackTransaction: JSON.stringify(unsignedEthClawbackTransaction),
    };

    return await loadActionCode(variablesToReplace, fileName);
}

// Load action code from a file and replace variables
async function loadActionCode(variables: Record<string, string>, fileName: string = "BtcEthSwap.bundle.js"): Promise<string> {
    const filePath = path.join(__dirname, "javascript", fileName);

    try {
        const code = await fs.promises.readFile(filePath, "utf8");
        return replaceCodeVariables(code, variables);
    } catch (err) {
        console.error(`Error loading Lit action code: ${err}`);
        return "";
    }
}