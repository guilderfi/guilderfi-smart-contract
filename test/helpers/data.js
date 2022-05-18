const { ether } = require("./index");

const tier1 = { tierId: 1, tokensPerEth: 1800, minAmount: ether(12.5), maxAmount: ether(25) };
const tier2 = { tierId: 2, tokensPerEth: 1700, minAmount: ether(5), maxAmount: ether(10) };
const tier3 = { tierId: 3, tokensPerEth: 1600, minAmount: ether(2.5), maxAmount: ether(5) };
const publicTier = { tierId: 0, tokensPerEth: 1500, minAmount: ether(0.5), maxAmount: ether(1) };
const customTier = { tierId: 99, tokensPerEth: 2000, minAmount: ether(25) };

module.exports = {
  tier1,
  tier2,
  tier3,
  publicTier,
  customTier,
};
