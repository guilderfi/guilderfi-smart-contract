// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

interface ISafeExitFund {
  function execute(
    address _walletAddress,
    uint256 _amount,
    bool _isPositiveTransaction
  ) external;

  function withdraw(uint256 amount) external;

  function withdrawTokens(address token, uint256 amount) external;

  function mint(address _walletAddress) external;

  function setPresaleBuyAmount(address _walletAddress, uint256 _amount) external;
}
