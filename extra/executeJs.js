import { LitNetwork, LIT_RPC } from "@lit-protocol/constants";
import { ethers } from "ethers";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import { LitNodeClient } from "@lit-protocol/lit-node-client";
import { LitAbility } from "@lit-protocol/types";
import {
    LitActionResource,
    createSiweMessageWithRecaps,
    generateAuthSig,
    LitPKPResource,
    AuthSig,
} from "@lit-protocol/auth-helpers";

export async function signWithLit(_dataToSign) {
    console.log("executing..");
    const provider = new ethers.providers.JsonRpcProvider(
        LIT_RPC.CHRONICLE_YELLOWSTONE
    );
    let _wallet = new ethers.Wallet(
        process.env.NEXT_PUBLIC_PRIVATE_KEY,
        provider
    );
    let _network = LitNetwork.DatilDev;

    const litNodeClient = new LitNodeClient({
        litNetwork: _network,
    });

    const pkp = await mintPKP(_wallet, _network);
    console.log(pkp)

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

export async function mintPKP(_signer, _network) {
    const litContracts = new LitContracts({
        signer: _signer,
        network: _network,
        debug: false,
    });

    await litContracts.connect();

    const mintedPkp = await litContracts.pkpNftContractUtils.write.mint();

    return mintedPkp.pkp;
}

export async function sessionSigEOA(
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

export async function mintAndDelegateCapacityCredit(
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
