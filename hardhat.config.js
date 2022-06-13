const { task } = require("hardhat/config");
const { verify } = require("./helpers/verify");
const { getAccounts } = require("./helpers/accounts");

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

task("presale", "Run presale").setAction(async (taskArgs, hre) => {
  const token = await hre.run("deploy");
  await hre.run("setup", { address: token.address });

  const PreSale = await hre.ethers.getContractFactory("PreSale");
  const preSale = PreSale.attach(await token.getPreSaleAddress());

  // get signers
  const [, treasury, account1] = await hre.ethers.getSigners();

  console.log("Setting up pre-sale...");
  await preSale.connect(treasury).addToWhitelist([account1.address], 1);
  console.log("Done!");
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
