// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "./interfaces/ILocker.sol";
import "./interfaces/IGuilderFi.sol";

contract Locker is ILocker {
  address public presaleAddress;
  IGuilderFi public token;

  constructor(
    address _presaleAddress,
    address _tokenAddress
  ) {
    presaleAddress = _presaleAddress;
    token = IGuilderFi(_tokenAddress);
  }

  function withdraw(address _walletAddress) external {
    require(msg.sender == presaleAddress, "Sender is not presale contract");

    uint256 balance = token.balanceOf(address(this));
    token.transfer(_walletAddress, balance);
  }
}