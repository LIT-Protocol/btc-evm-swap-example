import { generateBtcEthSwapLitActionCode } from "./swapActionGen.js";
import { runBtcEthSwapLitAction } from "./executeAction.js";
import { LitNodeClient } from "@lit-protocol/lit-node-client";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import {
    LitNetwork,
    AuthMethodType,
    AuthMethodScope,
    LIT_CHAINS,
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
import { ec as EC } from 'elliptic';
import * as bitcoin from 'bitcoinjs-lib';

const ec = new EC('secp256k1');

const litNodeClient = new LitNodeClient({
    litNetwork: LitNetwork.DatilDev,
    debug: true,
});

let mintedPKP = {
        tokenId:
            "112659976102653126523906220316122545650355833723158215223027097658460908065367",
        publicKey:
            "0x049f880805eba31a67b2a7e2f3342cd2d1ee2afc87f97110fe255cb0f751b88bd59766acec20bd3bc7415c3d471ab65e8f1126fe9f2a1dae06498fd52f846f41f8",
        ethAddress: "0x8884Af4F490fCa7Fa1ef0E467F1DB227b895024e",
    },
    action_ipfs = "QmVzE8WZpV9UnJMgHUwke9esoX4p2fF8du5f8K2MwbdF3w";

// swap params ------------------------------

const btcParams = {
    counterPartyAddress:
        "tb1pdj2gvzymxtmcrs5ypm3pya8vc3h4fkk2g9kmav0j6skgruez88rs9f4zya",
    network: "testnet",
    value: 8000,
    ethAddress: "0xE1b89ef648A6068fb4e7bCd943E3a9f4Dc5c530b",
};

const evmParams = {
    counterPartyAddress: "0x9A6687E110186Abedf287085Da1f9bdD4d90D858",
    chain: "ethereum",
    amount: "1",
    btcAddress:
        "tb1pg3vxcftwr5af70k34z0ae7g7xevzmtzccdfew4n4f4hf3al0xkvs98y7k9",
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
                // maxFeePerGas: ethers.BigNumber.from("3800000000"),
                // gasLimit: "2100000",
                // maxFeePerGas: "10000000000", // in wei
                // maxPriorityFeePerGas: "400000000", // in wei
                // gasLimit: "21000"
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

export async function depositOnEVM() {}

export async function depositOnBTC() {}

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

    const originTime = Date.now();

    const btcFeeRate = 10;
    const isEthClawback = false;

    const res = await runBtcEthSwapLitAction({
        pkpPublicKey: mintedPKP.publicKey,
        action_ipfs,
        sessionSig,
        evmGasConfig,
        btcFeeRate,
        evmParams,
        btcParams,
        isEthClawback,
        originTime,
    });
    console.log(res);
}

// helper functions ----------------------------

async function getWalletEVM() {
    const provider = new ethers.providers.JsonRpcProvider(
        `https://yellowstone-rpc.litprotocol.com/`
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


// btc address ----------------------------

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
    ethPublicKey ? (ethPublicKey = ethPublicKey) : (ethPublicKey = mintedPKP.publicKey);
    const compressedPubKeyHex = compressPublicKey(ethPublicKey);
    const compressedPubKey = Buffer.from(compressedPubKeyHex, 'hex');

    const { address } = bitcoin.payments.p2pkh({
        pubkey: compressedPubKey,
        network: bitcoin.networks.testnet,
    });

    if (!address) throw new Error("Could not generate address");
    return address;
}