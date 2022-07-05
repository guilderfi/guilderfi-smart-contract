// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

interface IAutoLiquidityEngine {
  function executeLiquidityEngine() external;
  function inSwap() external view returns (bool);
  function withdraw(uint256 amount) external;
  function withdrawTokens(address token, uint256 amount) external;
  function burn(uint256 amount) external;
}
