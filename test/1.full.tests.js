const { expect } = require("chai");
const { ethers } = require("hardhat");

const { buyTokensFromDexByExactEth, sellTokens, addLiquidity, ether, print, getLiquidityReserves, MAX_INT } = require("../helpers");

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

    /*
    const TOKEN_ADDRESS = "0xf7d9a415A7e379B3be6422321a3eE6AE44098476";
    const Token = await ethers.getContractFactory(TOKEN_NAME);
    token = Token.attach(TOKEN_ADDRESS);
    router = await ethers.getContractAt("IDexRouter", TESTNET_DEX_ROUTER_ADDRESS);

    if ((await token.getOwner()) !== treasury.address) {
      const tx = await token.connect(deployer).setTreasury(treasury.address);
      await tx.wait();
    }
    */
    print(`Deploying smart contracts..`);

    const Token = await ethers.getContractFactory(TOKEN_NAME);
    const SwapEngine = await ethers.getContractFactory("SwapEngine");
    const AutoLiquidityEngine = await ethers.getContractFactory("AutoLiquidityEngine");
    const LiquidityReliefFund = await ethers.getContractFactory("LiquidityReliefFund");
    const SafeExitFund = await ethers.getContractFactory("SafeExitFund");
    const PreSale = await ethers.getContractFactory("PreSale");

    // Deploy contract
    token = await Token.deploy();
    await token.deployed();

    // to do: remove
    // router = await ethers.getContractAt("IDexRouter", TESTNET_DEX_ROUTER_ADDRESS);

    let tx;

    // create swap engine
    const _swapEngine = await SwapEngine.connect(deployer).deploy(token.address);
    await _swapEngine.deployed();
    await token.connect(deployer).setSwapEngine(_swapEngine.address);

    // create auto liquidity engine
    const _autoLiquidityEngine = await AutoLiquidityEngine.connect(deployer).deploy(token.address);
    await _autoLiquidityEngine.deployed();
    await token.connect(deployer).setLiquidityEngine(_autoLiquidityEngine.address);

    // create LRF
    const _lrf = await LiquidityReliefFund.connect(deployer).deploy(token.address);
    await _lrf.deployed();
    await token.connect(deployer).setLrf(_lrf.address);

    // create safe exit fund
    const _safeExit = await SafeExitFund.connect(deployer).deploy(token.address);
    await _safeExit.deployed();
    await token.connect(deployer).setSafeExitFund(_safeExit.address);

    // create pre-sale
    const _preSale = await PreSale.connect(deployer).deploy(token.address);
    await _preSale.deployed();
    await token.connect(deployer).setPreSaleEngine(_preSale.address);

    // set up dex
    await token.connect(deployer).setDex(TESTNET_DEX_ROUTER_ADDRESS);

    // set up treasury
    await token.connect(deployer).setTreasury(treasury.address);

    // Set dex variables
    router = await ethers.getContractAt("IDexRouter", await token.getRouter());
    pair = await ethers.getContractAt("IDexPair", await token.getPair());

    tx = await token.connect(treasury).setAutoSwap(true);
    await tx.wait();

    tx = await token.connect(treasury).setAutoLiquidity(false);
    await tx.wait();

    tx = await token.connect(treasury).setAutoRebase(true);
    await tx.wait();

    tx = await token.connect(treasury).setAutoLrf(false);
    await tx.wait();

    tx = await token.connect(treasury).setAutoSafeExit(true);
    await tx.wait();

    tx = await token.connect(treasury).setAutoLiquidityFrequency(0);
    await tx.wait();

    tx = await token.connect(treasury).setLrfFrequency(0);
    await tx.wait();

    tx = await token.connect(treasury).setSwapFrequency(0);
    await tx.wait();

    // tx = await token.connect(treasury).launchToken();
    // await tx.wait();
  });

  it("Add liquidity", async function () {
    let tx;

    tx = await token.connect(treasury).approve(router.address, MAX_INT);
    await tx.wait();

    const tokenAmount = ether(100);
    const ethAmount = ether(0.1);

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
  });

  it("Buy tokens", async () => {
    // create random wallet and fund with 10 ether
    const wallet = deployer;
    // const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
    // await transferEth({ from: deployer, to: wallet, amount: ether(10) });

    expect(await token.balanceOf(wallet.address)).to.equal(0);
    const tx = await buyTokensFromDexByExactEth({ router, pair, token, account: wallet, ethAmount: ether(0.01) });
    await tx.wait();
  });

  it("Sell tokens", async () => {
    let tx;
    const wallet = deployer;

    tx = await token.connect(wallet).approve(router.address, MAX_INT);
    await tx.wait();

    tx = await sellTokens({
      router,
      token,
      account: wallet,
      tokenAmount: await token.balanceOf(wallet.address),
    });
    await tx.wait();
  });

  it("Remove liquidity", async () => {
    let tx;

    tx = await pair.connect(treasury).approve(router.address, MAX_INT);
    await tx.wait();

    tx = await router
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
