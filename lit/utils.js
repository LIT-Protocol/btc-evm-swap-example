import { generateBtcEthSwapLitActionCode } from "./create-swap-action.js";
import { LitNodeClient } from "@lit-protocol/lit-node-client";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import {
    LitNetwork,
    AuthMethodType,
    AuthMethodScope,
    LIT_CHAINS,
    LIT_RPC,
} from "@lit-protocol/constants";
import { LitAbility } from "@lit-protocol/types";
import {
    LitActionResource,
    createSiweMessageWithRecaps,
    generateAuthSig,
    LitPKPResource,
} from "@lit-protocol/auth-helpers";
import { ethers } from "ethers";
import bs58 from "bs58";
import { ec as EC } from "elliptic";
import * as ecc from "@bitcoin-js/tiny-secp256k1-asmjs";
import * as bitcoin from "bitcoinjs-lib";
import axios from "axios";
import ECPair from "ecpair";

const ec = new EC("secp256k1");
bitcoin.initEccLib(ecc);

let mintedPKP = {
        tokenId:
            "24865820801642579559008892774968411598045872329997317801273786902949269969954",
        publicKey:
            "0x049b7c2d8fbe8de67191cad56bfb32622ba2b36b067c489b49790912793b1f490777857dfac88910b7bd39e23896512ac68d22b0895af2c6f5eaf8f9cc77122359",
        ethAddress: "0x4c69B5475f7Cc688ce5bACf5B460fBc08E285fB3",
    },
    action_ipfs = "QmQwMA1cqhYW4eLLwomyvg3YjAmop1bTQDPNFPZjoe2zNT";

// const Btc_Endpoint = "https://blockstream.info";
const Btc_Endpoint = "https://mempool.space";

const litNodeClient = new LitNodeClient({
    litNetwork: LitNetwork.DatilDev,
    debug: true,
});

// https://bitcoinfaucet.uo1.net/send.php drops 1000 sats
// counterPartyAddress is _to address

const btcParams = {
    counterPartyAddress:
        "tb1pj6lxcqsx043c65ucrfx2ksu4e9rrz5mguw7awwqlyukx4yhcv6asaty8at",
    ethAddress: "0xE1b89ef648A6068fb4e7bCd943E3a9f4Dc5c530b",
    network: "testnet",
    value: 1000,
};

const evmParams = {
    counterPartyAddress: "0x6428B9170f12EaC6aBA3835775D2bf27e2D6EAd4",
    btcAddress:
        "tb1pg3vxcftwr5af70k34z0ae7g7xevzmtzccdfew4n4f4hf3al0xkvs98y7k9",
    chain: "yellowstone",
    amount: "0.01",
};

// major functions ----------------------------

export async function createLitAction() {
    console.log("creating lit action..");
    const action = await generateBtcEthSwapLitActionCode(btcParams, evmParams);
    const ipfsCid = await uploadViaPinata(action);

    console.log("Lit Action code:\n", action);
    console.log("IPFS CID: ", ipfsCid);
    return ipfsCid;
}

export async function mintGrantBurnPKP(_action_ipfs, _mintedPKP) {
    _action_ipfs ? (action_ipfs = _action_ipfs) : null;
    _mintedPKP ? (mintedPKP = _mintedPKP) : null;

    console.log("minting started..");
    const signerA = await getWalletEVM();

    const litContracts = new LitContracts({
        signer: signerA,
        network: LitNetwork.DatilDev,
        debug: false,
    });
    await litContracts.connect();

    const bytesAction = await stringToBytes(action_ipfs);

    const pkpMintCost = await litContracts.pkpNftContract.read.mintCost();

    const tx =
        await litContracts.pkpHelperContract.write.mintNextAndAddAuthMethods(
            AuthMethodType.LitAction,
            [AuthMethodType.LitAction],
            [bytesAction],
            ["0x"],
            [[AuthMethodScope.SignAnything]],
            false,
            true,
            {
                value: pkpMintCost,
            }
        );

    const receipt = await tx.wait();
    console.log(
        "pkp minted, added lit action as auth, and transferred to itself: ",
        receipt
    );

    const pkpInfo = await getPkpInfoFromMintReceipt(receipt, litContracts);
    console.log("pkp: ", pkpInfo);

    return pkpInfo;
}

export async function runLitAction(_action_ipfs, _mintedPKP) {
    _action_ipfs ? (action_ipfs = _action_ipfs) : null;
    _mintedPKP ? (mintedPKP = _mintedPKP) : null;

    const sessionSig = await sessionSigEOA();

    const chainProvider = new ethers.providers.JsonRpcProvider(
        LIT_CHAINS[evmParams.chain].rpcUrls[0]
    );

    const evmGasConfig = {
        maxFeePerGas: ethers.BigNumber.from("1500000000"),
        chainId: LIT_CHAINS[evmParams.chain].chainId,
        nonce: await chainProvider.getTransactionCount(mintedPKP.ethAddress),
    };
    const btcFeeRate = 0;

    const originTime = Date.now();
    const signer = await getWalletEVM();

    const pkpBtcAddress = generateBtcAddress(mintedPKP.publicKey);

    const endpoint = `${Btc_Endpoint}/testnet/api/address/${pkpBtcAddress}/utxo`;
    const result = await fetch(endpoint);
    const utxos = await result.json();
    const firstUtxo = utxos[0];
    // console.log("utxos", utxos);

    const { transaction: btcSuccessTransaction, transactionHash: successHash } =
        await prepareBtcTransaction({
            utxo: firstUtxo,
            recipientAddress: evmParams.btcAddress,
            fee: btcFeeRate,
            pkpBtcAddress,
        });

    // console.log("btcSuccessTransaction", btcSuccessTransaction, successHash);

    const {
        transaction: btcClawbackTransaction,
        transactionHash: clawbackHash,
    } = await prepareBtcTransaction({
        utxo: firstUtxo,
        recipientAddress: btcParams.counterPartyAddress,
        fee: btcFeeRate,
        pkpBtcAddress,
    });

    const authSig = await getAuthSig(signer);

    await litNodeClient.connect();

    const results = await litNodeClient.executeJs({
        ipfsId: action_ipfs,
        sessionSigs: sessionSig,
        jsParams: {
            pkpPublicKey: mintedPKP.publicKey,
            pkpAddress: ethers.utils.computeAddress(mintedPKP.publicKey),
            pkpBtcAddress,
            authSig: authSig,
            // passedFirstUtxo: firstUtxo,
            originTime,
            BTC_ENDPOINT: Btc_Endpoint,
            passedInUtxo: firstUtxo,
            ethGasConfig: evmGasConfig,
            btcFeeRate: btcFeeRate,
            successHash: successHash,
            clawbackHash: clawbackHash,
            successTxHex: btcSuccessTransaction.toHex(),
            clawbackTxHex: btcClawbackTransaction.toHex(),
        },
    });

    console.log(results);

    if (results.signatures == undefined) {
        return;
    } else if (results.signatures.ethSignature == undefined) {
        console.log("executing clawback btc tx..");
        await broadcastBtcTransaction(results);
    } else if (results.signatures.btcSignature == undefined) {
        console.log("executing clawback eth tx..");
        // await broadcastEVMTransaction(results, chainProvider);
    } else {
        console.log("executing swap txs..");
        await broadcastBtcTransaction(results);
        // await broadcastEVMTransaction(results, chainProvider);
    }
}

export async function broadcastBtcTransaction(results) {
    console.log("broadcasting on btc..");

    const btcSignature = results.signatures.btcSignature;
    const btcTransaction = results.response.response.btcTransaction;

    let pubKeyHex = mintedPKP.publicKey.startsWith("0x")
        ? mintedPKP.publicKey.slice(2)
        : mintedPKP.publicKey;

    const keyPair = ec.keyFromPublic(pubKeyHex, "hex");

    const compressedPoint = Buffer.from(keyPair.getPublic(true, "hex"), "hex");

    const encodedSignature = Buffer.from(
        btcSignature.r + btcSignature.s,
        "hex"
    );

    const compiledSignature = bitcoin.script.compile([
        bitcoin.script.signature.encode(
            encodedSignature,
            bitcoin.Transaction.SIGHASH_ALL
        ),
        Buffer.from(compressedPoint.buffer),
    ]);

    const transaction = bitcoin.Transaction.fromHex(btcTransaction);
    transaction.setInputScript(0, compiledSignature);

    const response = await fetch("https://mempool.space/api/tx", {
        method: "POST",
        headers: {
            "Content-Type": "text/plain",
        },
        body: transaction.toHex(),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error broadcasting transaction: ${errorText}`);
    }

    const txid = await response.text();
    console.log(`Transaction broadcasted successfully. TXID: ${txid}`);
}

// export async function broadcastBtcTransaction(results) {
//     console.log("Broadcasting on BTC...");

//     const signatureHex = results.signatures.btcSignature; // Assuming this is a hex string
//     const signature = Buffer.from(signatureHex, "hex");

//     const btcTransaction = results.response.response.btcTransaction; // This should be psbtBase64
//     const psbt = bitcoin.Psbt.fromBase64(btcTransaction, {
//         network: bitcoin.networks.testnet,
//     });

//     psbt.updateInput(0, {
//         tapKeySig: signature,
//     });

//     psbt.finalizeInput(0);

//     const transaction = psbt.extractTransaction();
//     const transactionHex = transaction.toHex();

//     const response = await fetch("https://mempool.space/testnet/api/tx", {
//         method: "POST",
//         headers: {
//             "Content-Type": "text/plain",
//         },
//         body: transactionHex,
//     });

//     if (!response.ok) {
//         const errorText = await response.text();
//         throw new Error(`Error broadcasting transaction: ${errorText}`);
//     }

//     const txid = await response.text();
//     console.log(`Transaction broadcasted successfully. TXID: ${txid}`);
// }

async function broadcastEVMTransaction(results, chainProvider) {
    console.log("broadcasting on evm..");
    const evmSignature = results.signatures.ethSignature;
    const evmTransaction = results.response.response.ethTransaction;

    const encodedSignature = ethers.utils.joinSignature({
        v: evmSignature.recid,
        r: `0x${evmSignature.r}`,
        s: `0x${evmSignature.s}`,
    });

    const tx = await chainProvider.sendTransaction(
        ethers.utils.serializeTransaction(evmTransaction, encodedSignature)
    );
    const receipt = await tx.wait();
    const blockExplorer = LIT_CHAINS[evmParams.chain].blockExplorerUrls[0];

    console.log(`tx: ${blockExplorer}/tx/${receipt.transactionHash}`);
}

// helper functions ----------------------------

async function prepareBtcTransaction({
    utxo,
    recipientAddress,
    fee,
    pkpBtcAddress,
}) {
    const txEndpoint = `${Btc_Endpoint}/testnet/api/tx/${utxo.txid}`;
    const txResult = await fetch(txEndpoint);
    const txData = await txResult.json();
    const output = txData.vout[utxo.vout];
    const scriptPubKeyHex = output.scriptpubkey;

    const utxoValue = BigInt(utxo.value);
    const feeValue = BigInt(fee);
    const transferAmount = utxoValue - feeValue;

    const transaction = new bitcoin.Transaction();
    transaction.version = 2;
    transaction.addInput(Buffer.from(utxo.txid, "hex").reverse(), utxo.vout);

    transaction.addOutput(
        bitcoin.address.toOutputScript(
            recipientAddress,
            bitcoin.networks.testnet
        ),
        transferAmount
    );

    const scriptPubKeyBuffer = Buffer.from(scriptPubKeyHex, "hex");
    const decompiled = bitcoin.script.decompile(scriptPubKeyBuffer);
    const transactionHash = transaction.hashForSignature(
        0,
        bitcoin.script.compile(decompiled),
        bitcoin.Transaction.SIGHASH_ALL
    );

    // const transactionHash = transaction.hashForSignature(
    //     0,
    //     bitcoin.address.toOutputScript(pkpBtcAddress, bitcoin.networks.testnet),
    //     bitcoin.Transaction.SIGHASH_ALL
    // );

    // console.log(transaction, transactionHash)

    return { transaction, transactionHash };
}

// async function prepareBtcTransaction({
//     utxo,
//     recipientAddress,
//     fee,
//     pkpBtcAddress,
// }) {
//     const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });

//     const txEndpoint = `${Btc_Endpoint}/testnet/api/tx/${utxo.txid}`;
//     const txResult = await fetch(txEndpoint);
//     const txData = await txResult.json();
//     const output = txData.vout[utxo.vout];
//     const scriptPubKeyHex = output.scriptpubkey_hex;

//     // Amounts must be in satoshis
//     const utxoValue = BigInt(utxo.value); // Ensure utxo.amount is in satoshis
//     const feeValue = BigInt(fee); // Fee in satoshis
//     const transferAmount = utxoValue - feeValue;

//     if (transferAmount <= 0n) {
//         throw new Error(
//             "Transfer amount must be greater than zero after deducting fee."
//         );
//     }

//     psbt.addInput({
//         hash: utxo.txid,
//         index: utxo.vout,
//         witnessUtxo: {
//             script: Buffer.from(scriptPubKeyHex, 'hex'),
//             value: Number(utxoValue), // PSBT expects a number
//         },
//         tapInternalKey: Buffer.from(pkpPublicKey, 'hex'), // Your public key in hex
//     });

//     psbt.addOutput({
//         address: recipientAddress,
//         value: Number(transferAmount),
//     });

//     const inputIndex = 0;
//     const sighashType = bitcoin.Transaction.SIGHASH_DEFAULT;

//     const transactionHash = psbt.__CACHE.__TX.hashForWitnessV1(
//         inputIndex,
//         psbt.__CACHE.__IN_PREVS.map((input) => input.witnessUtxo.script),
//         psbt.__CACHE.__IN_PREVS.map((input) => input.witnessUtxo.value),
//         sighashType
//     );

//     const psbtBase64 = psbt.toBase64();

//     return { psbtBase64, transactionHash };
// }

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

async function getWalletEVM() {
    const provider = new ethers.providers.JsonRpcProvider(
        LIT_RPC.CHRONICLE_YELLOWSTONE
    );
    const wallet = new ethers.Wallet(
        process.env.NEXT_PUBLIC_PRIVATE_KEY,
        provider
    );
    return wallet;
}

export async function uploadViaPinata(_litActionCode) {
    const formData = new FormData();

    const file = new File([_litActionCode], "Action.txt", {
        type: "text/plain",
    });
    const pinataMetadata = JSON.stringify({
        name: "EVM-SWAP",
    });
    const pinataOptions = JSON.stringify({
        cidVersion: 0,
    });

    formData.append("file", file);
    formData.append("pinataMetadata", pinataMetadata);
    formData.append("pinataOptions", pinataOptions);

    const key = process.env.NEXT_PUBLIC_PINATA_API;

    const request = await fetch(
        "https://api.pinata.cloud/pinning/pinFileToIPFS",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${key}`,
            },
            body: formData,
        }
    );
    const response = await request.json();
    console.log(response);
    return response.IpfsHash;
}

async function stringToBytes(_string) {
    const bytes = `0x${Buffer.from(bs58.decode(_string)).toString("hex")}`;
    return bytes;
}

const getPkpInfoFromMintReceipt = async (txReceipt, litContractsClient) => {
    const pkpMintedEvent = txReceipt.events.find(
        (event) =>
            event.topics[0] ===
            "0x3b2cc0657d0387a736293d66389f78e4c8025e413c7a1ee67b7707d4418c46b8"
    );

    const publicKey = "0x" + pkpMintedEvent.data.slice(130, 260);
    const tokenId = ethers.utils.keccak256(publicKey);
    const ethAddress =
        await litContractsClient.pkpNftContract.read.getEthAddress(tokenId);

    return {
        tokenId: ethers.BigNumber.from(tokenId).toString(),
        publicKey,
        ethAddress,
    };
};

export async function sessionSigEOA() {
    console.log("creating session sigs..");
    const ethersSigner = await getWalletEVM();

    await litNodeClient.connect();

    const sessionSigs = await litNodeClient.getSessionSigs({
        pkpPublicKey: mintedPKP.publicKey,
        chain: "ethereum",
        resourceAbilityRequests: [
            {
                resource: new LitPKPResource("*"),
                ability: LitAbility.PKPSigning,
            },
            {
                resource: new LitActionResource("*"),
                ability: LitAbility.LitActionExecution,
            },
        ],
        authNeededCallback: async (params) => {
            if (!params.uri) {
                throw new Error("Params uri is required");
            }

            if (!params.resourceAbilityRequests) {
                throw new Error("Params uri is required");
            }

            const toSign = await createSiweMessageWithRecaps({
                uri: params.uri,
                expiration: new Date(
                    Date.now() + 1000 * 60 * 60 * 24
                ).toISOString(), // 24 hours,
                resources: params.resourceAbilityRequests,
                walletAddress: await ethersSigner.getAddress(),
                nonce: await litNodeClient.getLatestBlockhash(),
                litNodeClient,
                domain: "localhost:3000",
            });

            return await generateAuthSig({
                signer: ethersSigner,
                toSign,
            });
        },
    });

    console.log("sessionSigs: ", sessionSigs);
    return sessionSigs;
}

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

// supporting functions ----------------------------

export async function depositOnEVM() {}

export async function depositOnBitcoin(_bitcoin) {}

export async function getFundsStatusPKP(_action_ipfs, _mintedPKP) {
    _action_ipfs ? (action_ipfs = _action_ipfs) : null;
    _mintedPKP ? (mintedPKP = _mintedPKP) : null;

    console.log("checking balances on pkp..");

    const pkpBtcAddress = generateBtcAddress(mintedPKP.pubkey);
    const utxoResponse = await axios.get(
        `${Btc_Endpoint}/testnet/api/address/${pkpBtcAddress}/utxo`
    );

    const chainProvider = new ethers.providers.JsonRpcProvider(
        LIT_RPC.CHRONICLE_YELLOWSTONE
    );
    const balance = await chainProvider.getBalance(mintedPKP.ethAddress);
    const balanceInTokens_EVM = ethers.utils.formatUnits(balance, 18);

    console.log("balance on btc: ", utxoResponse.data[0].value);
    console.log("balance on evm: ", balanceInTokens_EVM);
}
