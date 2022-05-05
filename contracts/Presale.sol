// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "./interfaces/IGuilderFi.sol";
import "./interfaces/ISafeExitFund.sol";

contract Presale {
  mapping(address => bool) private tier1Whitelist; // index 1
  mapping(address => bool) private tier2Whitelist; // index 2
  mapping(address => bool) private tier3Whitelist; // index 3

  mapping(address => bool) private walletHasBought;

  bool public isPresaleOpen = false;

  ISafeExitFund private safeExit;
  IGuilderFi private token;

  modifier onlyTokenOwner() {
    require(msg.sender == address(_token.getOwner()), "Sender is not token owner");
    _;
  }

  constructor(address _safeExitAddress, address _tokenAddress) {
    token = IGuilderFi(_tokenAddress);
    safeExit = safeExit(_safeExitAddress);
  }

  function addToWhitelist(address[] _addresses, uint256 _tierIndex) external onlyTokenOwner {
    require(_tierIndex == 1 || _tierIndex == 2 || _tierIndex == 3, "Tier index out of bounds");
    for (uint256 i = 0; i < _addresses.length; i++) {
      if (_tierIndex == 1) tier1Whitelist[_addresses[i]] == true;
      if (_tierIndex == 2) tier2Whitelist[_addresses[i]] == true;
      if (_tierIndex == 3) tier3Whitelist[_addresses[i]] == true;
    }
  }

  function openPresale() external onlyTokenOwner {
    isPresaleOpen = true;
  }

  function buyTokens() public payable {
    require(walletHasBought[msg.sender] != true, "Wallet has already bought");

    if (!isPresaleOpen) {
      require(msg.value >= 0.5 ether && msg.value <= 25 ether, "Value not consistent with presale contraints");
      if (msg.value >= 5 ether && msg.value <= 25 ether) require(tier1Whitelist[msg.sender] == true, "Wallet not whitelisted for this tier");
      if (msg.value >= 2.5 ether && msg.value <= 5 ether) require(tier2Whitelist[msg.sender] == true, "Wallet not whitelisted for this tier");
      if (msg.value >= 0.5 ether && msg.value <= 1 ether) require(tier3Whitelist[msg.sender] == true, "Wallet not whitelisted for this tier");
    } else {
      require(msg.value >= 0.5 ether && msg.value <= 10 ether, "Value not consistent with presale contraints");
    }

    // TODO transfer / lock 50% tokens

    safeExit.mint(msg.sender);
    safeExit.setPresaleBuyAmount(msg.sender, msg.value);

    walletHasBought[msg.sender] = true;
  }

  function withdraw(uint256 _amount) external override onlyTokenOwner {
    payable(msg.sender).transfer(_amount);
  }

  function withdrawTokens(address _token, uint256 _amount) external override onlyTokenOwner {
    IERC20(_token).transfer(msg.sender, _amount);
  }
}
