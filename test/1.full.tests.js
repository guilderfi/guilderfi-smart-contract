// const { expect } = require("chai");
const { ethers } = require("hardhat");

const { buyTokensFromDexByExactEth, sellTokens, addLiquidity, transferEth, ether, print, MAX_INT } = require("./helpers");

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
    router = await ethers.getContractAt("IDexRouter", await token.getRouter());
    pair = await ethers.getContractAt("IDexPair", await token.getPair());

    tx = await token.connect(treasury).setAutoSwap(true);
    await tx.wait();

    tx = await token.connect(treasury).setAutoLiquidity(true);
    await tx.wait();

    tx = await token.connect(treasury).setAutoRebase(true);
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
    // create random wallet and fund with 10 ether
    const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
    await transferEth({ from: deployer, to: wallet, amount: ether(0.2) });
    await transferEth({ from: deployer, to: wallet, amount: ether(1) });

    await token.connect(treasury).approve(await token.getRouter(), MAX_INT);
    const tokenAmount = ether(1000);
    const ethAmount = ether(1);

    let tx;

    tx = await addLiquidity({
      router,
      from: treasury,
      token,
      tokenAmount,
      ethAmount,
    });
    await tx.wait();

    // expect(await token.balanceOf(wallet.address)).to.equal(0);
    tx = await buyTokensFromDexByExactEth({ router, pair, token, account: wallet, ethAmount: ether(0.1) });
    await tx.wait();

    await token.connect(wallet).approve(await token.getRouter(), await token.balanceOf(wallet.address));
    tx = await sellTokens({
      router,
      token,
      account: wallet,
      tokenAmount: await token.balanceOf(wallet.address),
    });
    await tx.wait();

    // await printStatus({ token, treasury, ethers });

    /*
    const { tokenReserves, ethReserves } = await getLiquidityReserves({ token, pair });

    await router
      .connect(treasury)
      .removeLiquidityETHSupportingFeeOnTransferTokens(
        token.address,
        await pair.balanceOf(treasury.address),
        tokenReserves.div(2),
        ethReserves.div(2),
        treasury.address,
        (await ethers.provider.getBlock("latest")).timestamp + 86400
      );
    */
  });
});
