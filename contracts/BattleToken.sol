// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract BattleToken is ERC20, Ownable {
    mapping(address => uint256) public lastClaimTime;
    uint256 public constant DAILY_CLAIM_AMOUNT = 100 * 10**18; // 100 tokens
    uint256 public constant CLAIM_COOLDOWN = 24 hours;
    
    constructor() ERC20("Battle Token", "BATTLE") Ownable(msg.sender) {
        _mint(msg.sender, 1000000 * 10**18); // 1M tokens to deployer
    }
    
    function claimDaily() external {
        require(block.timestamp >= lastClaimTime[msg.sender] + CLAIM_COOLDOWN, "Wait 24 hours");
        lastClaimTime[msg.sender] = block.timestamp;
        _mint(msg.sender, DAILY_CLAIM_AMOUNT);
    }
    
    function ownerMint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
