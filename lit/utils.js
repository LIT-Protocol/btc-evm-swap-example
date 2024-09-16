import { generateBtcEthSwapLitActionCode } from "./swapActionGen.js";
import { runBtcEthSwapLitAction } from "./executeAction.js";
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
import * as bitcoin from "bitcoinjs-lib";
import axios from "axios";
import ECPair from "ecpair";
// const ECPair = require('ecpair');
import { toOutputScript } from "bitcoinjs-lib/src/address";

// to fix supporting functions: broadcastingTransaction, depositOnBitcoin, depositOnEVM, getFundsStatus
// to merge both the swap objects for ease of understanding

const ec = new EC("secp256k1");

const litNodeClient = new LitNodeClient({
    litNetwork: LitNetwork.DatilDev,
    debug: true,
});

let mintedPKP = {
        tokenId:
            "50202233540837129411155367829024341022546334492979792100268790842102423049011",
        publicKey:
            "0x040b670b840bdce35bd1d14e43757d443fefea38560a48f7bf768b94f1626cb9c3d211429983c6eeee626ea90db846bb76dbf378ccd3f7d0a6826ee25292aab40d",
        ethAddress: "0x6071623DFa2FaEf23E7b93f8AC535cE608326f75",
    },
    action_ipfs = "QmZDSFML4DmgiAbvab7neKbg57em3PZbG5jUZ2M2ThkMA2";

// swap params ------------------------------

// counterPartyAddress is _to address

// https://bitcoinfaucet.uo1.net/send.php drops 1000 sats
// https://blockstream.info/testnet

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

// main functions ----------------------------

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
    const btcFeeRate = 1;

    const originTime = Date.now();
    const signer = await getWalletEVM();

    const results = await runBtcEthSwapLitAction({
        pkpPublicKey: mintedPKP.publicKey,
        ipfsId: action_ipfs,
        sessionSig,
        signer,
        evmParams,
        btcParams,
        evmGasConfig,
        btcFeeRate,
        originTime,
    });
    console.log(results);
    
    if (results.signatures == undefined) {
        return;
    } else if (results.signatures.ethSignature == undefined) {
        console.log("executing clawback btc tx..");
        await broadcastBtcTransaction(results);
    } else if (results.signatures.btcSignature == undefined) {
        console.log("executing clawback eth tx..");
        await broadcastEVMTransaction(results, chainProvider);
    } else {
        console.log("executing swap txs..");
        await broadcastBtcTransaction(results);
        await broadcastEVMTransaction(results, chainProvider);
    }
}

async function broadcastBtcTransaction(results) {
    console.log("broadcasting on btc..");
    const tx = bitcoin.Transaction.fromHex(results.response.response.btcTransaction);
    
    const signatureBuffer = Buffer.from(results.signatures.btcSignature.signature.replace(/^0x/, ''), 'hex');
    const publicKeyBuffer = Buffer.from(mintedPKP.publicKey, 'hex');
    
    const scriptSig = bitcoin.script.compile([
        signatureBuffer,
        publicKeyBuffer,
    ]);

    tx.setInputScript(0, scriptSig);

    const signedTxHex = tx.toHex();
    console.log('Signed Transaction Hex:', signedTxHex);

    const result = await axios.post('https://blockstream.info/testnet/api/tx', signedTxHex, {
        headers: {
            'Content-Type': 'text/plain',
        },
    });

    console.log('Transaction Broadcast Result:', result.data);
}

async function broadcastEVMTransaction(results, chainProvider) {
    console.log("broadcasting on evm..");
    const signature = formatSignature(results.signatures.ethSignature);

    // console.log("tx obj", results.response.response.ethTransaction);

    const tx = await chainProvider.sendTransaction(
        ethers.utils.serializeTransaction(
            results.response.response.ethTransaction,
            signature
        )
    );
    const receipt = await tx.wait();
    const blockExplorer = LIT_CHAINS[evmParams.chain].blockExplorerUrls[0];

    console.log(`tx: ${blockExplorer}/tx/${receipt.transactionHash}`);
}

// additional functions ----------------------------

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

// btc address generation ----------------------------

export function generateBtcAddress(_evmPublicKey) {
    _evmPublicKey
        ? (ethPublicKey = ethPublicKey)
        : (ethPublicKey = mintedPKP.publicKey);

    const compressedPubKeyHex = compressPublicKey(_evmPublicKey);
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

export async function depositOnBitcoin(_bitcoin) {
    console.log("dropping some bitcoin..");
    let privateKey = process.env.NEXT_PUBLIC_PRIVATE_KEY;
    const amountInSats = 1000;

    if (!privateKey.startsWith("0x")) {
        privateKey = "0x" + privateKey;
    }
    const publicKey = ethers.utils.computePublicKey(privateKey);

    const btcAddressToFundFrom = generateBtcAddress(publicKey);
    console.log("btcAddressToFundFrom", btcAddressToFundFrom);

    const btcAddressToFundTo = generateBtcAddress(mintedPKP.publicKey);
    console.log("btcAddressToFundTo", btcAddressToFundTo);
    btcTransfer(btcAddressToFundFrom, btcAddressToFundTo, amountInSats);
}

export async function btcTransfer(
    btcAddressToFundFrom,
    btcAddressToFundTo,
    amountInSats
) {
    console.log("Creating BTC Transaction...");

    const utxoResponse = await axios.get(
        `https://blockstream.info/testnet/api/address/${btcAddressToFundFrom}/utxo`
    );
    console.log("my", btcAddressToFundFrom);

    const fetchUtxo = await utxoResponse.data;
    const utxoToSpend = fetchUtxo[0];
    console.log("utxoToSpend ", utxoToSpend);

    const transaction = new bitcoin.Transaction();

    const txidBuffer = Buffer.from(utxoToSpend.txid, "hex").reverse();
    transaction.addInput(txidBuffer, utxoToSpend.vout);

    const scriptPubKey = bitcoin.address.toOutputScript(
        btcAddressToFundTo,
        bitcoin.networks.testnet
    );
    const amountInSatsBigInt = BigInt(amountInSats);
    transaction.addOutput(scriptPubKey, amountInSatsBigInt);

    console.log("transaction ", transaction);

    let privateKey = process.env.NEXT_PUBLIC_PRIVATE_KEY;

    const keyPair = ec.keyFromPrivate(privateKey.slice(2), "hex");

    // const ecpair = ECPair.ECPairFactory(bitcoin.crypto);
    // const keyPair = ecpair.fromPrivateKey(
    //     Buffer.from(privateKey.slice(2), "hex"),
    //     { compressed }
    // );

    // sign tx

    const broadcastResponse = await axios.post(
        "https://blockstream.info/testnet/api/tx",
        btcSuccessTransaction.toHex()
    );

    console.log("Transaction broadcasted successfully!");
    console.log("Transaction ID:", broadcastResponse.data);
}

export async function getFundsStatusPKP(_action_ipfs, _mintedPKP) {
    // _action_ipfs ? (action_ipfs = _action_ipfs) : null;
    // _mintedPKP ? (mintedPKP = _mintedPKP) : null;

    console.log("checking balances on pkp..");

    const btcAddressToFundFrom = generateBtcAddress(mintedPKP.pubkey);
    console.log("btcAddressToFundFrom", btcAddressToFundFrom);

    const utxoResponse = await axios.get(
        `https://blockstream.info/testnet/api/address/${btcAddressToFundFrom}/utxo`
    );
    console.log("Funds on BTC", utxoResponse.data[0].value);

    const abi = [
        {
            inputs: [
                {
                    internalType: "address",
                    name: "account",
                    type: "address",
                },
            ],
            name: "balanceOf",
            outputs: [
                {
                    internalType: "uint256",
                    name: "",
                    type: "uint256",
                },
            ],
            stateMutability: "view",
            type: "function",
        },
    ];

    const chainProvider = new ethers.providers.JsonRpcProvider(
        LIT_RPC.CHRONICLE_YELLOWSTONE
    );

    const contract = new ethers.Contract(
        "0x6428b9170f12eac6aba3835775d2bf27e2d6ead4",
        abi,
        chainProvider
    );

    console.log("mintedPKP.ethAddress on evm: ", mintedPKP.ethAddress);
    const bal_EVM = await contract.balanceOf(mintedPKP.ethAddress);
    const balanceInTokens_EVM = ethers.utils.formatUnits(bal_EVM, 18);
    console.log("balance on evm: ", balanceInTokens_EVM);
}

// export async function btcTransferr(
//     btcAddressToFundFrom,
//     btcAddressToFundTo,
//     amountInSats
// ) {
//     console.log("Dropping some Bitcoin...");
//     const network = bitcoin.networks.testnet;

//     const utxosResponse = await axios.get(
//         `https://blockstream.info/testnet/api/address/${btcAddressToFundFrom}/utxo`
//     );
//     const utxos = utxosResponse.data;

//     if (utxos.length === 0) {
//         console.log("No UTXOs available for the source address.");
//         return;
//     }

//     const utxoToSpend = fetchUtxo[0];
//     if (utxoToSpend.value !== amountInSats) {
//         console.log("Not enough sats.");
//         return;
//     }

//     bitcoin.address.toOutputScript(btcAddressToFundTo, network);

//     const psbt = new bitcoin.Psbt({ network });
//     let inputAmount = 0;

//     for (const utxo of utxos) {
//         const txResponse = await axios.get(
//             `https://blockstream.info/testnet/api/tx/${utxo.txid}/hex`
//         );
//         const rawTx = txResponse.data;

//         psbt.addInput({
//             hash: utxo.txid,
//             index: utxo.vout,
//             nonWitnessUtxo: Buffer.from(rawTx, "hex"),
//         });

//         inputAmount += utxo.value;
//         if (inputAmount >= amountInSats) {
//             break;
//         }
//     }

//     let change = inputAmount - amountInSats;
//     const dustThreshold = 546;
//     let outputCount = change > dustThreshold ? 2 : 1;
//     const inputCount = psbt.inputCount;
//     let txSize = inputCount * 180 + outputCount * 34 + 10 + inputCount;
//     const feeRate = 1;
//     let fee = txSize * feeRate;
//     change = inputAmount - amountInSats - fee;

//     if (change <= dustThreshold) {
//         change = 0;
//         outputCount = 1;
//         txSize = inputCount * 180 + outputCount * 34 + 10 + inputCount;
//         fee = txSize * feeRate;
//         change = inputAmount - amountInSats - fee;
//     }

//     if (change < 0) {
//         console.log("Not enough balance to cover the amount and fee.");
//         return;
//     }

//     psbt.addOutput({
//         address: btcAddressToFundTo,
//         value: amountInSats,
//     });

//     psbt.addOutput({
//         address: btcAddressToFundFrom,
//         value: change,
//     });

//     const ecpair = ECPair.ECPairFactory(bitcoin.crypto);
//     const keyPair = ecpair.fromPrivateKey(
//         Buffer.from(privateKey.slice(2), "hex"),
//         { compressed }
//     );

//     psbt.signAllInputs(keyPair);

//     if (!psbt.validateSignaturesOfAllInputs()) {
//         console.error("Invalid signatures");
//         return;
//     }

//     psbt.finalizeAllInputs();
//     const txHex = psbt.extractTransaction().toHex();

//     // Broadcast the transaction
//     const broadcastResponse = await axios.post(
//         "https://blockstream.info/testnet/api/tx",
//         txHex
//     );

//     console.log("Transaction broadcasted successfully!");
//     console.log("Transaction ID:", broadcastResponse.data);
// }