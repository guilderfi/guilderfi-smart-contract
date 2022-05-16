const { ethers } = require("hardhat");
const { BigNumber } = require("ethers");
const clc = require("cli-color");

const addZeroes = (num, zeroes) => {
  return BigNumber.from(num).mul(BigNumber.from(10).pow(zeroes));
};

const print = (msg) => {
  console.log(clc.xterm(8)("      " + msg));
};

const transferTokens = async ({ token, from, to, amount }) => {
  const transaction = await token.connect(from).transfer(to.address, amount);
  await transaction.wait();
};

const transferEth = async ({ from, to, amount }) => {
  const tx = await from.sendTransaction({
    to: to.address,
    value: amount,
  });
  await tx.wait();
};

const addLiquidity = async ({ router, from, token, tokenAmount, ethAmount }) => {
  const timestamp = (await ethers.provider.getBlock("latest")).timestamp + 100;
  await router.connect(from).addLiquidityETH(token.address, tokenAmount, 0, 0, from.address, timestamp, {
    value: ethAmount,
  });
};

const buyTokens = async ({ router, token, account, tokenAmount }) => {
  await router
    .connect(account)
    .swapETHForExactTokens(
      tokenAmount,
      [await router.WETH(), token.address],
      account.address,
      (await ethers.provider.getBlock("latest")).timestamp + 100,
      { value: BigNumber.from("10000000000000000") }
    );
};

const sellTokens = async ({ router, token, account, tokenAmount }) => {
  await router.connect(account).swapExactTokensForETHSupportingFeeOnTransferTokens(
    tokenAmount,
    0, // minimum ETH out
    [token.address, await router.WETH()], // pair
    account.address, // recipient
    (await ethers.provider.getBlock("latest")).timestamp + 100
  );
};

const getLiquidityReserves = async ({ token, pair }) => {
  let returnVal;
  const reserves = await pair.getReserves();

  // Check which token (0/1) is eth vs token
  if ((await pair.token0()) === token.address) {
    returnVal = {
      tokenReserves: reserves.reserve0,
      ethReserves: reserves.reserve1,
    };
  } else {
    returnVal = {
      tokenReserves: reserves.reserve1,
      ethReserves: reserves.reserve0,
    };
  }

  returnVal.tokenPrice = returnVal.ethReserves / returnVal.tokenReserves;
  return returnVal;
};

const calculateEthToReceive = async ({ token, pair, tokenAmount }) => {
  const reserves = await getLiquidityReserves({ token, pair });
  const amountInWithFee = tokenAmount.mul(9975);
  const numerator = amountInWithFee.mul(reserves.ethReserves);
  const denominator = reserves.tokenReserves.mul(10000).add(amountInWithFee);
  return numerator.div(denominator);
};

const calculateInitialLP = ({ tokenAmount, ethAmount }) => {
  // https://www.reddit.com/r/UniSwap/comments/i49dmk/how_are_lp_token_amounts_calculated/

  const MINIMUM_LIQUIDITY = 1000;

  const sqrt = (value) => {
    const ONE = ethers.BigNumber.from(1);
    const TWO = ethers.BigNumber.from(2);

    const x = BigNumber.from(value);
    let z = x.add(ONE).div(TWO);
    let y = x;
    while (z.sub(y).isNegative()) {
      y = z;
      z = x.div(z).add(z).div(TWO);
    }
    return y;
  };

  return sqrt(tokenAmount.mul(ethAmount)).sub(MINIMUM_LIQUIDITY);
};

const printStatus = async ({ token, treasury, lrf, safeExit, pair }) => {
  const treasuryBalance = await ethers.provider.getBalance(treasury.address);
  const lrfBalance = await ethers.provider.getBalance(lrf.address);
  const lrfTokenBalance = await token.balanceOf(lrf.address);
  const feesCollected = await token.balanceOf(token.address);
  const { ethReserves, tokenReserves } = await getLiquidityReserves({ token, pair });
  const liquidityTokens = await token.balanceOf(await token.autoLiquidityEngine());
  const safeExitFundBalance = await ethers.provider.getBalance(safeExit.address);
  const backedLiquidity = BigNumber.from("1000000000000000000")
    .mul(treasuryBalance.add(lrfBalance))
    .div(ethReserves.mul(BigNumber.from("10000000000000000")));

  console.log();
  console.log(`Treasury - eth:   ${ethers.utils.formatEther(treasuryBalance, { comify: true })}`);
  console.log(`LRF - eth:        ${ethers.utils.formatEther(lrfBalance, { comify: true })}`);
  console.log(`LRF - tokens:     ${ethers.utils.formatEther(lrfTokenBalance, { comify: true })}`);
  console.log(`Total assets:     ${ethers.utils.formatEther(lrfBalance.add(treasuryBalance), { comify: true })}`);
  console.log();
  console.log(`LP - eth:         ${ethers.utils.formatEther(ethReserves, { comify: true })}`);
  console.log(`LP - tokens:      ${ethers.utils.formatEther(tokenReserves, { comify: true })}`);
  console.log(`Backed liquidity: ${backedLiquidity}%`);
  console.log();
  console.log(`Token fees coll:  ${ethers.utils.formatEther(feesCollected, { comify: true })}`);
  console.log(`Liquidity tokens: ${ethers.utils.formatEther(liquidityTokens, { comify: true })}`);
  console.log(
    `Liquidity eng ETH: ${ethers.utils.formatEther(await ethers.provider.getBalance(await token.autoLiquidityEngine()), { comify: true })}`
  );
  console.log();
  console.log(`Safe exit fund:   ${ethers.utils.formatEther(safeExitFundBalance, { comify: true })}`);
};

module.exports = {
  addZeroes,
  print,
  transferTokens,
  transferEth,
  buyTokens,
  sellTokens,
  addLiquidity,
  getLiquidityReserves,
  calculateEthToReceive,
  calculateInitialLP,
  printStatus,
};
