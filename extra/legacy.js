
import * as ecc from "@bitcoin-js/tiny-secp256k1-asmjs";
import * as bitcoin from "bitcoinjs-lib";
import pkg from "elliptic";
const { ec: EC } = pkg;
import { ethers } from "ethers";
import { ECPairFactory } from "ecpair";
const ECPair = ECPairFactory(ecc);
import { LitNetwork, LIT_RPC } from "@lit-protocol/constants";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import { LitNodeClient } from "@lit-protocol/lit-node-client";
import { LitAbility } from "@lit-protocol/types";
import {
    LitActionResource,
    createSiweMessageWithRecaps,
    generateAuthSig,
    LitPKPResource,
} from "@lit-protocol/auth-helpers";
import BN from "bn.js";
import * as bip66 from "bip66";

// This code uses PSBT class to sign using local private key and broadcast the segwit transaction

// let privateKey = process.env.NEXT_PUBLIC_PRIVATE_KEY
let privateKey0 =
    "d653763be1854048e1a70dd9fc94d47c09c790fb1530a01ee65257b0b698c352";
let privateKey1 =
    "e36a688fe085087299ea6225c6be269f05d1f2e63bfe00d41c1627a826c69789";
let privateKey3 = "a169b38267e4134dc2413ca0eb29cc27a6e80e6a412855a839cfb81e342da950"
let publicKeyRecipient =
    "0x040b670b840bdce35bd1d14e43757d443fefea38560a48f7bf768b94f1626cb9c3d211429983c6eeee626ea90db846bb76dbf378ccd3f7d0a6826ee25292aab40d";

    let litPkp = {
        tokenId:
            "0xb03486223f48c251359cc2c65cccc43073f254cac435f1935cf17fcc246bfd7b",
        publicKey:
            "04fd46fd7848ca49322067b065bad8c878ed45b624df1d44907f0a7182f4cf19baee75f74e30a26a5da7883fd6500b9e74afc7fd40908bd6779cb14a87a471146f",
        ethAddress: "0x3091b1D968d3D1c4971F5fa03136f34d6b9377e0",
    };

// sendTxAllUTXO()
sendTxSelectedUTXO();

// https://coinfaucet.eu/en/btc-testnet/
// address generation p2pkh for testnet
function generateBtcAddressP2PKH(publicKey) {
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

function computePublicKey(privateKey) {
    if (!privateKey.startsWith("0x")) {
        privateKey = "0x" + privateKey;
    }
    return ethers.utils.computePublicKey(privateKey);
}

// sends last utxo's remain to the recipient address
export async function sendTxSelectedUTXO() {
    console.log("minting pkp...");
    const provider = new ethers.providers.JsonRpcProvider(
        LIT_RPC.CHRONICLE_YELLOWSTONE
    );
    let litNetwork = LitNetwork.DatilDev;
    let wallet = new ethers.Wallet(privateKey0, provider);
    let pkp = litPkp

    // const publicKeySender = computePublicKey(privateKey0);
    // console.log("publicKeySender", publicKeySender);
    // const senderAddress = generateBtcAddressP2PKH(publicKeySender);
    // const recipientAddress = "mmnxChcUSLdPGuvSmkpUr7ngrNjfTYKcRq";
    const senderAddress = generateBtcAddressP2PKH(pkp.publicKey);
    const recipientAddress = "mnhBhEcD1dCHbxhRPPHsESM5hPZpu7Mbzw"
    // const Btc_Endpoint = "https://mempool.space";
    const Btc_Endpoint = "https://blockstream.info";
    const amount = BigInt(600);
    const network = bitcoin.networks.testnet;
    
    const endpoint = `${Btc_Endpoint}/testnet/api/address/${senderAddress}/utxo`;
    const result = await fetch(endpoint);
    const utxos = await result.json();
    const selectedUtxo = utxos[0];

    const txEndpoint = `${Btc_Endpoint}/testnet/api/tx/${selectedUtxo.txid}`;
    const txResult = await fetch(txEndpoint);
    const txData = await txResult.json();
    const output = txData.vout[selectedUtxo.vout];
    const scriptPubKey = output.scriptpubkey;
    
    console.log("utxos", utxos);
    console.log("selectedUtxo", selectedUtxo);
    console.log("pkp btc address", senderAddress);
    console.log("recipient btc address", recipientAddress);
    console.log("scriptPubKeyHex", scriptPubKey);

    if (BigInt(selectedUtxo.value) - amount < 0) {
        throw new Error("Insufficient funds");
    }

    const p2pkh = bitcoin.payments.p2pkh({
        address: senderAddress,
        network: network,
    });

    const tx = new bitcoin.Transaction();
    tx.version = 2;

    tx.addInput(Buffer.from(selectedUtxo.txid, "hex").reverse(), selectedUtxo.vout);
    tx.addOutput(
      bitcoin.address.toOutputScript(recipientAddress, network),
      amount
    );
    const scriptPubKeyBuffer = Buffer.from(scriptPubKey, "hex");

    const sighash = tx.hashForSignature(
      0,
      bitcoin.script.compile(scriptPubKeyBuffer),
      bitcoin.Transaction.SIGHASH_ALL
    );

    const txHex = tx.toHex();
    
    const res = await signWithLit(sighash, pkp, litNetwork, wallet);
    const btcSignature = res.signatures.sig;
    const signedTx = combineSignAndrew(txHex, btcSignature, sighash);
    console.log("Unsigned transaction: ", txHex);
    console.log("Signed transaction: ", signedTx);

    const broadcastResponse = await fetch(`${Btc_Endpoint}/testnet/api/tx`, {
        method: "POST",
        headers: {
            "Content-Type": "text/plain",
        },
        body: signedTx,
    });

    const txid = await broadcastResponse.text();
    console.log("Transaction broadcast successfully. TXID:", txid);

    
}

function combineSignAndrew(rawTxHex, btcSignature) {

    let r = Buffer.from(btcSignature.r, "hex");
    let s = Buffer.from(btcSignature.s, "hex");
    let rBN = new BN(r);
    let sBN = new BN(s);

    const secp256k1 = new EC("secp256k1");
    const n = secp256k1.curve.n;

    if (sBN.cmp(n.divn(2)) === 1) {
      sBN = n.sub(sBN);
    }

    r = rBN.toArrayLike(Buffer, "be", 32);
    s = sBN.toArrayLike(Buffer, "be", 32);

    function ensurePositive(buffer) {
      if (buffer[0] & 0x80) {
        const newBuffer = Buffer.alloc(buffer.length + 1);
        newBuffer[0] = 0x00;
        buffer.copy(newBuffer, 1);
        return newBuffer;
      }
      return buffer;
    }

    r = ensurePositive(r);
    s = ensurePositive(s);

    let derSignature;
    try {
      derSignature = bip66.encode(r, s);
    } catch (error) {
      console.error("Error during DER encoding:", error);
      throw error;
    }
    console.log("✅ Signature converted");

    const witnessStack = [derSignature, Buffer.from(btcSignature.publicKey, "hex")];

    const tx = bitcoin.Transaction.fromHex(rawTxHex);
    // tx.setWitness(0, witnessStack);

    const signatureWithHashType = Buffer.concat([
      derSignature,
      Buffer.from([bitcoin.Transaction.SIGHASH_ALL]),
    ]);

    const scriptSig = bitcoin.script.compile([
      signatureWithHashType,
      Buffer.from(btcSignature.publicKey, "hex"),
    ]);

    tx.setInputScript(0, scriptSig);

    return tx.toHex();
}


async function signWithLit(_dataToSign, pkp, _network, _wallet) {
    console.log("executing on nodes..");

    let capacityDelegationAuthSig;
    if (_network != LitNetwork.DatilDev) {
        capacityDelegationAuthSig = await mintAndDelegateCapacityCredit(
            _wallet,
            _network,
            pkp.ethAddress
        );
    }

    const sessionSigs = await sessionSigEOA(
        _wallet,
        _network,
        capacityDelegationAuthSig
    );

    const litNodeClient = new LitNodeClient({
        litNetwork: _network,
    });

    await litNodeClient.connect();

    const litAction = `(async () => {
        const sigShare = await LitActions.signEcdsa({
            toSign: dataToSign,
            publicKey,
            sigName: "sig",
        });
    })();`;

    console.log("executing..", litAction);

    const results = await litNodeClient.executeJs({
        code: litAction,
        sessionSigs: sessionSigs,
        jsParams: {
            publicKey: pkp.publicKey,
            dataToSign: _dataToSign
        },
    });

    await litNodeClient.disconnect();

    console.log("executeJs results: ", results);
    return results;
}

async function sessionSigEOA(
    _signer,
    _network,
    _capacityDelegationAuthSig
) {
    const litNodeClient = new LitNodeClient({
        litNetwork: _network,
        debug: false,
    });

    await litNodeClient.connect();
    let sessionSigs;

    if (_network != LitNetwork.DatilDev) {
        if (!_capacityDelegationAuthSig) {
            throw new Error("Capacity Delegation Auth Sig is required");
        }
        sessionSigs = await litNodeClient.getSessionSigs({
            chain: "ethereum",
            capabilityAuthSigs: [_capacityDelegationAuthSig],
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
                    walletAddress: await _signer.getAddress(),
                    nonce: await litNodeClient.getLatestBlockhash(),
                    litNodeClient: litNodeClient,
                    domain: "localhost:3000",
                });

                return await generateAuthSig({
                    signer: _signer,
                    toSign,
                });
            },
        });
    } else {
        sessionSigs = await litNodeClient.getSessionSigs({
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
                    walletAddress: await _signer.getAddress(),
                    nonce: await litNodeClient.getLatestBlockhash(),
                    litNodeClient: litNodeClient,
                    domain: "localhost:3000",
                });

                return await generateAuthSig({
                    signer: _signer,
                    toSign,
                });
            },
        });
    }

    await litNodeClient.disconnect();

    return sessionSigs;
}

async function mintAndDelegateCapacityCredit(
    _wallet,
    _network,
    _pkpEthAddress
) {
    const litContractClient = new LitContracts({
        signer: _wallet,
        network: _network,
    });

    await litContractClient.connect();

    const capacityCreditInfo = await litContractClient.mintCapacityCreditsNFT({
        requestsPerKilosecond: 1000,
        daysUntilUTCMidnightExpiration: 2,
    });

    const litNodeClient = new LitNodeClient({
        litNetwork: _network,
        debug: false,
    });
    await litNodeClient.connect();

    const { capacityDelegationAuthSig } =
        await litNodeClient.createCapacityDelegationAuthSig({
            dAppOwnerWallet: _wallet,
            capacityTokenId: capacityCreditInfo.capacityTokenIdStr,
            delegateeAddresses: [_pkpEthAddress],
            uses: "1000",
        });
    console.log("✅ Capacity Delegation Auth Sig created");

    await litNodeClient.disconnect();

    return capacityDelegationAuthSig;
}
