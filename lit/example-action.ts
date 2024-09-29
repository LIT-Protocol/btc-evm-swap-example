const btcSwapParams = {"counterPartyAddress":"mmnxChcUSLdPGuvSmkpUr7ngrNjfTYKcRq","ethAddress":"mmnxChcUSLdPGuvSmkpUr7ngrNjfTYKcRq","network":"testnet","value":1000};
const evmConditions = {"contractAddress":"","standardContractType":"","chain":"yellowstone","method":"eth_getBalance","parameters":["address"],"returnValueTest":{"comparator":">=","value":"10000000000000000"}};
const evmTransaction = {"to":"mmnxChcUSLdPGuvSmkpUr7ngrNjfTYKcRq","nonce":0,"gasLimit":"21000","from":"{{pkpPublicKey}}","value":"10000000000000000","type":2};
const evmClawbackTransaction = {"to":"0x6428B9170f12EaC6aBA3835775D2bf27e2D6EAd4","nonce":0,"gasLimit":"21000","from":"{{pkpPublicKey}}","value":"10000000000000000","type":2};
const originTime = 1727558491068;

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
            `${BTC_ENDPOINT}/testnet/api/address/${pkpBtcAddress}/utxo`
        );
        const fetchUtxo = await utxoResponse.json();
        if (fetchUtxo.length === 0) {
            return false;
        }
        const utxoToSpend = fetchUtxo[0];
        if (utxoToSpend.value < btcSwapParams.value) {
            return false;
        }
        if (
            utxoToSpend.txid !== passedFirstUtxo.txid ||
            utxoToSpend.vout !== passedFirstUtxo.vout
        ) {
            return false;
        }
        return true;
    } catch (e) {
        throw new Error(`Could not validate UTXO: ${e}`);
    }
}

async function didSendBtc() {
    try {
        const response = await fetch(
            `${BTC_ENDPOINT}/testnet/api/address/${pkpBtcAddress}/txs`
        );
        const transactions = await response.json();
        if (transactions.length === 0) {
            return false;
        }
        return transactions.length > 0;
    } catch (e) {
        throw new Error(`Could not check if BTC was sent: ${e}`);
    }
}

async function go() {
    try {
        if (evmClawback == true) {
            await Lit.Actions.signEcdsa({
                toSign: hashTransaction(evmClawbackTransaction),
                publicKey: pkpPublicKey,
                sigName: "evmSignature",
            });
            Lit.Actions.setResponse({
                response: JSON.stringify({ evmClawbackTransaction: evmClawbackTransaction }),
            });
        }
        let response = {};
        const btcConditionPass = await validateUtxo();
        response = {...response, btcConditionPass};
        const didSendBtcFromPkp = await didSendBtc();
        const evmConditionsPass = await Lit.Actions.checkConditions({
            conditions: [evmConditions],
            authSig,
            chain: evmConditions.chain,
        });
        response = {...response, evmConditionsPass};

        if (btcConditionPass) {
            if (evmConditionsPass) {
                await Lit.Actions.signEcdsa({
                    toSign: hashTransaction(evmTransaction),
                    publicKey: pkpPublicKey,
                    sigName: "evmSignature",
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
                await Lit.Actions.signEcdsa({
                    toSign: hashTransaction(evmClawbackTransaction),
                    publicKey: pkpPublicKey,
                    sigName: "evmSignature",
                });
                response = {
                    ...response,
                    evmClawbackTransaction,
                    btcClawbackTransaction: clawbackTxHex,
                };
            } else {
                await Lit.Actions.signEcdsa({
                    toSign: clawbackHash,
                    publicKey: pkpPublicKey,
                    sigName: "btcSignature",
                });
                response = {
                    ...response,
                    btcClawbackTransaction: clawbackTxHex,
                };

            }
        } else if (evmConditionsPass) {
            await Lit.Actions.signEcdsa({
                toSign: hashTransaction(evmClawbackTransaction),
                publicKey: pkpPublicKey,
                sigName: "evmSignature",
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