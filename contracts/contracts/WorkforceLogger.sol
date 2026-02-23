// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract WorkforceLogger {
    event TaskCompleted(uint256 taskId, uint256 timestamp);

    function logTaskCompletion(uint256 taskId) external {
        emit TaskCompleted(taskId, block.timestamp);
    }
}
