// const { expect } = require("chai");
const { ethers } = require("hardhat");
const { task } = require("hardhat/config");

const {
  buyTokensFromDexByExactEth,
  sellTokens,
  addLiquidity,
  transferEth,
  ether,
  print,
  getLiquidityReserves,
  MAX_INT,
} = require("../helpers");

const { TESTNET_DEX_ROUTER_ADDRESS } = process.env;
const TOKEN_NAME = "GuilderFi";

let deployer;
let token;
let router;
let pair;
let treasury;

describe(`Testing ${TOKEN_NAME}..`, function () {
  before(async function () {
    // Set up accounts
    [deployer, treasury] = await ethers.getSigners();

    print(`Deploying smart contracts..`);

    const Token = await ethers.getContractFactory(TOKEN_NAME);
    const SwapEngine = await ethers.getContractFactory("SwapEngine");
    const AutoLiquidityEngine = await ethers.getContractFactory("AutoLiquidityEngine");
    const LiquidityReliefFund = await ethers.getContractFactory("LiquidityReliefFund");
    const SafeExitFund = await ethers.getContractFactory("SafeExitFund");
    const PreSale = await ethers.getContractFactory("PreSale");

    // Deploy contract
    token = await Token.deploy();
    global.token = token;
    await token.deployed();

    let tx;

    // create swap engine
    const _swapEngine = await SwapEngine.connect(deployer).deploy(token.address);
    await token.connect(deployer).setSwapEngine(_swapEngine.address);

    // create auto liquidity engine
    const _autoLiquidityEngine = await AutoLiquidityEngine.connect(deployer).deploy(token.address);
    await token.connect(deployer).setLiquidityEngine(_autoLiquidityEngine.address);

    // create LRF
    const _lrf = await LiquidityReliefFund.connect(deployer).deploy(token.address);
    await token.connect(deployer).setLrf(_lrf.address);

    // create safe exit fund
    const _safeExit = await SafeExitFund.connect(deployer).deploy(token.address);
    await token.connect(deployer).setSafeExitFund(_safeExit.address);

    // create pre-sale
    const _preSale = await PreSale.connect(deployer).deploy(token.address);
    await token.connect(deployer).setPreSaleEngine(_preSale.address);

    // set up dex
    await token.connect(deployer).setDex(TESTNET_DEX_ROUTER_ADDRESS);

    // set up treasury
    await token.connect(deployer).setTreasury(treasury.address);

    // Set dex variables
    // router = await ethers.getContractAt("IDexRouter", await token.getRouter());
    router = await ethers.getContractAt("IDexRouter", "0xc9C6f026E489e0A8895F67906ef1627f1E56860d");
    pair = await ethers.getContractAt("IDexPair", await token.getPair());

    tx = await token.connect(treasury).setAutoSwap(true);
    await tx.wait();

    tx = await token.connect(treasury).setAutoLiquidity(true);
    await tx.wait();

    tx = await token.connect(treasury).setAutoRebase(true);
    await tx.wait();

    tx = await token.connect(treasury).setAutoLrf(true);
    await tx.wait();

    tx = await token.connect(treasury).setAutoSafeExit(true);
    await tx.wait();

    tx = await token.connect(treasury).setAutoLiquidityFrequency(0);
    await tx.wait();

    tx = await token.connect(treasury).setLrfFrequency(0);
    await tx.wait();

    tx = await token.connect(treasury).setSwapFrequency(0);
    await tx.wait();

    tx = await token.connect(treasury).launchToken();
    await tx.wait();
  });

  it("Should allow transactions when all features are enabled", async function () {
    let tx;

    // create random wallet and fund with 10 ether
    const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
    await transferEth({ from: deployer, to: wallet, amount: ether(10) });

    tx = await token.connect(treasury).approve(router.address, MAX_INT);
    await tx.wait();

    const tokenAmount = ether(1000);
    const ethAmount = ether(1);

    tx = await addLiquidity({
      router,
      from: treasury,
      token,
      tokenAmount,
      ethAmount,
    });
    await tx.wait();

    // get pair -> todo: remove after setting dex
    const factory = await ethers.getContractAt("IDexFactory", await router.factory());
    pair = await ethers.getContractAt("IDexPair", await factory.getPair(await router.WETH(), token.address));

    // expect(await token.balanceOf(wallet.address)).to.equal(0);
    tx = await buyTokensFromDexByExactEth({ router, pair, token, account: wallet, ethAmount: ether(0.1) });
    await tx.wait();

    await token.connect(wallet).approve(router.address, await token.balanceOf(wallet.address));
    tx = await sellTokens({
      router,
      token,
      account: wallet,
      tokenAmount: await token.balanceOf(wallet.address),
    });
    await tx.wait();

    // const { tokenReserves, ethReserves } = await getLiquidityReserves({ token, pair });

    tx = await token.connect(treasury).approve(router.address, MAX_INT);
    await tx.wait();
  });

  it("Remove liquidity", async () => {
    const tx = await router
      .connect(treasury)
      .removeLiquidityETHSupportingFeeOnTransferTokens(
        token.address,
        await pair.balanceOf(treasury.address),
        0,
        0,
        treasury.address,
        (await ethers.provider.getBlock("latest")).timestamp + 1200
      );

    await tx.wait();
  });
});
