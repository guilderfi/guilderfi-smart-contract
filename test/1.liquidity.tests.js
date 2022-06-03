const { expect } = require("chai");
const { ethers } = require("hardhat");

const { deploy } = require("../helpers/deploy");
const { MAX_INT, TOKEN_NAME, ether, print } = require("../helpers/utils");
const { buyTokensFromDexByExactEth, sellTokens, addLiquidity } = require("../helpers");
const { TESTNET_DEX_ROUTER_ADDRESS } = process.env;

let token;
let deployer;
let treasury;
let router;
let pair;

describe(`Testing liqudity..`, function () {
  before(async function () {
    // Set up accounts
    [deployer, treasury] = await ethers.getSigners();
    /*
    const TOKEN_ADDRESS = "0x0f838e9B220559c11277E0329b369146f66DE630";
    const Token = await ethers.getContractFactory(TOKEN_NAME);
    token = Token.attach(TOKEN_ADDRESS);
    router = await ethers.getContractAt("IDexRouter", TESTNET_DEX_ROUTER_ADDRESS);
    */
    print(`Deploying smart contracts..`);
    token = await deploy({ ethers, deployer, treasury });

    // contracts
    router = await ethers.getContractAt("IDexRouter", await token.getRouter());
    pair = await ethers.getContractAt("IDexPair", await token.getPair());
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
      .removeLiquidityETH(
        token.address,
        (await pair.balanceOf(treasury.address)).div(2),
        0,
        0,
        treasury.address,
        (await ethers.provider.getBlock("latest")).timestamp + 1200
      );

    await tx.wait();
  });
});
