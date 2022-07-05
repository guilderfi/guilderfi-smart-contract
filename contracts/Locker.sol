// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "./interfaces/ILocker.sol";
import "./interfaces/IGuilderFi.sol";

contract Locker is ILocker {
  address public presaleAddress;
  IGuilderFi public token;

  // CONSTANTS
  address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

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

  function burn() external {
    require(msg.sender == token.getSafeExitFundAddress(), "Sender is not SafeExit contract");
  
    uint256 tokenBalance = token.balanceOf(address(this));
    if (tokenBalance > 0) {
      token.transfer(DEAD, tokenBalance);
    }
  }
}