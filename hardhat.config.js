const path = require("path");
const { task } = require("hardhat/config");
const fs = require("fs");
const { merge } = require("sol-merger");
const { parse } = require("csv-parse/sync");

const { verify } = require("./helpers/verify");

require("dotenv").config();
require("@nomiclabs/hardhat-etherscan");
require("@nomiclabs/hardhat-waffle");
require("hardhat-gas-reporter");
require("solidity-coverage");
require("hardhat-contract-sizer");

const {
  TESTNET_URL,
  TESTNET_CHAIN_ID,
  TESTNET_DEX_ROUTER_ADDRESS,
  MAINNET_URL,
  MAINNET_CHAIN_ID,
  PRIVATE_KEY,
  ETHERSCAN_API_KEY,
  REPORT_GAS,
} = process.env;
const TOKEN_NAME = "GuilderFi";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// fetch accounts from csv file
const accounts = [];
const inputCsvData = fs.readFileSync("./accounts.csv", "utf-8");
const records = parse(inputCsvData, { columns: true });
for (let i = 0; i < records.length; i++) {
  const row = records[i];
  accounts.push({ privateKey: row.private_key, balance: row.balance });
}

task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();
  for (const account of accounts) {
    console.log(account.address); // public key
  }
});

task("deploy", "Deploys the contract to the blockchain", async (taskArgs, hre) => {
  const Token = await hre.ethers.getContractFactory(TOKEN_NAME);
  const token = await Token.deploy();

  console.log("Token deployed to contract address: ", token.address);
});

task("deploy-and-verify", "Deploys the contract to the blockchain", async (taskArgs, hre) => {
  const Token = await hre.ethers.getContractFactory(TOKEN_NAME);
  const token = await Token.deploy();

  console.log("Token deployed to contract address: ", token.address);

  const lrfAddress = await token.getLrfAddress();
  const autoLiquidityAddress = await token.getAutoLiquidityAddress();
  const safeExitFundAddress = await token.getSafeExitFundAddress();
  const preSaleAddress = await token.getPreSaleAddress();

  await hre.run("verify:verify", { address: token.address, network: hre.network.name });
  await hre.run("verify:verify", { address: lrfAddress, network: hre.network.name });
  await hre.run("verify:verify", { address: autoLiquidityAddress, network: hre.network.name });
  await hre.run("verify:verify", { address: safeExitFundAddress, network: hre.network.name });
  await hre.run("verify:verify", { address: preSaleAddress, network: hre.network.name });
});

task("presale", "Run presale stuff", async (taskArgs, hre) => {
  const Token = await hre.ethers.getContractFactory(TOKEN_NAME);
  const PreSale = await hre.ethers.getContractFactory("PreSale");

  const token = await Token.deploy();
  const preSaleAddress = await token.getPreSaleAddress();
  const preSale = PreSale.attach(preSaleAddress);

  console.log("Pre sale address is: ", preSaleAddress);
  console.log("Pre sale - public sale is open: ", await preSale.isPublicSaleOpen());
});

task("script", "Run a script, e.g. scripts/airdrop.js")
  .addParam("file", "Script to run")
  .setAction(async (taskArgs, hre) => {
    const script = require(taskArgs.file);
    await script.run(hre.ethers);
  });

task("merge", "Merge solidity contracts", async (taskArgs, hre) => {
  const outputFolder = "artifacts";
  const outputFile = "merged.sol";
  const outputFolderPath = path.join(__dirname, outputFolder);
  const outputFilePath = path.join(outputFolderPath, outputFile);

  // merge files
  let mergedCode = await merge(`./contracts/${TOKEN_NAME}.sol`, { removeComments: true });

  // add license header
  mergedCode = "// SPDX-License-Identifier: MIT\n\n" + mergedCode;

  fs.mkdirSync(outputFolderPath, { recursive: true });
  fs.writeFileSync(outputFilePath, mergedCode, "utf-8");

  console.log("File created: ", outputFilePath);
});

task("setup", "Set up")
  .addParam("address", "Main GuilderFi contract address")
  .setAction(async (taskArgs, hre) => {
    // get treasury signer
    const deployer = (await hre.ethers.getSigners())[0];
    const treasury = (await hre.ethers.getSigners())[1];

    const Token = await hre.ethers.getContractFactory(TOKEN_NAME);
    const SwapEngine = await hre.ethers.getContractFactory("SwapEngine");
    const AutoLiquidityEngine = await hre.ethers.getContractFactory("AutoLiquidityEngine");
    const LiquidityReliefFund = await hre.ethers.getContractFactory("LiquidityReliefFund");
    const SafeExitFund = await hre.ethers.getContractFactory("SafeExitFund");
    const PreSale = await hre.ethers.getContractFactory("PreSale");

    // get deployed token
    const token = await Token.attach(taskArgs.address);

    // set up dex
    if ((await token.getRouter()) === ZERO_ADDRESS) {
      console.log("Setting up DEX...");
      await token.connect(deployer).setDex(TESTNET_DEX_ROUTER_ADDRESS);
    }
    console.log(`N1/AVAX Pair: ${await token.getPair()}`);

    // create swap engine
    if ((await token.getSwapEngineAddress()) === ZERO_ADDRESS) {
      console.log("Deploying Swap Engine...");
      const swapEngine = await SwapEngine.connect(deployer).deploy(token.address);
      await token.connect(deployer).setSwapEngine(swapEngine.address);
    }
    console.log(`Swap Engine deployed at: ${await token.getSwapEngineAddress()}`);

    // create auto liquidity engine
    if ((await token.getAutoLiquidityAddress()) === ZERO_ADDRESS) {
      console.log("Deploying Auto Liquidity Engine...");
      const autoLiquidityEngine = await AutoLiquidityEngine.connect(deployer).deploy(token.address);
      await token.connect(deployer).setLiquidityEngine(autoLiquidityEngine.address);
    }
    console.log(`Auto Liquidity Engine deployed at: ${await token.getAutoLiquidityAddress()}`);

    // create LRF
    if ((await token.getLrfAddress()) === ZERO_ADDRESS) {
      console.log("Deploying Liquidity Relief Fund...");
      const lrf = await LiquidityReliefFund.connect(deployer).deploy(token.address);
      await token.connect(deployer).setLrf(lrf.address);
    }
    console.log(`LRF deployed at: ${await token.getLrfAddress()}`);

    // create safe exit fund
    if ((await token.getSafeExitFundAddress()) === ZERO_ADDRESS) {
      console.log("Deploying Safe Exit Fund...");
      const safeExit = await SafeExitFund.connect(deployer).deploy(token.address);
      await token.connect(deployer).setSafeExitFund(safeExit.address);
    }
    console.log(`Safe Exit deployed at: ${await token.getSafeExitFundAddress()}`);

    // create pre-sale
    if ((await token.getPreSaleAddress()) === ZERO_ADDRESS) {
      console.log("Deploying Pre-Sale...");
      const preSale = await PreSale.connect(deployer).deploy(token.address);
      await token.connect(deployer).setPreSaleEngine(preSale.address);
    }
    console.log(`Pre-sale deployed at: ${await token.getPreSaleAddress()}`);

    // transfer ownership to treasury
    if ((await token.getOwner()) !== treasury.address) {
      console.log("Transferring ownership to treasury...");
      await token.connect(deployer).setTreasury(treasury.address);
    }

    console.log("Done!");
  });

task("turn-on", "Turn everything on")
  .addParam("address", "Main GuilderFi contract address")
  .setAction(async (taskArgs, hre) => {
    // get treasury signer
    const treasury = (await hre.ethers.getSigners())[1];

    const Token = await hre.ethers.getContractFactory(TOKEN_NAME);

    // get deployed token
    const token = await Token.attach(taskArgs.address);

    const tx = await token.connect(treasury).launchToken();
    await tx.wait();
  });

task("verify-all", "Verify all contracts on etherscan")
  .addParam("address", "Main GuilderFi contract address")
  .setAction(async (taskArgs, hre) => {
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
      chainId: parseInt(TESTNET_CHAIN_ID),
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
      accounts: accounts.map((x) => x.privateKey), // accounts: PRIVATE_KEY !== undefined ? [PRIVATE_KEY] : [],
    },
    mainnet: {
      url: MAINNET_URL,
      chainId: parseInt(MAINNET_CHAIN_ID),
      accounts: PRIVATE_KEY !== undefined ? [PRIVATE_KEY] : [],
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
