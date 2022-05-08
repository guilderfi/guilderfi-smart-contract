// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "./interfaces/ILocker.sol";

import "./interfaces/IGuilderFi.sol";

contract Locker is ILocker {
  address public presaleAddress;

  IGuilderFi token;

  constructor(
    address _presaleAddress,
    address _tokenAddress
  ) {
    presaleAddress = _presaleAddress;

    token = IGuilderFi(_tokenAddress);
  }

  function withdraw(address _walletAddress) external {
    require(msg.sender == presaleAddress, "Only presale contract can call this locker");

    uint256 bal = token.balanceOf(address(this));

    token.approve(presaleAddress, bal);
    token.transfer(_walletAddress, bal);

    // TODO ensure that `transfer` does not interfere with fees or other stuffs
  }
}
