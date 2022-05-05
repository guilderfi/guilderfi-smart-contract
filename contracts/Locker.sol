// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "./interfaces/ILocker.sol";

import "./interfaces/IGuilderFi.sol";

contract Locker is ILocker {
  address public presaleAddress;

  IGuilderFi token;

  constructor(
    uint256 _unlockDate,
    address _presaleAddress,
    address _tokenAddress
  ) {
    unlockDate = _unlockDate;
    presaleAddress = _presaleAddress;

    token = IGuilderFi(_tokenAddress);
  }

  function withdraw(address _walletAddress) external {
    require(block.timestamp > unlockDate, "Tokens are not unlocked yet");
    require(msg.sender == _presaleAddress, "Only presale contract can call this locker");

    uint256 bal = token.balanceOf(this);

    token.approve(_presaleAddress, bal);
    token.transfer(_walletAddress, bal);

    // TODO ensure that `transfer` does not interfere with fees or other stuffs
  }
}
