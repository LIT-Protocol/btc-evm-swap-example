import mempoolJS from "@mempool/mempool.js";
// import fetch from "node-fetch";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoin-js/tiny-secp256k1-asmjs";
import { ec as EC } from "elliptic";
bitcoin.initEccLib(ecc);
const ec = new EC("secp256k1");

const a = {
    claims: {},
    signatures: {
        ethSignature: {
            r: "3d017499c9df61d66abc6dd04b6b8ff3ca087e825c17024aeb770494b7aff76a",
            s: "2a53aa95440ff090d862bd13369ebf5b141d61343a9e0d73e6eaed1d03304ed2",
            recid: 1,
            signature:
                "0x3d017499c9df61d66abc6dd04b6b8ff3ca087e825c17024aeb770494b7aff76a2a53aa95440ff090d862bd13369ebf5b141d61343a9e0d73e6eaed1d03304ed21c",
            publicKey:
                "049B7C2D8FBE8DE67191CAD56BFB32622BA2B36B067C489B49790912793B1F490777857DFAC88910B7BD39E23896512AC68D22B0895AF2C6F5EAF8F9CC77122359",
            dataSigned:
                "4380EAD3A849EE1331E2AB3EF043135CB66DD89C0CC0E2CA89DAA37FAF43BEDF",
        },
        btcSignature: {
            r: "dfad3b8cfe2db04b2e13237fee1c2c06a49f2586b921517bc18a10f9b26b3662",
            s: "5f409318843c0628935034e86753525e672738758635fa376dc472abd63d7aa1",
            recid: 1,
            signature:
                "0xdfad3b8cfe2db04b2e13237fee1c2c06a49f2586b921517bc18a10f9b26b36625f409318843c0628935034e86753525e672738758635fa376dc472abd63d7aa11c",
            publicKey:
                "049B7C2D8FBE8DE67191CAD56BFB32622BA2B36B067C489B49790912793B1F490777857DFAC88910B7BD39E23896512AC68D22B0895AF2C6F5EAF8F9CC77122359",
            dataSigned:
                "6C1FC116B733CEC26AD08A3CD0C9168ED957EBD8F9E146C44FF7107ADFFE794F",
        },
    },
    response: {
        response: {
            evmTransaction: {
                to: "0xE1b89ef648A6068fb4e7bCd943E3a9f4Dc5c530b",
                nonce: 0,
                gasLimit: "21000",
                from: "0x4c69B5475f7Cc688ce5bACf5B460fBc08E285fB3",
                value: "10000000000000000",
                type: 2,
            },
            btcTransaction:
                "0200000001a9a8c2065d07cba934ec8ff4d1da2bd3ffb918596764e4cbac09b90908dd80980200000000ffffffff01e80300000000000022512044586c256e1d3a9f3ed1a89fdcf91e36582dac58c3539756754d6e98f7ef359900000000",
        },
    },
    logs: "",
};

// broadcastBtcTransaction();
// async function broadcastBtcTransaction() {
//     console.log("broadcasting on btc..");
//     // const tx = bitcoin.Transaction.fromHex(results.response.response.btcTransaction);

//     // const signatureBuffer = Buffer.from(results.signatures.btcSignature.signature.replace(/^0x/, ''), 'hex');
//     // const publicKeyBuffer = Buffer.from(mintedPKP.publicKey, 'hex');

//     // const scriptSig = bitcoin.script.compile([
//     //     signatureBuffer,
//     //     publicKeyBuffer,
//     // ]);

//     // tx.setInputScript(0, scriptSig);

//     // const signedTxHex = tx.toHex();
//     // console.log('Signed Transaction Hex:', signedTxHex);

//     let txHex =
//         "0200000001a9a8c2065d07cba934ec8ff4d1da2bd3ffb918596764e4cbac09b90908dd80980200000000ffffffff01e80300000000000022512044586c256e1d3a9f3ed1a89fdcf91e36582dac58c3539756754d6e98f7ef359900000000";

//     // const { bitcoin: { transactions } } = mempoolJS({
//     //     hostname: 'mempool.space',
//     //     network: 'testnet'
//     // });

//     // const result = await axios.post(`${Btc_Endpoint}/testnet/api/tx`, signedTxHex });

//     const response = await fetch("https://mempool.space/api/tx", {
//         method: "POST",
//         headers: {
//             "Content-Type": "text/plain",
//         },
//         body: txHex,
//     });

//     if (!response.ok) {
//         const errorText = await response.text();
//         throw new Error(`Error broadcasting transaction: ${errorText}`);
//     }

//     const txid = await response.text();
//     console.log(`Transaction broadcasted successfully. TXID: ${txid}`);

//     console.log("Transaction Broadcast Result:", txid.data);
// }

let publicKey =
"0x049b7c2d8fbe8de67191cad56bfb32622ba2b36b067c489b49790912793b1f490777857dfac88910b7bd39e23896512ac68d22b0895af2c6f5eaf8f9cc77122359"

export async function broadcastBtcTransaction(
    transactionString = a.response.response.btcTransaction,
    litSignature = a.signatures.btcSignature,
    // hashForSig,
    pkpPublicKey = publicKey
) {
    // const compressedPoint = ec.pointCompress(
    //     Buffer.from(pkpPublicKey.replace("0x", ""), "hex"),
    //     true
    // );

    let pubKeyHex = pkpPublicKey.startsWith("0x") ? pkpPublicKey.slice(2) : pkpPublicKey;
    
    const keyPair = ec.keyFromPublic(pubKeyHex, "hex");

    const compressedPoint = Buffer.from(keyPair.getPublic(true, "hex"), "hex");

    const signature = Buffer.from(litSignature.r + litSignature.s, "hex");

    // const validSignature = validator(
    //     Buffer.from(compressedPoint),
    //     hashForSig,
    //     signature
    // );
    // if (!validSignature) throw new Error("Invalid signature");

    const compiledSignature = bitcoin.script.compile([
        bitcoin.script.signature.encode(
            signature,
            bitcoin.Transaction.SIGHASH_ALL
        ),
        Buffer.from(compressedPoint.buffer),
    ]);

    const transaction = bitcoin.Transaction.fromHex(transactionString);
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
