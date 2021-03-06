<img src="https://app.guilderfi.io/assets/logos/logo_full_256x256.png" width="156" />

# GuilderFi Smart Contract

GuilderFi Smart Contract 1.0

## How to build an deploy this project

**1. Install dependencies**
```
yarn # or npm install
```

**2. Create an environment file**

In the root folder of the project, copy **.env.sample** and create a new **.env** file

**3. Deploy to testnet**
```
npx hardhat deploy-all --network testnet
```
This will deploy the main GuilderFi smart contract and also deploy sub contracts and link them to the main contract.

## How to test this project

**1. Run a local blockchain node**
```
npx hardhat node
```
This will run a local blockchain instance on your machine. It will fork the testnet chain set up in your environment file.

**2. Execute automated tests**
```
npx hardhat test --network localhost
```
This will run a suite of tests in the *test* folder.

## Tokenomics:

Full details available at:
https://docs.guilderfi.io

Transaction fees:
https://docs.guilderfi.io/token/trading-fees

## Smart Contract Variables

\#|Variable|Configurable?|Description
--|--------|-------------|-----------
1 |Initial Supply|Fixed|Initial supply of NPLUS1 tokens
2 |Max Supply|Fixed|Max supply of NPLUS1 tokens. Once the max supply is reached, rebasing is disabled.
3 |Rebase rate|Fixed|The rebase rate is hard-coded according to the GuilderFi APY schedule here: https://docs.guilderfi.io/guilderfi-protocol/annual-percentage-yield-apy/yearly-fixed-apy
4 |Rebase frequency|Fixed|How often the rebase should occur. Fixed at 12 minutes.
5 |Max rebase count|Fixed|The maximum number of rebases that can occur witin a single transaction. Currently set to 40 (i.e. 8 hours worth rebases).
6 |Treasury address|Configurable|The wallet address of the GuilderFi treasury.
7 |LRF address|Configurable|The wallet address of the GuilderFi Liquidity Relief Fund (LRF).
8 |Auto Liquidity Engine wallet address|Configurable|The wallet addresss of the GuilderFi Automated Liquidity Engine.
9 |Decentralised Exchange|Configurable|Currently configured to use Trader Joe Decentralised Exchange.
10 |Fees|Configurable|Buy and sell fees are configurable, however buy fees are capped at 20% and sell fees at 24%. As long as the total fees are below the cap, the following fees can be configured: Treasury, LRF, Auto Liquidity, Burn.
11|Max Fees|Fixed|Max fees are fixed at 20% (buy) and 24% (sell) and cannot be changed.

## Rebase Mechanism

* Rebase's are calculated every 12 minutes.
* Rebases require a transaction to take place to be applied to token holder's accounts.
* If no transactions occur after 12 minutes, the next transaction will catch up on previous rebases that have been missed.
* The maximum number of rebases that can occur in a single transaction will be capped. This is to ensure that if a large number of rebases need to be calculated, the transaction can be executed and not exceed gas limits.
* The GuilderFi team will automatically trigger a rebase every 8 hours if not enough transactions have been executed in an 8 hour window.


## Supporting Links

#### Medium

https://guilderfi.medium.com/

#### Discord

https://discord.gg/Saww6dXZsg

#### Twitter

https://twitter.com/guilderfi