// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract BattleStaking is Ownable {
    IERC20 public stakingToken;
    
    struct StakeInfo {
        uint256 amount;
        uint256 rewardDebt;
        uint256 lastUpdate;
    }
    
    mapping(address => StakeInfo) public stakes;
    uint256 public totalStaked;
    uint256 public rewardPerToken;
    uint256 public constant APR_BASIS_POINTS = 2000; // 20% APR
    uint256 public constant REWARD_PRECISION = 1e18;
    
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    
    constructor(address _token) Ownable(msg.sender) {
        stakingToken = IERC20(_token);
    }
    
    function stake(uint256 amount) external {
        require(amount > 0, "Cannot stake 0");
        updateReward(msg.sender);
        
        stakingToken.transferFrom(msg.sender, address(this), amount);
        stakes[msg.sender].amount += amount;
        stakes[msg.sender].lastUpdate = block.timestamp;
        totalStaked += amount;
        
        emit Staked(msg.sender, amount);
    }
    
    function unstake(uint256 amount) external {
        require(stakes[msg.sender].amount >= amount, "Insufficient stake");
        updateReward(msg.sender);
        
        stakes[msg.sender].amount -= amount;
        totalStaked -= amount;
        stakingToken.transfer(msg.sender, amount);
        
        emit Unstaked(msg.sender, amount);
    }
    
    function claimReward() external {
        updateReward(msg.sender);
        uint256 reward = stakes[msg.sender].rewardDebt;
        require(reward > 0, "No rewards");
        
        stakes[msg.sender].rewardDebt = 0;
        stakingToken.transfer(msg.sender, reward);
        
        emit RewardClaimed(msg.sender, reward);
    }
    
    function updateReward(address user) internal {
        StakeInfo storage info = stakes[user];
        if(info.amount == 0) return;
        
        uint256 timeElapsed = block.timestamp - info.lastUpdate;
        uint256 reward = (info.amount * APR_BASIS_POINTS * timeElapsed) / (365 days * 10000);
        info.rewardDebt += reward;
        info.lastUpdate = block.timestamp;
    }
    
    function pendingReward(address user) external view returns (uint256) {
        StakeInfo storage info = stakes[user];
        if(info.amount == 0) return info.rewardDebt;
        
        uint256 timeElapsed = block.timestamp - info.lastUpdate;
        uint256 reward = (info.amount * APR_BASIS_POINTS * timeElapsed) / (365 days * 10000);
        return info.rewardDebt + reward;
    }
    
    function aprBasisPoints() external pure returns (uint256) {
        return APR_BASIS_POINTS;
    }
}
