"use client";
import { useState } from "react";
import {
    createLitAction,
    mintGrantBurnPKP,
    generateBtcAddress,
    runLitAction,
} from "../lit/utils.js";

export default function Home() {
    const [ipfsId, setIpfsId] = useState(null);
    const [pkp, setPkp] = useState(null);
    const [btcA, setBtcA] = useState(null);

    async function createLitActionCall() {
        const ipfs = await createLitAction();
        setIpfsId(ipfs);
    }

    async function mintGrantBurnPKPCall() {
        const mintedPkp = await mintGrantBurnPKP(ipfsId);
        setPkp(mintedPkp);
    }

    async function generateBtcAddressCall() {
        const btcAddress = await generateBtcAddress();
        setBtcA(btcAddress);
    }

    return (
        <div className="flex flex-col items-center gap-[1.2rem]">
            <h1 className="mb-[1.5rem] mt-[0.8rem]">
                LIT EVM-EVM Bridge Demo (Open Console)
            </h1>
            <p>IPFS Id, {ipfsId}</p>
            <p>PKP Address, {pkp?.ethAddress}</p>
            <p className="mb-[1.5rem]">BTC Address, {btcA}</p>
            <button onClick={createLitActionCall}>Generate Lit Action</button>
            <button onClick={mintGrantBurnPKPCall}>Mint Grant Burn PKP</button>
            <button onClick={generateBtcAddressCall}>Generate BTC Address</button>
            <button onClick={() => runLitAction(ipfsId, pkp)}>
                Run Lit Action
            </button>
        </div>
    );
}
