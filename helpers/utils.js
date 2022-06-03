const ethers = require("ethers");
const { BigNumber } = require("ethers");
const clc = require("cli-color");

const DECIMALS = 18;
const MAX_INT = ethers.constants.MaxUint256;
const TOKEN_NAME = "GuilderFi";

const ether = (num) => {
  const numString = num.toString();
  const decimals = numString.indexOf(".") > 0 ? numString.split(".")[1].length : 0;
  return BigNumber.from(numString.replace(".", "")).mul(BigNumber.from(10).pow(DECIMALS - decimals));
};

const print = (msg) => {
  console.log(clc.xterm(8)("      " + msg));
};

const createWallet = (ethers) => {
  return ethers.Wallet.createRandom().connect(ethers.provider);
};

module.exports = {
  DECIMALS,
  MAX_INT,
  TOKEN_NAME,
  ether,
  print,
  createWallet,
};
