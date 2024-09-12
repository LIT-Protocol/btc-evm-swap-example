"use client"
import { createLitAction, mintGrantBurnPKP, bridge } from "../lit/utils.js";

export default function Home() {
    return (
        <div>
            <h1>Lit BTC-EVM Bridge Demo</h1>
            <button onClick={createLitAction}>Create Lit Action</button>
            <button onClick={mintGrantBurnPKP}>Create a Mint Grant Burn PKP</button>
            <button onClick={bridge}>Bridge</button>
        </div>
    );
}
