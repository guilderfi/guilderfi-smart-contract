// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

interface ISafeExitFund {
  function execute(
    address sender,
    address recipient,
    uint256 tokenAmount
  ) external;

  function capturePresalePurchaseAmount(address _walletAddress, uint256 _amount) external;
  function claimSafeExit() external;
  function mintRandom(address _walletAddress) external;
  function mint(address _walletAddress, uint256 maxInsuranceAmount) external;

  // Public getter functions
  function maxSupply() external view returns (uint256);
  function unrevealedMetadataUri() external view returns (string memory);
  function activationDate() external view returns (uint256);
  function tokenURI(uint256 _nftId) external view returns (string memory);
  function issuedTokens() external view returns (uint256);

  function getPackage(uint256 _nftId) external view returns (
    uint256 packageId,
    string memory name,
    uint256 maxInsuranceAmount,
    string memory metadataUriLive,
    string memory metadataUriReady,
    string memory metadataUriDead
  );

  function createPackage(
    uint256 _packageId,
    string memory _name,
    uint256 _maxInsuranceAmount,
    string memory _uriLive,
    string memory _uriReady,
    string memory _uriDead) external;

  function getInsuranceStatus(address _walletAddress) external view returns (
    uint256 totalPurchaseAmount,
    uint256 maxInsuranceAmount,
    uint256 payoutAmount,
    uint256 premiumAmount,
    uint256 finalPayoutAmount    
  );

  // External setter functions
  function setRandomSeed(uint256 _randomSeed) external;
  function setMetadataUri(uint256 _packageId, string memory _uriLive, string memory _uriReady, string memory _uriDead) external;
  function setUnrevealedMetadataUri(string memory _uri) external;
  function setActivationDate(uint256 _date) external;
  function setMaxSupply(uint256 newMaxSupply) external;
  
  function withdraw(uint256 amount) external;
  function withdrawTokens(address _tokenAddress, uint256 amount) external;
}
