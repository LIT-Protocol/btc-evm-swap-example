
async function signBitcoinWithLitAction(hashForSig, pkpPublicKey) {
    const litActionCode = `
      const go = async () => {
        try {
          const sigShare = await LitActions.signEcdsa({ toSign: message, publicKey, sigName });
        } catch (e) {
          console.log("error: ", e);
        }
      };
      go();
    `;
    const authSig = await this.generateAuthSig();
    await this.connect();

    const result = await this.litClient.executeJs({
        code: litActionCode,
        jsParams: {
            message: hashForSig,
            publicKey: pkpPublicKey,
            sigName: "sig1",
        },
        authSig,
    });
    const { sig1 } = result.signatures;
    return sig1;
}

async function signFirstBtcUtxo({ pkpPublicKey, fee, recipientAddress }) {
    const compressedPoint = ecc.pointCompress(
        Buffer.from(pkpPublicKey.replace("0x", ""), "hex"),
        true
    );
    const pkpBtcAddress = this.generateBtcAddress(pkpPublicKey);
    const utxo = await this.getUtxoByAddress(pkpBtcAddress);

    const transaction = this.prepareTransactionForSignature({
        utxo,
        recipientAddress,
        fee,
    });
    const hashForSig = transaction.hashForSignature(
        0,
        toOutputScript(
            pkpBtcAddress,
            this.btcTestNet
                ? bitcoin.networks.testnet
                : bitcoin.networks.bitcoin
        ),
        bitcoin.Transaction.SIGHASH_ALL
    );

    const litSignature = await this.signBitcoinWithLitAction(
        hashForSig,
        pkpPublicKey
    );
    const signature = Buffer.from(litSignature.r + litSignature.s, "hex");

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

    transaction.setInputScript(0, compiledSignature);
    return transaction;
}

function signBtcTxWithLitSignature(
    transactionString,
    litSignature,
    hashForSig,
    pkpPublicKey
) {
    const compressedPoint = ecc.pointCompress(
        Buffer.from(pkpPublicKey.replace("0x", ""), "hex"),
        true
    );
    const signature = Buffer.from(litSignature.r + litSignature.s, "hex");

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

    const transaction = bitcoin.Transaction.fromHex(transactionString);
    transaction.setInputScript(0, compiledSignature);
    return transaction.toHex();
}

async function broadcastBtcTransaction(transaction) {
    try {
        const txHex = transaction.toHex();
        const response = await fetch(
            `${this.btcApiEndpoint}/${this.btcTestNet ? "testnet/" : ""}api/tx`,
            {
                method: "POST",
                body: txHex,
            }
        );
        const data = await response.text();
        return data;
    } catch (err) {
        throw new Error("Error broadcasting transaction: " + err);
    }
}

async function loadActionCode(variables, fileName) {
    const resolvedFilename = fileName || "BtcEthSwap.bundle.js";
    const __dirname = path.resolve();
    const filePath = path.join("./", "lit", resolvedFilename);
    try {
        const code = await new Promise((resolve, reject) => {
            fs.readFile(filePath, "utf8", (err, data) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });

        return replaceCodeVariables(code, variables);
    } catch (err) {
        console.log(`Error loading Lit action code: ${err}`);
        return "";
    }
}

function replaceCodeVariables(content, variables) {
    let result = content;
    for (const key in variables) {
        if (Object.prototype.hasOwnProperty.call(variables, key)) {
            const placeholder = `{{${key}}}`; // No need for extra quotes around the placeholder
            const value = variables[key];
            result = result.split(placeholder).join(value);
        }
    }
    return result;
}