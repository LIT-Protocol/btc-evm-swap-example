import { ethers } from 'ethers';


// raw lit action ----------------------------

const rawLitAction = `
const btcSwapParams = "{{btcSwapParams}}";
const evmConditions = "{{evmConditions}}";
const evmTransaction = "{{evmTransaction}}";
const evmClawbackTransaction = "{{evmClawbackTransaction}}";
evmTransaction.from = evmClawbackTransaction.from = pkpAddress;
evmConditions.parameters = [pkpAddress];
const hashTransaction = (tx) => {
    return ethers.utils.arrayify(
        ethers.utils.keccak256(
            ethers.utils.arrayify(ethers.utils.serializeTransaction(tx))
        )
    );
};

function checkHasThreeDaysPassed(previousTime) {
    const currentTime = Date.now();
    const difference = currentTime - previousTime;
    return difference / (1000 * 3600 * 24) >= 3 ? true : false;
}

async function validateUtxo() {
    try {
        const utxoResponse = await fetch(
            \`https://ac26-72-80-171-211.ngrok-free.app/utxos?address=\${pkpBtcAddress}\`
        );
        const fetchUtxo = await utxoResponse.json();
        if (fetchUtxo.length === 0) {
            return false;
        }
        const utxoToSpend = fetchUtxo[0];
        if (utxoToSpend.value !== btcSwapParams.value) {
            return false;
        }
        if (
            utxoToSpend.txid !== passedInUtxo.txid ||
            utxoToSpend.vout !== passedInUtxo.vout
        ) {
            return false;
        }
        return true;
    } catch (e) {
        throw new Error(\`Could not validate UTXO: \${e}\`);
    }
}

async function didSendBtc(address) {
    try {
        const response = await fetch(
            \`https://ac26-72-80-171-211.ngrok-free.app/txs?address=\${pkpBtcAddress}\`
        );
        const transactions = await response.json();
        if (transactions.length === 0) {
            return false;
        }
        return transactions.length > 1;
    } catch (e) {
        throw new Error(\`Could not check if BTC was sent: \${e}\`);
    }
}

async function go() {
    try {
        let response = {};
        const utxoIsValid = await validateUtxo();
        // passedInUtxo
        const didSendBtcFromPkp = await didSendBtc(pkpBtcAddress);
        const evmConditionsPass = await Lit.Actions.checkConditions({
            conditions: [evmConditions],
            authSig,
            chain: evmConditions.chain,
        });
        const evmNonce = await Lit.Actions.getLatestNonce({
            address: pkpAddress,
            chain: evmConditions.chain,
        });

        if (utxoIsValid) {
            if (evmConditionsPass || evmNonce === "0x1") {
                await Lit.Actions.signEcdsa({
                    toSign: hashTransaction(evmTransaction),
                    publicKey: pkpPublicKey,
                    sigName: "ethSignature",
                });
                await Lit.Actions.signEcdsa({
                    toSign: successHash,
                    publicKey: pkpPublicKey,
                    sigName: "btcSignature",
                });
                response = {
                    ...response,
                    evmTransaction,
                    btcTransaction: successTxHex,
                };
            } else if (checkHasThreeDaysPassed(originTime)) {
                await Lit.Actions.signEcdsa({
                    toSign: clawbackHash,
                    publicKey: pkpPublicKey,
                    sigName: "btcSignature",
                });
                response = {
                    ...response,
                    btcClawbackTransaction: clawbackTxHex,
                };
            } else {
                response = {
                    ...response,
                    error: "Swap conditions not met",
                };
            }
        } else if (evmConditionsPass) {
            if (didSendBtcFromPkp) {
                await Lit.Actions.signEcdsa({
                    toSign: hashTransaction(evmTransaction),
                    publicKey: pkpPublicKey,
                    sigName: "ethSignature",
                });
                await Lit.Actions.signEcdsa({
                    toSign: successHash,
                    publicKey: pkpPublicKey,
                    sigName: "btcSignature",
                });
                response = {
                    ...response,
                    evmTransaction,
                    btcTransaction: successTxHex,
                };
            } else if (checkHasThreeDaysPassed(originTime)) {
                await Lit.Actions.signEcdsa({
                    toSign: hashTransaction(evmClawbackTransaction),
                    publicKey: pkpPublicKey,
                    sigName: "ethSignature",
                });
                response = {
                    ...response,
                    evmClawbackTransaction: evmClawbackTransaction,
                };
            } else {
                response = {
                    ...response,
                    error: "Swap conditions not met",
                };
            }
        } else {
            response = {
                ...response,
                error: "Swap conditions not met",
            };
        }

        Lit.Actions.setResponse({
            response: JSON.stringify({ response: response }),
        });
    } catch (err) {
        Lit.Actions.setResponse({
            response: JSON.stringify({ error: err.message }),
        });
    }
}

go();
`

// caller functions ----------------------------

const btcParams = {
    counterPartyAddress:
        "tb1pdj2gvzymxtmcrs5ypm3pya8vc3h4fkk2g9kmav0j6skgruez88rs9f4zya",
    network: "testnet",
    value: 8000,
    ethAddress: "0xE1b89ef648A6068fb4e7bCd943E3a9f4Dc5c530b",
};

const ethParams = {
    counterPartyAddress: "0x9A6687E110186Abedf287085Da1f9bdD4d90D858",
    chain: "ethereum",
    amount: "1",
    btcAddress:
        "tb1pg3vxcftwr5af70k34z0ae7g7xevzmtzccdfew4n4f4hf3al0xkvs98y7k9",
};

async function simulator() {
    const result = await generateBtcEthSwapLitActionCode(btcParams, ethParams);
    console.log(result);
}
simulator();

// primary functions ----------------------------

async function generateBtcEthSwapLitActionCode(btcParams, ethParams, fileName) {
    const evmConditions = generateEVMNativeSwapCondition(ethParams);
    const unsignedEthTransaction = generateUnsignedEVMNativeTransaction({
        counterPartyAddress: btcParams.ethAddress,
        amount: ethParams.amount,
        chainId: ethParams.chainId,
    });

    const unsignedEthClawbackTransaction = generateUnsignedEVMNativeTransaction(
        {
            counterPartyAddress: ethParams.counterPartyAddress,
            amount: ethParams.amount,
            chainId: ethParams.chainId,
        }
    );

    const variablesToReplace = {
        btcSwapParams: JSON.stringify(btcParams),
        ethSwapParams: JSON.stringify(ethParams),
        evmConditions: JSON.stringify(evmConditions),
        evmTransaction: JSON.stringify(unsignedEthTransaction),
        evmClawbackTransaction: JSON.stringify(unsignedEthClawbackTransaction),
    };

    return await loadActionCode(variablesToReplace);
}

function generateEVMNativeSwapCondition({ chain, amount }) {
    return {
        contractAddress: "",
        standardContractType: "",
        chain: chain,
        method: "eth_getBalance",
        parameters: ["address"],
        returnValueTest: {
            comparator: ">=",
            value: ethers.utils.parseEther(amount).toString(),
        },
    };
}

function generateUnsignedEVMNativeTransaction({
    counterPartyAddress,
    amount,
    from,
    nonce,
    chainId
}) {
    return {
        to: counterPartyAddress,
        nonce: nonce || 0,
        chainId: chainId,
        gasLimit: "21000",
        from: from || "{{pkpPublicKey}}",
        value: ethers.utils.parseEther(amount).toString(),
        type: 2,
    };
}

async function loadActionCode(variables) {
    try {
        let result = rawLitAction;
        
        for (const key in variables) {
            if (Object.prototype.hasOwnProperty.call(variables, key)) {
                const placeholder = `{{${key}}}`;
                const value = variables[key];
                result = result.split(placeholder).join(value);
            }
        }

        return result;
    } catch (err) {
        console.log(`Error processing Lit action code: ${err}`);
        return "";
    }
}
