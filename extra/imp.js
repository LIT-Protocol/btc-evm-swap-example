export async function depositOnBitcoin(_bitcoin) {
    if (!privateKey.startsWith("0x")) {
        privateKey = "0x" + privateKey;
    }
    const senderAddress = generateBtcAddressBech32(
        ethers.utils.computePublicKey(privateKey)
    );
    const recipientAddress = generateBtcAddressBech32(publicKeyRecipient);
    const amount = BigInt(1000);
    const Btc_Endpoint = "https://mempool.space";
    const fee = BigInt(500);
    const network = bitcoin.networks.testnet;
    const psbt = new bitcoin.Psbt({ network });

    const endpoint = `${Btc_Endpoint}/testnet/api/address/${senderAddress}/utxo`;
    const result = await fetch(endpoint);
    const utxos = await result.json();

    const totalInput = BigInt(utxos.reduce((sum, utxo) => sum + utxo.value, 0));

    if (totalInput - amount - fee < 0) {
        throw new Error("Insufficient funds");
    }

    const p2wpkh = bitcoin.payments.p2wpkh({
        address: senderAddress,
        network: network,
    });

    utxos.forEach((utxo) => {
        psbt.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            witnessUtxo: {
                script: p2wpkh.output,
                value: BigInt(utxo.value),
            },
        });
    });

    psbt.addOutput({
        address: recipientAddress,
        value: amount,
    });

    const keyPair = ECPair.fromPrivateKey(Buffer.from(privateKey, "hex"), {
        network,
    });

    psbt.signAllInputs(keyPair);

    psbt.finalizeAllInputs();

    const signedTxHex = psbt.extractTransaction().toHex();
    console.log("Signed Transaction Hex:", signedTxHex);

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