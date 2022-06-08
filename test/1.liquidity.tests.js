const { expect } = require("chai");
const { ethers } = require("hardhat");

const { deploy } = require("../helpers/deploy");
const { MAX_INT, ether, print } = require("../helpers/utils");
const { buyTokensFromDexByExactEth, sellTokens, addLiquidity } = require("../helpers");

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
    const TOKEN_ADDRESS = "0xaA0EEdDa8573093Fd5c6AFF7Ccb5954BCa078529";
    const Token = await ethers.getContractFactory("GuilderFi");
    token = Token.attach(TOKEN_ADDRESS);
    router = await ethers.getContractAt("IDexRouter", process.env.TESTNET_DEX_ROUTER_ADDRESS);

    const factory = await ethers.getContractAt("IDexFactory", await router.factory());
    pair = await ethers.getContractAt("IDexPair", await factory.getPair(await router.WETH(), token.address));
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
    const wallet = deployer;

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
        await pair.balanceOf(treasury.address),
        0,
        0,
        treasury.address,
        (await ethers.provider.getBlock("latest")).timestamp + 1200
      );

    await tx.wait();
  });
});
