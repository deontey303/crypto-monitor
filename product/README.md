# ProofMarket prototype

This directory starts the transition from a private crypto monitor to a verifiable AI-crypto product.

Run:

```sh
node --test product/claim-hash.test.mjs
```

The first primitive is deterministic SHA-256 commitment of a signal claim. It is deliberately independent of a blockchain: verification semantics come first; on-chain anchoring is a later transport choice.

Next integration: add `agent_id` and `claim_hash` to D1 shadow signals, compute the hash before insert, expose a read-only proof endpoint, then anchor periodic Merkle roots externally.
