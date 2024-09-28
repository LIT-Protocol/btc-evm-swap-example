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
import BN from "bn.js";
import * as bip66 from "bip66";
import * as crypto from "crypto";

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

export function generateBtcAddressP2PKH(_mintedPKP) {
    _mintedPKP ? (mintedPKP = _mintedPKP) : null;
    let publicKey = _mintedPKP.publicKey;
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


async function prepareBtcTransaction({
    recipientAddress,
    senderAddress,
    fee,
}) {
    const endpoint = `${Btc_Endpoint}/testnet/api/address/${senderAddress}/utxo`;
    const result = await fetch(endpoint);
    const utxos = await result.json();
    const selectedUtxo = utxos[0];

    const txEndpoint = `${Btc_Endpoint}/testnet/api/tx/${selectedUtxo.txid}`;
    const txResult = await fetch(txEndpoint);
    const txData = await txResult.json();
    const output = txData.vout[selectedUtxo.vout];
    const scriptPubKey = output.scriptpubkey;

    const amount = BigInt(selectedUtxo.value) - fee;


    if (amount < 0) {
        throw new Error("Insufficient funds");
    }

    const tx = new bitcoin.Transaction();
    tx.version = 2;

    tx.addInput(Buffer.from(selectedUtxo.txid, "hex").reverse(), selectedUtxo.vout);
    tx.addOutput(
      bitcoin.address.toOutputScript(recipientAddress, network),
      amount
    );
    const scriptPubKeyBuffer = Buffer.from(scriptPubKey, "hex");

    const sigHash = tx.hashForSignature(
      0,
      bitcoin.script.compile(scriptPubKeyBuffer),
      bitcoin.Transaction.SIGHASH_ALL
    );

    const txHex = tx.toHex();

    return { transaction: txHex, transactionHash: sigHash };
}

export async function runLitAction(_action_ipfs, _mintedPKP) {
    _action_ipfs ? (action_ipfs = _action_ipfs) : null;
    _mintedPKP ? (mintedPKP = _mintedPKP) : null;
    console.log("executing lit action..");

    const pkpBtcAddress = generateBtcAddressP2PKH(mintedPKP);
    const btcFeeRate = BigInt(300);

    const {
        transaction: btcSuccessTransactionHex,
        transactionHash: successHash,
    } = await prepareBtcTransaction({
        utxo: firstUtxo,
        recipientAddress: evmParams.btcAddress,
        fee: btcFeeRate,
        pkpBtcAddress,
    });

    console.log("btcSuccessTransaction", btcSuccessTransactionHex, successHash);

    const {
        transaction: btcClawbackTransactionHex,
        transactionHash: clawbackHash,
    } = await prepareBtcTransaction({
        utxo: firstUtxo,
        recipientAddress: btcParams.counterPartyAddress,
        fee: btcFeeRate,
        pkpBtcAddress,
    });

    console.log("btcClawbackTransactionHex", btcClawbackTransactionHex, clawbackHash);

    const sessionSig = await sessionSigEOA();

    const chainProvider = new ethers.providers.JsonRpcProvider(
        LIT_CHAINS[evmParams.chain].rpcUrls[0]
    );

    const evmGasConfig = {
        maxFeePerGas: ethers.BigNumber.from("1500000000"),
        chainId: LIT_CHAINS[evmParams.chain].chainId,
        nonce: await chainProvider.getTransactionCount(mintedPKP.ethAddress),
    };

    const originTime = Date.now();
    const signer = await getWalletEVM();
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
            originTime,
            BTC_ENDPOINT: Btc_Endpoint,
            // passedFirstUtxo: firstUtxo,
            passedInUtxo: firstUtxo,
            ethGasConfig: evmGasConfig,
            btcFeeRate: btcFeeRate,
            successHash: successHash,
            clawbackHash: clawbackHash,
            successTxHex: btcSuccessTransactionHex,
            clawbackTxHex: btcClawbackTransactionHex,
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

    // construct signed transaction object

    const broadcastResponse = await fetch(`${Btc_Endpoint}/testnet/api/tx`, {
        method: "POST",
        headers: {
            "Content-Type": "text/plain",
        },
        body: signedTxHex,
    });

    const txid = await broadcastResponse.text();
    console.log("Transaction broadcast successfully. TXID:", txid);
}

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

// supporting functions ----------------------------

export async function depositOnEVM() {
    _action_ipfs ? (action_ipfs = _action_ipfs) : null;
    _mintedPKP ? (mintedPKP = _mintedPKP) : null;

    console.log(
        `deposit started from wallet A on chain A (${chainAParams.chain})..`
    );
    let wallet = await getWallet();

    const chainAProvider = new ethers.providers.JsonRpcProvider(
        LIT_CHAINS[chainAParams.chain].rpcUrls[0]
    );
    wallet = wallet.connect(chainAProvider);

    // sometimes you may need to add gasLimit
    const transactionObject = {
        to: chainAParams.tokenAddress,
        from: await wallet.getAddress(),
        data: generateCallData(
            mintedPKP.ethAddress,
            ethers.utils
                .parseUnits(chainAParams.amount, chainAParams.decimals)
                .toString()
        ),
    };

    const tx = await wallet.sendTransaction(transactionObject);
    const receipt = await tx.wait();

    console.log("token deposit executed: ", receipt);

    console.log("depositing some funds for gas..");

    // gas value differs for chains, check explorer for more info
    const transactionObject2 = {
        to: mintedPKP.ethAddress,
        value: ethers.BigNumber.from("1000000000000000"),
        gasPrice: await chainAProvider.getGasPrice(),
    };

    const tx2 = await wallet.sendTransaction(transactionObject2);
    const receipt2 = await tx2.wait();

    console.log("gas deposit executed: ", receipt2);
}
