# Security

BLACKOUT keeps game state hidden inside a TEE and, on staked nights, holds players' SOL. If you find a way to break either, please tell me privately first so it can be fixed before anyone uses it.

## Reporting

Use GitHub's private report: **[Report a vulnerability](../../security/advisories/new)** (the Security tab of this repository). Please include:

- what an attacker can do, and what it costs them
- the instruction(s) and file(s) involved
- steps or a script to reproduce it, ideally against devnet

You'll get a reply within a few days. Once it's fixed, you'll be credited in [Audit.md](Audit.md), unless you'd rather not be.

Please don't test against other players' rooms or stakes. Create your own rooms with your own devnet program (see [CONTRIBUTING.md](CONTRIBUTING.md#running-your-own-program)), or ask and I'll set one up for you.

## What's in scope

- **Money:** anything that lets someone take, lock up or inflate stakes. That covers `buy_ticket`, `join`, `leave`, `start_match`, `finish`, `settle`, `close_ticket`, `reset` and the admin close paths.
- **Hidden information:** reading the sealed World, another seat's View or the recorder before lights-on. Learning the VRF seed or a future zone early also counts.
- **Fairness:** influencing the result of a night outside the game's rules, for example ending it early, forcing a tie or predicting loot.
- **The website:** anything that lets one player act as another, or that runs script in another player's browser.

## Known and accepted

These are documented in [Audit.md](Audit.md#known-risks-that-remain) and don't need a report:

- MagicBlock's TEE validator is trusted to run the program honestly and to enforce read permissions.
- Two wallets at one table can collude; a program can't detect that.
- A modified client can aim perfectly at players it is already allowed to see.
- Private room codes are visible in the public Room account: "private" means unlisted.
- Third-party dependency advisories inside the Solana and MagicBlock libraries.

## Status

The program is on devnet only and has had a self-review backed by on-chain tests, not a professional audit. Keep that in mind before staking anything that matters.
