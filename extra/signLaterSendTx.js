
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


const ec = new EC("secp256k1");
bitcoin.initEccLib(ecc);

import * as bip66 from "bip66";
import * as crypto from "crypto";
import BN from "bn.js";

let privateKey =
    "d653763be1854048e1a70dd9fc94d47c09c790fb1530a01ee65257b0b698c352";
let publicKeyRecipient =
    "0x040b670b840bdce35bd1d14e43757d443fefea38560a48f7bf768b94f1626cb9c3d211429983c6eeee626ea90db846bb76dbf378ccd3f7d0a6826ee25292aab40d";

let litPkp = {
    "tokenId": "0xb03486223f48c251359cc2c65cccc43073f254cac435f1935cf17fcc246bfd7b",
    "publicKey": "04fd46fd7848ca49322067b065bad8c878ed45b624df1d44907f0a7182f4cf19baee75f74e30a26a5da7883fd6500b9e74afc7fd40908bd6779cb14a87a471146f",
    "ethAddress": "0x3091b1D968d3D1c4971F5fa03136f34d6b9377e0"
}

let sig = {
    "r": "02097192920a30117d13ee5678ec12d50094d67db5cdb7daf31709dadc8f9b63",
    "s": "6dfeff3813dcf07fcc063d6cda04c73c1a8dfc086746b766cdc912aa1dd931bf",
    "recid": 0,
    "signature": "0x02097192920a30117d13ee5678ec12d50094d67db5cdb7daf31709dadc8f9b636dfeff3813dcf07fcc063d6cda04c73c1a8dfc086746b766cdc912aa1dd931bf1b",
    "publicKey": "04FD46FD7848CA49322067B065BAD8C878ED45B624DF1D44907F0A7182F4CF19BAEE75F74E30A26A5DA7883FD6500B9E74AFC7FD40908BD6779CB14A87A471146F",
    "dataSigned": "E0B580074CE38FCE68CB16C8FBE8AAAE0F2EFDA9ACDEE244201190498AE0233A"
}

createRawTransaction();
// fetchUtxo()

// sending from mpc key on lit to a btc address
export async function createRawTransaction() {
    console.log("minting pkp...");
    const provider = new ethers.providers.JsonRpcProvider(
        LIT_RPC.CHRONICLE_YELLOWSTONE
    );
    let _network = LitNetwork.DatilDev;
    let _wallet = new ethers.Wallet(
        privateKey,
        provider
    );
    // const pkp = await mintPKP(_wallet, _network);
    const pkp = litPkp;
    console.log(pkp)

    console.log("Creating raw transaction...");
    if (!privateKey.startsWith("0x")) {
        privateKey = "0x" + privateKey;
    }

    const senderAddress = generateBtcAddressBech32(pkp.publicKey);
    console.log("pkp btc address", senderAddress)
    // const recipientAddress = generateBtcAddressBech32(
    //     ethers.utils.computePublicKey(privateKey)
    // );
    const recipientAddress = "tb1qmz9zpxjzcqdym2ahyvlvjqkrtuzdh7q8m7xl74"
    // const Btc_Endpoint = "https://mempool.space";
    const Btc_Endpoint = "https://blockstream.info";
    const network = bitcoin.networks.testnet;
    
    const endpoint = `${Btc_Endpoint}/testnet/api/address/${senderAddress}/utxo`;
    const result = await fetch(endpoint);
    const utxos = await result.json();
    const selectedUtxo = utxos[0];
    console.log("utxos", utxos);
    console.log("selectedUtxo", selectedUtxo); 
    
    const amount = BigInt(1000);
    // const fee = BigInt(500);
    // const inputAmount = BigInt(selectedUtxo.value) - fee; 
    // const totalInput = BigInt(utxos.reduce((sum, utxo) => sum + utxo.value, 0));
    
    if (BigInt(selectedUtxo.value) - amount < 0) {
        throw new Error("Insufficient funds");
    }

    const psbt = new bitcoin.Psbt({ network });

    const p2wpkh = bitcoin.payments.p2wpkh({
        address: senderAddress,
        network: network,
    });

    psbt.addInput({
        hash: selectedUtxo.txid,
        index: selectedUtxo.vout,
        witnessUtxo: {
            script: p2wpkh.output,
            value: BigInt(selectedUtxo.value)
        },
    });

    psbt.addOutput({
        address: recipientAddress,
        value: amount,
    });

    const tx = psbt.__CACHE.__TX;
    const sighash = tx.hashForWitnessV0(
        0,
        p2wpkh.output,
        BigInt(selectedUtxo.value),
        bitcoin.Transaction.SIGHASH_ALL
    );

    const txHex = psbt.data.globalMap.unsignedTx.tx.toHex();
    console.log("Unsigned transaction: ", txHex);

    const res = await signWithLit(sighash, pkp, _network, _wallet);
    const btcSignature = res.signatures.sig;
    // const btcSignature = sig;
    const signedTx = combineSignAndrew(txHex, btcSignature, sighash);
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

function combineSignature(rawTxHex, btcSignature) {
    const tx = bitcoin.Transaction.fromHex(rawTxHex);

    const secp256k1 = new EC("secp256k1");
    const n = secp256k1.curve.n;

    // Convert r and s to Buffers
    let r = Buffer.from(btcSignature.r, 'hex');
    let s = Buffer.from(btcSignature.s, 'hex');

    // Ensure that r is positive
    if (r[0] & 0x80) {
        r = Buffer.concat([Buffer.from([0]), r]);
    }

    // Ensure s is low (as required by Bitcoin)
    const maxS = Buffer.from(secp256k1.curve.n);
    if (s.compare(maxS.div(2)) > 0) {
        s = Buffer.from(secp256k1.curve.n.sub(s).toArray('be', 32));
    }

    // Encode signature in DER format using bip66
    const derSignature = bip66.encode(r, s);

    // Append SIGHASH_ALL byte to the signature
    const lowS = Buffer.concat([derSignature, Buffer.from([bitcoin.Transaction.SIGHASH_ALL])]);

    // Create the witness stack
    const witnessStack = [
        lowS, // DER-encoded signature + SIGHASH_ALL
        btcSignature.publicKey // Corresponding public key
    ];

    tx.setWitness(0, witnessStack);

    return tx.toHex();
}

function generateBtcAddressBech32(pubKeyHex) {
    if (pubKeyHex.startsWith("0x") || pubKeyHex.startsWith("0X")) {
        pubKeyHex = pubKeyHex.slice(2);
    }
    const keyPair = ec.keyFromPublic(pubKeyHex, "hex");
    const compressedPubKeyHex = keyPair.getPublic(true, "hex");
    const compressedPubKey = Buffer.from(compressedPubKeyHex, "hex");

    const { address } = bitcoin.payments.p2wpkh({
        pubkey: compressedPubKey,
        network: bitcoin.networks.testnet,
    });

    if (!address) throw new Error("Could not generate address");
    return address;
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
    tx.setWitness(0, witnessStack);

    // console.log("🔄 Setting the input script...");
    // const signatureWithHashType = Buffer.concat([
    //   derSignature,
    //   Buffer.from([bitcoin.Transaction.SIGHASH_ALL]),
    // ]);

    // const scriptSig = bitcoin.script.compile([
    //   signatureWithHashType,
    //   Buffer.from(btcSignature.publicKey, "hex"),
    // ]);

    // tx.setInputScript(0, scriptSig);
    // console.log("✅ Input script set");

    // console.log("sign",tx.toHex());

    return tx.toHex();
}

async function combineSignWithPSBT(rawTxHex, btcSignature) {
    const psbt = bitcoin.Psbt.fromHex(rawTxHex, { network: bitcoin.networks.testnet });
    const { r, s, publicKey, dataSigned } = btcSignature;

    const rBuffer = Buffer.from(r, 'hex');
    const sBuffer = Buffer.from(s, 'hex');

    const signature = Buffer.concat([rBuffer, sBuffer]);

    const pubKeyBuffer = Buffer.from(publicKey, 'hex');
    const compressedPubKey = ECPair.fromPublicKey(pubKeyBuffer, { compressed: true }).publicKey;

    psbt.addSignature(0, {
        publicKey: compressedPubKey,
        signature: Buffer.concat([signature, Buffer.from([bitcoin.Transaction.SIGHASH_ALL])])
    });

    const isValid = psbt.validateSignaturesOfInput(0);
    if (!isValid) {
        throw new Error("Signature validation failed");
    }

    psbt.finalizeInput(0);
    const signedTx = psbt.extractTransaction().toHex();
    return signedTx
}

async function combineSignYacht(
    rawTxHex,
    btcSignature,
    hashForSig,
) {
    const { r, s, publicKey, dataSigned } = btcSignature;

    const compressedPoint = ecc.pointCompress(
        Buffer.from(publicKey, "hex"),
        true
    );
    const signature = Buffer.from(r + s, "hex");

    const validSignature = validator(
        Buffer.from(compressedPoint),
        hashForSig,
        signature
    );
    if (!validSignature) throw new Error("Invalid signature");

    const compiledSignature = bitcoin.script.compile([
        bitcoin.script.signature.encode(
            signature,
            bitcoin.Transaction.SIGHASH_ALL
        ),
        Buffer.from(compressedPoint.buffer),
    ]);

    const transaction = bitcoin.Transaction.fromHex(rawTxHex);
    transaction.setInputScript(0, compiledSignature);

    return transaction.toHex();
}


const validator = (
    pubkey,
    msghash,
    signature,
  ) => ECPair.fromPublicKey(pubkey).verify(msghash, signature);

// https://bitcoinfaucet.uo1.net/send.php
// address generation segwit for testnet


async function fetchUtxo() {
    const Btc_Endpoint = "https://blockstream.info";
    // const Btc_Endpoint = "https://mempool.space";
    if (!privateKey.startsWith("0x")) {
        privateKey = "0x" + privateKey;
    }
    const senderAddress = generateBtcAddressBech32(publicKeyRecipient);
    const endpoint = `${Btc_Endpoint}/testnet/api/address/${senderAddress}/utxo`;
    const result = await fetch(endpoint);
    const utxos = await result.json();
    console.log(utxos);
}



async function mintPKP(_signer, _network) {
    const litContracts = new LitContracts({
        signer: _signer,
        network: _network,
        debug: false,
    });

    await litContracts.connect();

    const mintedPkp = await litContracts.pkpNftContractUtils.write.mint();

    return mintedPkp.pkp;
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
