const { task } = require("hardhat/config");
const { verify } = require("./helpers/verify");
const { getAccounts } = require("./helpers/accounts");
const { BigNumber } = require("ethers");

require("dotenv").config();
require("@nomiclabs/hardhat-etherscan");
require("@nomiclabs/hardhat-waffle");
require("hardhat-gas-reporter");
require("solidity-coverage");
require("hardhat-contract-sizer");

const accounts = getAccounts();
const { TESTNET_URL, TESTNET_CHAIN_ID, TESTNET_DEX_ROUTER_ADDRESS, MAINNET_URL, MAINNET_CHAIN_ID, ETHERSCAN_API_KEY, REPORT_GAS } =
  process.env;
const TOKEN_NAME = "GuilderFi";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();
  for (const account of accounts) {
    console.log(account.address); // public key
  }
});

task("deploy", "Deploys the contract to the blockchain", async (taskArgs, hre) => {
  const Token = await hre.ethers.getContractFactory(TOKEN_NAME);
  const token = await Token.deploy();
  await token.deployed();
  console.log("Token deployed to contract address: ", token.address);
  return token;
});

task("approve", "Approve for trading")
  .addParam("address", "Main GuilderFi contract address")
  .setAction(async (taskArgs, hre) => {
    const Token = await hre.ethers.getContractFactory(TOKEN_NAME);
    const token = await Token.attach(taskArgs.address);

    // get signers
    const [deployer, treasury] = await hre.ethers.getSigners();

    // approvals
    const router = await token.getRouter();
    const pair = await hre.ethers.getContractAt("IDexPair", await token.getPair());

    console.log("Pre-approving accounts to trade on DEX...");
    await token.connect(treasury).approve(router, hre.ethers.constants.MaxUint256);
    await token.connect(deployer).approve(router, hre.ethers.constants.MaxUint256);
    await pair.connect(treasury).approve(router, hre.ethers.constants.MaxUint256);
    console.log("Done!");
  });

task("disable", "Disable swapping")
  .addParam("address", "Main GuilderFi contract address")
  .setAction(async (taskArgs, hre) => {
    const Token = await hre.ethers.getContractFactory(TOKEN_NAME);
    const token = await Token.attach(taskArgs.address);

    // get signers
    const [, treasury] = await hre.ethers.getSigners();

    console.log("Disabling features...");
    await token.connect(treasury).setAutoSwap(false);
    await token.connect(treasury).setAutoLiquidity(false);
    await token.connect(treasury).setAutoLrf(false);
    await token.connect(treasury).setAutoSafeExit(false);
    console.log("Done!");
  });

task("deploy-all", "Deploys the contract to the blockchain", async (taskArgs, hre) => {
  const token = await hre.run("deploy");
  await hre.run("setup", { address: token.address });
});

task("deploy-and-verify", "Deploys the contract to the blockchain", async (taskArgs, hre) => {
  const token = await hre.run("deploy");
  await hre.run("setup", { address: token.address });
  await hre.run("verify-all", { address: token.address });
});

task("deploy-and-approve", "Deploys the contract to the blockchain", async (taskArgs, hre) => {
  const token = await hre.run("deploy");
  await hre.run("setup", { address: token.address });
  await hre.run("verify-all", { address: token.address });
  await hre.run("approve", { address: token.address });
});

task("presale", "Run presale")
  .addParam("address", "Token contract address")
  .setAction(async (taskArgs, hre) => {
    // get deployed token
    const Token = await hre.ethers.getContractFactory(TOKEN_NAME);
    const token = await Token.attach(taskArgs.address);

    const PreSale = await hre.ethers.getContractFactory("PreSale");
    const preSale = PreSale.attach(await token.getPreSaleAddress());

    // get signers
    const [, treasury] = await hre.ethers.getSigners();
    const [, , account1] = await hre.ethers.getSigners();

    // TODO: REMOVE FOR PROD
    await preSale.connect(treasury).setSoftCap(0);

    console.log("Transferring 270k tokens to presale...");
    await token.connect(treasury).transfer(preSale.address, BigNumber.from("270000000000000000000000"));

    console.log("Opening up public sale...");
    await preSale.connect(treasury).openPublicSale(true);

    // TODO: REMOVE FOR PROD (buy 0.5 eth)
    await preSale.connect(account1).buyTokens({ value: BigNumber.from("500000000000000000") });
    console.log("Done!");
  });

task("finalise", "Finalise pre-sale")
  .addParam("address", "Token contract address")
  .setAction(async (taskArgs, hre) => {
    // get deployed token
    const Token = await hre.ethers.getContractFactory(TOKEN_NAME);
    const token = await Token.attach(taskArgs.address);

    const PreSale = await hre.ethers.getContractFactory("PreSale");
    const preSale = PreSale.attach(await token.getPreSaleAddress());

    const SafeExit = await hre.ethers.getContractFactory("SafeExitFund");
    const safeExit = SafeExit.attach(await token.getSafeExitFundAddress());

    const [, treasury] = await hre.ethers.getSigners();

    console.log("Finalising public sale...");
    await preSale.connect(treasury).finalizeSale();

    console.log("Launching token...");
    await token.connect(treasury).launchToken();

    console.log("Launching Safe Exit NFT...");
    await safeExit.connect(treasury).launchSafeExitNft(123);

    console.log("Done!");
  });

task("stuff", "Test stuff")
  .addParam("address", "Token contract address")
  .setAction(async (taskArgs, hre) => {
    // get deployed token
    const Token = await hre.ethers.getContractFactory(TOKEN_NAME);
    const token = await Token.attach(taskArgs.address);

    const PreSale = await hre.ethers.getContractFactory("PreSale");
    const preSale = PreSale.attach(await token.getPreSaleAddress());

    const router = await hre.ethers.getContractAt("IDexRouter", await token.getRouter());

    // get signers
    const [, treasury] = await hre.ethers.getSigners();
    const [, , account1] = await hre.ethers.getSigners();

    // account1 buy 1 eth of tokens
    // await token.connect(account1).transfer(treasury.address, 10);

    await router.connect(account1).swapExactETHForTokens(
      0, // min number of tokens
      [await router.WETH(), token.address],
      account1.address,
      1659935367099,
      { value: BigNumber.from("100000000000000000") }
    );

    // await token.connect(treasury).rebase();
  });

task("setup", "Set up sub-contracts and DEX")
  .addParam("address", "Token contract address")
  .setAction(async (taskArgs, hre) => {
    // function to deploy sub contracts
    const deploySubContract = async ({ token, deployer, hre, contractName, getAddressFunc, setAddressFunc }) => {
      const Contract = await hre.ethers.getContractFactory(contractName);

      if ((await token[getAddressFunc]()) === ZERO_ADDRESS) {
        console.log(`Deploying ${contractName}...`);

        const contract = await Contract.connect(deployer).deploy(token.address);
        await contract.deployed();

        const tx = await token.connect(deployer)[setAddressFunc](contract.address);
        await tx.wait();
      }
      console.log(`${contractName} deployed at: ${await token[getAddressFunc]()}`);
    };

    // get signers
    const [deployer, treasury] = await hre.ethers.getSigners();

    // get deployed token
    const Token = await hre.ethers.getContractFactory(TOKEN_NAME);
    const token = await Token.attach(taskArgs.address);

    // set up dex
    if ((await token.getRouter()) === ZERO_ADDRESS) {
      console.log("Setting up DEX...");
      const tx = await token.connect(deployer).setDex(TESTNET_DEX_ROUTER_ADDRESS);
      await tx.wait();
    }
    console.log(`N1/AVAX Pair: ${await token.getPair()}`);

    // create swap engine
    await deploySubContract({
      hre,
      token,
      deployer,
      contractName: "SwapEngine",
      getAddressFunc: "getSwapEngineAddress",
      setAddressFunc: "setSwapEngine",
    });

    // create auto liquidity engine
    await deploySubContract({
      hre,
      token,
      deployer,
      contractName: "AutoLiquidityEngine",
      getAddressFunc: "getAutoLiquidityAddress",
      setAddressFunc: "setLiquidityEngine",
    });

    // create LRF
    await deploySubContract({
      hre,
      token,
      deployer,
      contractName: "LiquidityReliefFund",
      getAddressFunc: "getLrfAddress",
      setAddressFunc: "setLrf",
    });

    // create safe exit fund
    await deploySubContract({
      hre,
      token,
      deployer,
      contractName: "SafeExitFund",
      getAddressFunc: "getSafeExitFundAddress",
      setAddressFunc: "setSafeExitFund",
    });

    // create pre-sale
    await deploySubContract({
      hre,
      token,
      deployer,
      contractName: "PreSale",
      getAddressFunc: "getPreSaleAddress",
      setAddressFunc: "setPreSaleEngine",
    });

    // transfer ownership to treasury
    if ((await token.getOwner()) !== treasury.address) {
      console.log("Transferring ownership to treasury...");
      await token.connect(deployer).setTreasury(treasury.address);
    }

    console.log("Done!");
  });

task("verify-all", "Verify all contracts on etherscan")
  .addParam("address", "Token contract address")
  .setAction(async (taskArgs, hre) => {
    // get deployed token
    const Token = await hre.ethers.getContractFactory(TOKEN_NAME);
    const token = await Token.attach(taskArgs.address);

    const lrfAddress = await token.getLrfAddress();
    const autoLiquidityAddress = await token.getAutoLiquidityAddress();
    const safeExitFundAddress = await token.getSafeExitFundAddress();
    const preSaleAddress = await token.getPreSaleAddress();

    await verify(hre, token.address);
    await verify(hre, lrfAddress, [token.address]);
    await verify(hre, autoLiquidityAddress, [token.address]);
    await verify(hre, safeExitFundAddress, [token.address]);
    await verify(hre, preSaleAddress, [token.address]);
  });

task("setup-metadata", "Set URI x SafeExit Metadata")
  .addParam("address", "Token contract address")
  .setAction(async (taskArgs, hre) => {
    const [, treasury] = await hre.ethers.getSigners();

    const Token = await hre.ethers.getContractFactory(TOKEN_NAME);
    const token = await Token.attach(taskArgs.address);

    const SafeExit = await hre.ethers.getContractFactory("SafeExitFund");
    const safeExit = SafeExit.attach(await token.getSafeExitFundAddress()).connect(treasury);

    const IPFS_GATEWAY = "http://ipfs.io/";
    const IPFS_CID = "QmXUZwED1bX3HkibXBbvDNpAvBSqe3ueWkUYUFMdX319ZK";

    const metadataUris = {
      preReveal: "ipfs/" + IPFS_CID + "/SAFE_EXIT_PRE_REVEAL.json",
      tier1live: "ipfs/" + IPFS_CID + "/Tier_1_LIVE_State_100_BNB.json",
      tier1ready: "ipfs/" + IPFS_CID + "/Tier_1_Ready_State_100_BNB.json",
      tier1dead: "ipfs/" + IPFS_CID + "/Tier_1_Used_State_100_BNB.json",
      tier2live: "ipfs/" + IPFS_CID + "/Tier_2_LIVE_State_25_BNB.json",
      tier2ready: "ipfs/" + IPFS_CID + "/Tier_2_Ready_State_25_BNB.json",
      tier2dead: "ipfs/" + IPFS_CID + "/Tier_2_Used_State_25_BNB.json",
      tier3live: "ipfs/" + IPFS_CID + "/Tier_3_LIVE_State_10_BNB.json",
      tier3ready: "ipfs/" + IPFS_CID + "/Tier_3_Ready_State_10_BNB.json",
      tier3dead: "ipfs/" + IPFS_CID + "/Tier_3_Used_State_10_BNB.json",
      tier4live: "ipfs/" + IPFS_CID + "/Tier_4_LIVE_State_5_BNB.json",
      tier4ready: "ipfs/" + IPFS_CID + "/Tier_4_Ready_State_5_BNB.json",
      tier4dead: "ipfs/" + IPFS_CID + "/Tier_4_Used_State_5_BNB.json",
      tier5live: "ipfs/" + IPFS_CID + "/Tier_5_LIVE_State_1_BNB.json",
      tier5ready: "ipfs/" + IPFS_CID + "/Tier_5_Ready_State_1_BNB.json",
      tier5dead: "ipfs/" + IPFS_CID + "/Tier_5_Used_State_1_BNB.json",
    };

    await safeExit.setUnrevealedMetadataUri(IPFS_GATEWAY + metadataUris.preReveal);

    await safeExit.setMetadataUri(
      1,
      IPFS_GATEWAY + metadataUris.tier1live,
      IPFS_GATEWAY + metadataUris.tier1ready,
      IPFS_GATEWAY + metadataUris.tier1dead
    );
    await safeExit.setMetadataUri(
      2,
      IPFS_GATEWAY + metadataUris.tier2live,
      IPFS_GATEWAY + metadataUris.tier2ready,
      IPFS_GATEWAY + metadataUris.tier2dead
    );
    await safeExit.setMetadataUri(
      3,
      IPFS_GATEWAY + metadataUris.tier3live,
      IPFS_GATEWAY + metadataUris.tier3ready,
      IPFS_GATEWAY + metadataUris.tier3dead
    );
    await safeExit.setMetadataUri(
      4,
      IPFS_GATEWAY + metadataUris.tier4live,
      IPFS_GATEWAY + metadataUris.tier4ready,
      IPFS_GATEWAY + metadataUris.tier4dead
    );
    await safeExit.setMetadataUri(
      5,
      IPFS_GATEWAY + metadataUris.tier5live,
      IPFS_GATEWAY + metadataUris.tier5ready,
      IPFS_GATEWAY + metadataUris.tier5dead
    );
  });

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: "0.8.9",
  settings: {
    optimizer: {
      enabled: true,
      runs: 1,
    },
  },
  networks: {
    hardhat: {
      hostname: "127.0.0.1",
      port: 8545,
      chainId: 1337,
      accounts,
      forking: {
        url: TESTNET_URL,
      },
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      gasPrice: 225000000000,
      gasLimit: 21000,
    },
    testnet: {
      url: TESTNET_URL,
      chainId: parseInt(TESTNET_CHAIN_ID),
      accounts: accounts.map((x) => x.privateKey),
    },
    mainnet: {
      url: MAINNET_URL,
      chainId: parseInt(MAINNET_CHAIN_ID),
      accounts: accounts.map((x) => x.privateKey),
    },
  },
  gasReporter: {
    enabled: REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },
};
