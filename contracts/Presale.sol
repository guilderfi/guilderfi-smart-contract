// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "./interfaces/IGuilderFi.sol";
import "./interfaces/ISafeExitFund.sol";
import "./interfaces/ILocker.sol";
import "./Locker.sol";

contract Presale {
  mapping(address => bool) private tier1Whitelist; // index 1
  mapping(address => bool) private tier2Whitelist; // index 2
  mapping(address => bool) private tier3Whitelist; // index 3

  mapping(address => uint256) private customBuyLimit;
  mapping(address => bool) private walletHasBought;

  bool public isPresaleOpen = false;

  ISafeExitFund private safeExit;
  IGuilderFi private token;

  mapping(address => address) private lockers;
  uint256 lockerUnlockDate;

  modifier onlyTokenOwner() {
    require(msg.sender == address(_token.getOwner()), "Sender is not token owner");
    _;
  }

  constructor(address _safeExitAddress, address _tokenAddress) {
    token = IGuilderFi(_tokenAddress);
    safeExit = ISafeExitFund(_safeExitAddress);
  }

  function setSafeExit(address _address) external onlyTokenOwner {
    safeExit = ISafeExitFund(_address);
  }

  function setLockerUnlockDate(uint256 _date) external onlyTokenOwner {
    lockerUnlockDate = _date;
  }

  function setCustomLimit(address _walletAddress, uint256 _limit) external onlyTokenOwner {
    customBuyLimit[_walletAddress] = _limit;
  }

  function addToWhitelist(address[] _addresses, uint256 _tierIndex) external onlyTokenOwner {
    require(_tierIndex == 1 || _tierIndex == 2 || _tierIndex == 3, "Tier index out of bounds");
    for (uint256 i = 0; i < _addresses.length; i++) {
      if (_tierIndex == 1) {
        tier1Whitelist[_addresses[i]] == true;

        tier2Whitelist[_addresses[i]] == false;
        tier3Whitelist[_addresses[i]] == false;
      }
      if (_tierIndex == 2) {
        tier2Whitelist[_addresses[i]] == true;

        tier1Whitelist[_addresses[i]] == false;
        tier3Whitelist[_addresses[i]] == false;
      }
      if (_tierIndex == 3) {
        tier3Whitelist[_addresses[i]] == true;

        tier1Whitelist[_addresses[i]] == false;
        tier2Whitelist[_addresses[i]] == false;
      }
    }
  }

  function removeFromWhitelist(address[], uint256 _tierIndex) external onlyTokenOwner {
    require(_tierIndex == 1 || _tierIndex == 2 || _tierIndex == 3, "Tier index out of bounds");
    for (uint256 i = 0; i < _addresses.length; i++) {
      if (_tierIndex == 1) tier1Whitelist[_addresses[i]] == false;
      if (_tierIndex == 2) tier2Whitelist[_addresses[i]] == false;
      if (_tierIndex == 3) tier3Whitelist[_addresses[i]] == false;
    }
  }

  function openPresale() external onlyTokenOwner {
    isPresaleOpen = true;
  }

  function buyTokens() public payable {
    require(walletHasBought[msg.sender] != true, "Wallet has already bought");

    uint256 amount;

    if (!isPresaleOpen) {
      if (customBuyLimit[msg.sender] > 0) {
        require(msg.value >= 25 ether && msg.value <= customBuyLimit[msg.sender], "Value not consistent with presale contraints");
        amount = msg.value * 2000;
      } else require(msg.value >= 0.5 ether && msg.value <= 25 ether, "Value not consistent with presale contraints");

      if (msg.value >= 5 ether && msg.value <= 25 ether) {
        require(tier1Whitelist[msg.sender] == true, "Wallet not whitelisted for this tier");
        amount = msg.value * 1760;
      }
      if (msg.value >= 2.5 ether && msg.value <= 5 ether) {
        require(tier2Whitelist[msg.sender] == true, "Wallet not whitelisted for this tier");
        amount = msg.value * 1664;
      }
      if (msg.value >= 0.5 ether && msg.value <= 1 ether) {
        require(tier3Whitelist[msg.sender] == true, "Wallet not whitelisted for this tier");
        amount = msg.value * 1600;
      }
    } else {
      require(msg.value >= 0.5 ether && msg.value <= 10 ether, "Value not consistent with presale contraints");
      amount = msg.value * 1400;
    }

    // create and save locker
    ILocker locker = new Locker(address(this), address(token));
    lockers[msg.sender] = locker;
    // deposit half tokens into the locker
    locker.deposit(amount / 2);

    // sending half tokens to the user
    token.mint(msg.sender, amount / 2); // TODO is the right function ?

    // sending the nft to the user
    safeExit.mint(msg.sender);
    safeExit.setPresaleBuyAmount(msg.sender, msg.value);

    walletHasBought[msg.sender] = true;
  }

  function unlockTokens() external {
    require(block.timestamp > lockerUnlockDate, "Can't unlock tokens yet");

    ILocker locker = lockers[msg.sender];
    locker.withdraw(msg.sender);
  }

  function withdraw(uint256 _amount) external override onlyTokenOwner {
    payable(msg.sender).transfer(_amount);
  }

  function withdrawTokens(address _token, uint256 _amount) external override onlyTokenOwner {
    IERC20(_token).transfer(msg.sender, _amount);
  }
}
