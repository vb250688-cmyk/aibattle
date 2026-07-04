// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title BattleStaking — stake $BATTLE, earn $BATTLE
/// @notice Simple linear-APR staking. Rewards are paid out of tokens the owner
///         deposits into this contract via fundRewards(). Testnet demo only.
contract BattleStaking is Ownable, ReentrancyGuard {
    IERC20 public immutable battleToken;

    uint256 public aprBasisPoints = 1000; // 1000 = 10% APR, owner-adjustable
    uint256 private constant YEAR = 365 days;
    uint256 private constant BPS_DENOM = 10_000;

    struct StakeInfo {
        uint256 amount;
        uint256 rewardCheckpoint; // last timestamp rewards were settled
    }
    mapping(address => StakeInfo) public stakes;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event AprUpdated(uint256 newBps);

    constructor(address _battleToken) Ownable(msg.sender) {
        battleToken = IERC20(_battleToken);
    }

    /// @notice Reward accrued so far, not yet paid out.
    function pendingReward(address user) public view returns (uint256) {
        StakeInfo memory s = stakes[user];
        if (s.amount == 0) return 0;
        uint256 elapsed = block.timestamp - s.rewardCheckpoint;
        return (s.amount * aprBasisPoints * elapsed) / (BPS_DENOM * YEAR);
    }

    /// @notice Stake `amount` BATTLE (requires prior ERC-20 approve()).
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        _settle(msg.sender);
        require(battleToken.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        stakes[msg.sender].amount += amount;
        emit Staked(msg.sender, amount);
    }

    /// @notice Unstake `amount` BATTLE. Auto-claims pending reward first.
    function unstake(uint256 amount) external nonReentrant {
        StakeInfo storage s = stakes[msg.sender];
        require(s.amount >= amount, "Insufficient staked balance");
        _settle(msg.sender);
        s.amount -= amount;
        require(battleToken.transfer(msg.sender, amount), "transfer failed");
        emit Unstaked(msg.sender, amount);
    }

    /// @notice Claim accrued reward without unstaking.
    function claimReward() external nonReentrant {
        _settle(msg.sender);
    }

    function _settle(address user) internal {
        uint256 reward = pendingReward(user);
        stakes[user].rewardCheckpoint = block.timestamp;
        if (reward > 0) {
            require(battleToken.transfer(user, reward), "reward transfer failed");
            emit RewardClaimed(user, reward);
        }
    }

    /// @notice Owner deposits BATTLE into this contract to fund future rewards.
    ///         Requires prior ERC-20 approve() from the owner's wallet.
    function fundRewards(uint256 amount) external onlyOwner {
        require(battleToken.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
    }

    function setAPR(uint256 newBps) external onlyOwner {
        require(newBps <= 5000, "Max 50% APR"); // sanity cap
        aprBasisPoints = newBps;
        emit AprUpdated(newBps);
    }
}
