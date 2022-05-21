const { ether } = require("./index");

const tier1 = { tierId: 1, tokensPerEth: ether(731.71), minAmount: ether(37.5), maxAmount: ether(125) };
const tier2 = { tierId: 2, tokensPerEth: ether(750), minAmount: ether(7.5), maxAmount: ether(25) };
const tier3 = { tierId: 3, tokensPerEth: ether(769.23), minAmount: ether(1.5), maxAmount: ether(5) };
const tier4 = { tierId: 4, tokensPerEth: ether(789.47), minAmount: ether(0.3), maxAmount: ether(1) };
const publicTier = { tierId: 0, tokensPerEth: ether(759.49), minAmount: ether(3), maxAmount: ether(10) };
const customTier = { tierId: 99, tokensPerEth: ether(2000), minAmount: ether(25) };

module.exports = {
  tier1,
  tier2,
  tier3,
  tier4,
  publicTier,
  customTier,
};
