import { YachtLitSdk } from "lit-swap-sdk";
import { ethers } from "ethers";

let actionCode = "";
let mintedPKP = {};

createLitAction()

async function instantiateYatch() {
    const privateKey = "d653763be1854048e1a70dd9fc94d47c09c790fb1530a01ee65257b0b698c352"
    const provider = new ethers.providers.JsonRpcProvider(
        `https://yellowstone-rpc.litprotocol.com/`
    );
    const wallet = new ethers.Wallet(privateKey, provider);

    const yacht = new YachtLitSdk({
        signer: wallet,
        // pkpContractAddress: "",
        btcTestNet: true,
        btcApiEndpoint: "https://blockstream.info",
    });

    return yacht;
}

export async function createLitAction() {
    const yacht = await instantiateYatch();

    const btcParams = {
        counterPartyAddress:
            "tb1pdj2gvzymxtmcrs5ypm3pya8vc3h4fkk2g9kmav0j6skgruez88rs9f4zya",
        network: "testnet", // "testnet" | "mainnet"
        value: 8000, // in sats
        ethAddress: "0xE1b89ef648A6068fb4e7bCd943E3a9f4Dc5c530b", // this is the evm address the counterparty will send to
    };

    const ethParams = {
        counterPartyAddress: "0x9A6687E110186Abedf287085Da1f9bdD4d90D858",
        chain: "ethereum",
        amount: "1", // in native EVM i.e. this corresponds to 1 ETH
        btcAddress:
            "tb1pg3vxcftwr5af70k34z0ae7g7xevzmtzccdfew4n4f4hf3al0xkvs98y7k9", // this is the btc address the counterparty will send to
    };

    const litActionCode = await yacht.generateBtcEthSwapLitActionCode(
        btcParams,
        ethParams
    );

    actionCode = litActionCode;
    console.log("Lit Action code: ", litActionCode);
}

export async function mintGrantBurnPKP() {
    const yacht = await instantiateYatch();

    const ipfsCID = await yacht.getIPFSHash(actionCode);
    const pkpInfo = await yacht.mintGrantBurnWithLitAction(ipfsCID);
    mintedPKP = pkpInfo;
    console.log("Mint Grant Burn PKP with prev action:", pkpInfo);
}

export async function bridge() {
    const yacht = await instantiateYatch();

    const evmProvider = new ethers.providers.JsonRpcProvider(
        "https://yellowstone-rpc.litprotocol.com"
    );

    const result = await yacht.runBtcEthSwapLitAction({
        // mintedPKP.publicKey,
        actionCode,
        btcParams,
        ethParams,
        btcFeeRate: 10, // fee rate in sats per vbyte
        ethGasConfig: {
            maxFeePerGas: "100000000000", // in wei
            maxPriorityFeePerGas: "40000000000", // in wei
            gasLimit: "21000",
        },
    });

    await evmProvider.sendTransaction(
        ethers.utils.serializeTransaction(
            response.response.ethTransaction,
            response.signatures.ethSignature
        )
    );

    await yacht.broadcastBtcTransaction(response.signature.btcTransaction);
}
