generateBtcAddress(ethKey: string): string {
    let compressedPoint: Uint8Array;
    if (ethKey.length === 130) {
      compressedPoint = ecc.pointCompress(Buffer.from(ethKey, "hex"), true);
    } else if (ethKey.length === 132) {
      if (ethKey.slice(0, 2) !== "0x") {
        throw new Error("Invalid Ethereum public key");
      }
      compressedPoint = ecc.pointCompress(
        Buffer.from(ethKey.slice(2), "hex"),
        true,
      );
    } else if (ethKey.length === 66) {
      compressedPoint = Buffer.from(ethKey, "hex");
    } else if (ethKey.length === 68) {
      if (ethKey.slice(0, 2) !== "0x") {
        throw new Error("Invalid Ethereum public key");
      }
      compressedPoint = Buffer.from(ethKey.slice(2), "hex");
    } else {
      throw new Error("Invalid Ethereum public key");
    }

    const { address } = bitcoin.payments.p2pkh({
      pubkey: Buffer.from(compressedPoint),
      network: this.btcTestNet
        ? bitcoin.networks.testnet
        : bitcoin.networks.bitcoin,
    });
    if (!address) throw new Error("Could not generate address");
    return address;
  }

  async getUtxoByAddress(address: string): Promise<UTXO> {
    try {
      const endpoint = `${this.btcApiEndpoint}/${
        this.btcTestNet ? "testnet/" : null
      }api/address/${address}/utxo`;
      const result = await fetch(endpoint);
      if (!result.ok)
        throw new Error(
          `Could not get utxos from endpoint ${endpoint}
          ${result.statusText}`,
        );
      const utxos = await result.json();
      const firstUtxo = utxos[0];
      if (!firstUtxo) {
        throw new Error("No utxos found for address");
      }
      // if (firstUtxo.status.confirmed === false) {
      //   throw new Error("First utxo is unconfirmed");
      // }
      return firstUtxo as UTXO;
    } catch (err) {
      throw new Error("Error fetching utxos: " + err);
    }
  }

  private prepareTransactionForSignature({
    utxo,
    recipientAddress,
    fee,
  }: {
    utxo: UTXO;
    recipientAddress: string;
    fee: number;
  }): bitcoin.Transaction {
    const transaction = new bitcoin.Transaction();
    transaction.addInput(
      reverseBuffer(Buffer.from(utxo.txid, "hex")),
      utxo.vout,
    );

    const outputScript = toOutputScript(
      recipientAddress,
      this.btcTestNet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin,
    );
    transaction.addOutput(outputScript, utxo.value - VBYTES_PER_TX * fee);

    return transaction;
  }

  private async signBitcoinWithLitAction(
    hashForSig: Buffer,
    pkpPublicKey: string,
  ) {
    const litActionCode = `
    const go = async () => {
      // this requests a signature share from the Lit Node
      // the signature share will be automatically returned in the HTTP response from the node
      // all the params (toSign, publicKey, sigName) are passed in from the LitJsSdk.executeJs() function
      try {
      const sigShare = await LitActions.signEcdsa({toSign: message, publicKey, sigName});
      } catch (e) {
        // console.log("error: ", e);
      }
    };

    go();
  `;
    const authSig = await this.generateAuthSig();
    await this.connect();

    const result = (await this.litClient.executeJs({
      code: litActionCode,
      jsParams: {
        // this is the string "Hello World" for testing
        message: hashForSig,
        publicKey: pkpPublicKey,
        sigName: "sig1",
      },
      authSig,
    })) as any;
    const { sig1 } = result.signatures;
    return sig1;
  }

  /**
   * Signs first UTXO for a PKP address
   * @param {string} pkpPublicKey - PKP public key
   * @param {number} fee - Fee per vbyte
   * @param {string} recipientAddress - Bitcoin address to send to
   * @returns {bitcoin.Transaction} Signed transaction
   * @example
   * const signedTransaction = sdk.signFirstBtcUtxo({
   *   pkpPublicKey: "0x043fd854ac22b8c80eadd4d8354ab8e74325265a065e566d82a21d578da4ef4d7af05d27e935d38ed28d5fda657e46a0dc4bab62960b4ad586b9c22d77f786789a",
   *   fee: 24,
   *   recipientAddress: "1JwSSubhmg6iPtRjtyqhUYYH7bZg3Lfy1T",
   * })
   */
  async signFirstBtcUtxo({
    pkpPublicKey,
    fee,
    recipientAddress,
  }: {
    pkpPublicKey: string;
    fee: number;
    recipientAddress: string;
  }): Promise<bitcoin.Transaction> {
    const compressedPoint = ecc.pointCompress(
      Buffer.from(pkpPublicKey.replace("0x", ""), "hex"),
      true,
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
        this.btcTestNet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin,
      ),
      bitcoin.Transaction.SIGHASH_ALL,
    );
    const litSignature = await this.signBitcoinWithLitAction(
      hashForSig,
      pkpPublicKey,
    );
    const signature = Buffer.from(litSignature.r + litSignature.s, "hex");

    const validSignature = validator(
      Buffer.from(compressedPoint),
      hashForSig,
      signature,
    );

    if (!validSignature) throw new Error("Invalid signature");
    const compiledSignature = bitcoin.script.compile([
      bitcoin.script.signature.encode(
        signature,
        bitcoin.Transaction.SIGHASH_ALL,
      ),
      Buffer.from(compressedPoint.buffer),
    ]);

    transaction.setInputScript(0, compiledSignature);
    return transaction;
  }

  public signBtcTxWithLitSignature(
    transactionString: string,
    litSignature: { s: string; r: string },
    hashForSig: Buffer,
    pkpPublicKey: string,
  ) {
    const compressedPoint = ecc.pointCompress(
      Buffer.from(pkpPublicKey.replace("0x", ""), "hex"),
      true,
    );
    const signature = Buffer.from(litSignature.r + litSignature.s, "hex");

    const validSignature = validator(
      Buffer.from(compressedPoint),
      hashForSig,
      signature,
    );

    if (!validSignature) throw new Error("Invalid signature");
    const compiledSignature = bitcoin.script.compile([
      bitcoin.script.signature.encode(
        signature,
        bitcoin.Transaction.SIGHASH_ALL,
      ),
      Buffer.from(compressedPoint.buffer),
    ]);

    const transaction = bitcoin.Transaction.fromHex(transactionString);

    transaction.setInputScript(0, compiledSignature);
    return transaction.toHex();
  }

  /**
   * Broadcasts a signed transaction to the Bitcoin network
   * @param {bitcoin.Transaction} transaction - Signed transaction
   * @returns {Promise<string>} Transaction ID
   * @example
   * const signedTransaction = sdk.signFirstBtcUtxo({
   *  pkpPublicKey: "0x043fd854ac22b8c80eadd4d8354ab8e74325265a065e566d82a21d578da4ef4d7af05d27e935d38ed28d5fda657e46a0dc4bab62960b4ad586b9c22d77f786789a",
   *  fee: 24,
   *  recipientAddress: "1JwSSubhmg6iPtRjtyqhUYYH7bZg3Lfy1T",
   * })
   * const txId = await sdk.broadcastBtcTransaction(signedTransaction)
   */
  async broadcastBtcTransaction(
    transaction: bitcoin.Transaction,
  ): Promise<string> {
    try {
      const txHex = transaction.toHex();
      const response = await fetch(
        `${this.btcApiEndpoint}/${this.btcTestNet ? "testnet/" : null}api/tx`,
        {
          method: "POST",
          body: txHex,
        },
      );
      const data = await response.text();
      return data;
    } catch (err) {
      console.log(err);
      throw new Error("Error broadcasting transaction: " + err);
    }
  }



  async runBtcEthSwapLitAction({
    pkpPublicKey,
    code,
    authSig,
    ethGasConfig,
    btcFeeRate,
    ethParams,
    btcParams,
    isEthClawback = false,
    originTime,
    utxoIsValid,
    didSendBtcFromPkp,
  }: {
    pkpPublicKey: string;
    code: string;
    authSig?: any;
    ethGasConfig: GasConfig;
    btcFeeRate: number;
    btcParams: LitBtcSwapParams;
    ethParams: LitEthSwapParams;
    isEthClawback?: boolean;
    originTime?: number;
    utxoIsValid?: boolean;
    didSendBtcFromPkp?: boolean;
  }): Promise<LitBtcEthSwapResponse> {
    try {
      let successHash, clawbackHash, utxo, successTxHex, clawbackTxHex;
      if (!isEthClawback) {
        ({ successHash, clawbackHash, utxo, successTxHex, clawbackTxHex } =
          await this.prepareBtcSwapTransactions(
            btcParams,
            ethParams,
            code,
            pkpPublicKey,
            btcFeeRate,
          ));
      }
      await this.connect();
      const response = await this.litClient.executeJs({
        code: code,
        authSig: authSig ? authSig : await this.generateAuthSig(),
        jsParams: {
          pkpAddress: ethers.utils.computeAddress(pkpPublicKey),
          pkpBtcAddress: this.generateBtcAddress(pkpPublicKey),
          pkpPublicKey: pkpPublicKey,
          authSig: authSig ? authSig : await this.generateAuthSig(),
          ethGasConfig: ethGasConfig,
          btcFeeRate: btcFeeRate,
          successHash: successHash,
          clawbackHash: clawbackHash,
          passedInUtxo: utxo,
          successTxHex,
          clawbackTxHex,
          utxoIsValid,
          didSendBtcFromPkp,
          originTime,
        },
      });
      return response;
    } catch (e) {
      throw new Error(`Error running btc eth swap lit action: ${e}`);
    }
  }

  private async prepareBtcSwapTransactions(
    btcParams: LitBtcSwapParams,
    ethParams: LitEthSwapParams,
    code: string,
    pkpPublicKey: string,
    btcFeeRate: number,
  ) {
    try {
      const checksum = await this.getIPFSHash(
        await this.generateBtcEthSwapLitActionCode(btcParams, ethParams),
      );
      const codeChecksum = await this.getIPFSHash(code);
      if (checksum !== codeChecksum) {
        throw new Error(
          "IPFS CID does not match generated Lit Action code.  You may have the incorrect parameters.",
        );
      }
      const btcAddress = this.generateBtcAddress(pkpPublicKey);
      const utxo = await this.getUtxoByAddress(btcAddress);
      const btcSuccessTransaction = this.prepareTransactionForSignature({
        utxo,
        recipientAddress: ethParams.btcAddress,
        fee: btcFeeRate,
      });
      const successHash = btcSuccessTransaction.hashForSignature(
        0,
        toOutputScript(
          btcAddress,
          this.btcTestNet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin,
        ),
        bitcoin.Transaction.SIGHASH_ALL,
      );
      const btcClawbackTransaction = this.prepareTransactionForSignature({
        utxo,
        recipientAddress: btcParams.counterPartyAddress,
        fee: btcFeeRate,
      });
      const clawbackHash = btcClawbackTransaction.hashForSignature(
        0,
        toOutputScript(
          btcAddress,
          this.btcTestNet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin,
        ),
        bitcoin.Transaction.SIGHASH_ALL,
      );
      return {
        successTxHex: btcSuccessTransaction.toHex(),
        successHash,
        clawbackTxHex: btcClawbackTransaction.toHex(),
        clawbackHash,
        utxo,
      };
    } catch (err) {
      throw new Error(`Error in runBtcEthSwapLitAction: ${err}`);
    }
  }



  private async prepareBtcSwapTransactions(
    btcParams: LitBtcSwapParams,
    ethParams: LitEthSwapParams,
    code: string,
    pkpPublicKey: string,
    btcFeeRate: number,
  ) {
    try {
      const checksum = await this.getIPFSHash(
        await this.generateBtcEthSwapLitActionCode(btcParams, ethParams),
      );
      const codeChecksum = await this.getIPFSHash(code);
      if (checksum !== codeChecksum) {
        throw new Error(
          "IPFS CID does not match generated Lit Action code.  You may have the incorrect parameters.",
        );
      }
      const btcAddress = this.generateBtcAddress(pkpPublicKey);
      const utxo = await this.getUtxoByAddress(btcAddress);
      const btcSuccessTransaction = this.prepareTransactionForSignature({
        utxo,
        recipientAddress: ethParams.btcAddress,
        fee: btcFeeRate,
      });
      const successHash = btcSuccessTransaction.hashForSignature(
        0,
        toOutputScript(
          btcAddress,
          this.btcTestNet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin,
        ),
        bitcoin.Transaction.SIGHASH_ALL,
      );
      const btcClawbackTransaction = this.prepareTransactionForSignature({
        utxo,
        recipientAddress: btcParams.counterPartyAddress,
        fee: btcFeeRate,
      });
      const clawbackHash = btcClawbackTransaction.hashForSignature(
        0,
        toOutputScript(
          btcAddress,
          this.btcTestNet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin,
        ),
        bitcoin.Transaction.SIGHASH_ALL,
      );
      return {
        successTxHex: btcSuccessTransaction.toHex(),
        successHash,
        clawbackTxHex: btcClawbackTransaction.toHex(),
        clawbackHash,
        utxo,
      };
    } catch (err) {
      throw new Error(`Error in runBtcEthSwapLitAction: ${err}`);
    }
  }



  public generateBtcEthSwapLitActionCode = async (
    btcParams: LitBtcSwapParams,
    ethParams: LitEthSwapParams,
    fileName?: string,
  ) => {
    const evmConditions = this.generateEVMNativeSwapCondition(ethParams);
    const unsignedEthTransaction = this.generateUnsignedEVMNativeTransaction({
      counterPartyAddress: btcParams.ethAddress,
      chain: ethParams.chain,
      amount: ethParams.amount,
    });
    const unsignedEthClawbackTransaction =
      this.generateUnsignedEVMNativeTransaction({
        counterPartyAddress: ethParams.counterPartyAddress,
        chain: ethParams.chain,
        amount: ethParams.amount,
      });

    const variablesToReplace = {
      btcSwapParams: JSON.stringify(btcParams),
      ethSwapParams: JSON.stringify(ethParams),
      evmConditions: JSON.stringify(evmConditions),
      evmTransaction: JSON.stringify(unsignedEthTransaction),
      evmClawbackTransaction: JSON.stringify(unsignedEthClawbackTransaction),
    };

    return await this.loadActionCode(variablesToReplace, fileName);
  };



  private async loadActionCode(
    variables: Record<string, string>,
    fileName?: string,
  ): Promise<string> {
    const resolvedFilename = fileName ? fileName : "BtcEthSwap.bundle.js";
    const filePath = path.join(__dirname, "javascript", resolvedFilename);
    try {
      const code = await new Promise<string>((resolve, reject) => {
        fs.readFile(filePath, "utf8", (err, data) => {
          if (err) {
            reject(err);
          } else {
            resolve(data);
          }
        });
      });

      return this.replaceCodeVariables(code, variables);
    } catch (err) {
      console.log(`Error loading Lit action code: ${err}`);
      return "";
    }
  }
  