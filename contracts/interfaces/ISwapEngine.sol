// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

interface ISwapEngine {
  function executeSwapEngine() external;
  function recordFees(uint256 lrfAmount, uint256 safeExitAmount, uint256 treasuryAmount) external;
  function inSwap() external view returns (bool);
  function withdraw(uint256 amount) external;
  function withdrawTokens(address token, uint256 amount) external;
  function burn(uint256 amount) external;
}
