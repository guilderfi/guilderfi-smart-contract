const { expect } = require("chai");
const { ethers } = require("hardhat");

const { deploy } = require("../helpers/deploy");
const { MAX_INT, ether, print, createWallet } = require("../helpers/utils");
const { transferTokens, transferEth, buyTokensFromDexByExactEth, addLiquidity, gasUsed, getLiquidityReserves } = require("../helpers");
const { tier1, tier2, tier3 } = require("../helpers/data");

let token;
let deployer;
let treasury;
let router;
let pair;
let preSale;
let safeExit;

const account1 = createWallet(ethers);
const account2 = createWallet(ethers);
const account3 = createWallet(ethers);
const account6 = createWallet(ethers);

describe(`Testing safe exit..`, function () {
  before(async function () {
    // Set up accounts
    [deployer, treasury] = await ethers.getSigners();

    print(`Deploying smart contracts..`);
    token = await deploy({ ethers, deployer, treasury });

    // contracts
    router = await ethers.getContractAt("IDexRouter", await token.getRouter());
    pair = await ethers.getContractAt("IDexPair", await token.getPair());
    preSale = await ethers.getContractAt("PreSale", await token.getPreSaleAddress());
    safeExit = await ethers.getContractAt("SafeExitFund", await token.getSafeExitFundAddress());

    // send 27m tokens to presale contract
    await transferTokens({ token, from: treasury, to: preSale, amount: ether(27000000) });

    // add some eth to safe exit fund
    await transferEth({ from: treasury, to: safeExit, amount: ether(10) });

    // transfer some eth to test accounts
    await transferEth({ from: deployer, to: account1, amount: ether(150) });
    await transferEth({ from: deployer, to: account2, amount: ether(150) });
    await transferEth({ from: deployer, to: account3, amount: ether(150) });
    await transferEth({ from: deployer, to: account6, amount: ether(150) });

    // setup custom sales tiers
    await preSale.connect(treasury).addCustomTier(tier1.tierId, tier1.minAmount, tier1.maxAmount, tier1.tokensPerEth);
    await preSale.connect(treasury).addCustomTier(tier2.tierId, tier2.minAmount, tier2.maxAmount, tier2.tokensPerEth);
    await preSale.connect(treasury).addCustomTier(tier3.tierId, tier3.minAmount, tier3.maxAmount, tier3.tokensPerEth);

    // Approve DEX to transfer
    await token.connect(treasury).approve(router.address, MAX_INT);

    // Add 10 million tokens + 10 eth into liquidity
    const tokenAmount = ether(100);
    const ethAmount = ether(100);
    await addLiquidity({
      router,
      from: treasury,
      token,
      tokenAmount,
      ethAmount,
    });
  });

  it("Should mint correct number of NFTs with each purchase", async function () {
    // check each tier1,2,3,public sale receives an NFT
    // open sale
    expect(await safeExit.issuedTokens()).to.equal(0);

    await preSale.connect(treasury).openPublicSale(true);
    await preSale.connect(treasury).openWhitelistSale(1, true);
    await preSale.connect(treasury).openWhitelistSale(2, true);
    await preSale.connect(treasury).openWhitelistSale(3, true);

    // add whitelist participants
    await preSale.connect(treasury).addToWhitelist([account1.address], tier1.tierId);
    await preSale.connect(treasury).addToWhitelist([account2.address], tier2.tierId);
    await preSale.connect(treasury).addToWhitelist([account3.address], tier3.tierId);

    // buy minimum for each tier
    await preSale.connect(account1).buyTokens({ value: tier1.minAmount });
    await preSale.connect(account2).buyTokens({ value: tier2.minAmount });
    await preSale.connect(account3).buyTokens({ value: tier3.minAmount });

    // check that 1 NFT has been minted for each account
    expect(await safeExit.balanceOf(account1.address)).to.equal(1);
    expect(await safeExit.balanceOf(account2.address)).to.equal(1);
    expect(await safeExit.balanceOf(account3.address)).to.equal(1);

    // buy up to maximum for each tier
    await preSale.connect(account1).buyTokens({ value: tier1.maxAmount.sub(tier1.minAmount) });
    await preSale.connect(account2).buyTokens({ value: tier2.maxAmount.sub(tier2.minAmount) });
    await preSale.connect(account3).buyTokens({ value: tier3.maxAmount.sub(tier3.minAmount) });

    // each account should still only have 1 NFT
    expect(await safeExit.balanceOf(account1.address)).to.equal(1);
    expect(await safeExit.balanceOf(account2.address)).to.equal(1);
    expect(await safeExit.balanceOf(account3.address)).to.equal(1);

    expect(await safeExit.issuedTokens()).to.equal(3);
  });

  it("Should fill the NFTs with each purchase during pre-sale", async function () {
    // buy fixed amount
    await preSale.connect(treasury).openWhitelistSale(4, true);
    await preSale.connect(treasury).addToWhitelist([account6.address], 4);
    await preSale.connect(account6).buyTokens({ value: ether(1) });

    // finalise sale
    await preSale.connect(treasury).setLockDuration(0);
    await preSale.connect(treasury).finalizeSale();

    // set random safe exit seed
    await safeExit.connect(treasury).setRandomSeed(123456);

    // approve safe exit to burn tokens
    await token.connect(account6).approve(safeExit.address, MAX_INT);

    // check previous eth balance
    const account6ethBalanceBefore = await ethers.provider.getBalance(account6.address);

    // claim safe exit
    const tx = await safeExit.connect(account6).claimSafeExit();
    const gas = await gasUsed(tx);

    // check eth balance has increased by correct amount
    const account6ethBalanceAfter = await ethers.provider.getBalance(account6.address);
    const account6ethPayout = account6ethBalanceAfter.sub(account6ethBalanceBefore);
    expect(account6ethPayout).to.equal(ether(1.0625).sub(gas)); // account for gas
    expect(await token.balanceOf(account6.address)).to.equal(0);
  });

  it("Should fill NFTs during post-sale when buying from exchange", async function () {
    // create random wallet and fund with 10 ether
    const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
    await transferEth({ from: deployer, to: wallet, amount: ether(10) });

    // check eth balance before buying from exchange
    expect(await token.balanceOf(wallet.address)).to.equal(0);

    // check eth balance before buying from exchange
    const ethBalanceBeforeBuy = await ethers.provider.getBalance(wallet.address);

    // buy exact amount of eth worth of tokens from exchange
    const tx = await buyTokensFromDexByExactEth({ router, token, account: wallet, ethAmount: ether(1) });
    // const tx = await buyTokensFromDex({ router, pair, token, account: wallet, tokenAmount: ether(1) });
    const gas = await gasUsed(tx);

    print(`Tokens received: ${ethers.utils.formatEther(await token.balanceOf(wallet.address))}`);

    const { ethReserves, tokenReserves } = await getLiquidityReserves({ token, pair });
    print(`LP - eth:         ${ethers.utils.formatEther(ethReserves, { comify: true })}`);
    print(`LP - tokens:      ${ethers.utils.formatEther(tokenReserves, { comify: true })}`);

    // check eth balance has reduced by 0.5 eth
    const ethBalanceAfterBuy = await ethers.provider.getBalance(wallet.address);
    const ethSpent = ethBalanceBeforeBuy.sub(ethBalanceAfterBuy);
    expect(ethSpent).to.equal(ether(1).add(gas)); // account for gas

    const status = await safeExit.connect(wallet).getInsuranceStatus(wallet.address);
    print(`Eth Purchases recorded: ${ethers.utils.formatEther(status.totalPurchaseAmount)})`);
  });

  /*
  it("Should fill NFTs during post-sale when buying from exchange", async function () {
    // check eth balance before buying from exchange
    const ethBalanceBeforeBuy = await ethers.provider.getBalance(account7.address);

    console.log(await token.balanceOf(account7.address));
    // buy exact amount of eth worth of tokens from exchange
    const tx = await buyTokensFromDexByExactEth({ router, token, account: account7, ethAmount: ether(0.5) });
    const gas = await gasUsed(tx);

    console.log(await token.balanceOf(account7.address));

    const { ethReserves, tokenReserves } = await getLiquidityReserves({ token, pair });
    console.log(`LP - eth:         ${ethers.utils.formatEther(ethReserves, { comify: true })}`);
    console.log(`LP - tokens:      ${ethers.utils.formatEther(tokenReserves, { comify: true })}`);

    // check eth balance has reduced by 0.5 eth
    const ethBalanceAfterBuy = await ethers.provider.getBalance(account7.address);
    const ethSpent = ethBalanceBeforeBuy.sub(ethBalanceAfterBuy).sub(gas);
    expect(ethSpent).to.equal(ether(0.5)); // account for gas

    // check previous eth balance before safe exit
    const ethBalanceBeforeSafeExit = await ethers.provider.getBalance(account7.address);
    const status = await safeExit.connect(account7).getInsuranceStatus(account7.address);
    console.log(status);

    // claim safe exit
    const txSafeExit = await safeExit.connect(account7).claimSafeExit();
    const gasSafeExit = await gasUsed(txSafeExit);

    // check eth balance has increased by correct amount (0.5 + 0.5) = 1 + premium (6.25)
    const ethBalanceAfterSafeExit = await ethers.provider.getBalance(account7.address);
    const ethPayout = ethBalanceAfterSafeExit.sub(ethBalanceBeforeSafeExit).add(gasSafeExit);
    // expect(ethPayout).to.equal(ether(1.0625).sub(gasSafeExit)); // account for gas
  });
  */
  /*
  it("Should clear NFT balance when transferred to another wallet", async function () {
    // buy tokens
    // check balance increases
  });

  it("Should allow user to claim safe exit using NFT", async function () {
    // todo
  });
  */

  // add tests for custom nft
  // approve contract to do transferFrom before burning when doing a claim
  // check metadata update
});
