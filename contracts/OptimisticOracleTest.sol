// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "@openzeppelin/contracts/access/Ownable.sol";

import "./IUmaOptimisticOracleV2.sol";
import "./StoreInterface.sol";
import "./Constants.sol";
import "./FinderInterface.sol";

import "hardhat/console.sol";

contract OptimisticOracleTest is Ownable {
    using SafeERC20 for IERC20;
    using Address for address;

    // Polygon address
    IUmaOptimisticOracleV2 public constant OO =
        IUmaOptimisticOracleV2(0xeE3Afe347D5C74317041E2618C49534dAf887c24);

    struct VoteResult {
        string voteUrl;
        string voteCategory;
        string[] options;
        uint16[] votePercentage;
    }

    struct VoteRound {
        VoteResult[] voteResults;
        uint256 timestamp;
        bytes request;
        address proposer;
        uint256 bondAmountPaid;
        uint256 rewardAmountPaid;
        address currencyPaid;
    }

    string public queryTemplate =
        "Q:Are the results of the Snapshot proposals in space https://snapshot.org/#/hw.alexanderem49.eth match vote results received in Request Transaction? Received data is emitted in the VoteResultReceived event in Request Transaction. Proposals MUST be created and closed before the Request Transaction block timestamp. Proposal category from its topic has to be received as well.\n\nSnapshot proposals:\n";
    string public answersTemplate =
        "\n\nA:1 for yes. 0 for no. 0.5 if the answer cannot be determined.";
    VoteRound[] public voteRounds;

    bytes32 public identifier = bytes32("YES_OR_NO_QUERY");
    uint256 public reward;
    uint256 public bond;
    uint256 public rounds;

    IERC20 public currency;

    bool public callOo = false;

    event VoteResultReceived(
        string voteUrl,
        string voteCategory,
        string[] options,
        string[] votePercentage
    );

    constructor(uint256 _bond, uint256 _reward, address _currency) {
        uint256 defaultBond = getDefaultFee(_currency);
        require(_bond >= defaultBond, "Bond lower than default");
        bond = _bond;
        reward = _reward;
        currency = IERC20(_currency);
    }

    function submitVotes(VoteResult[] memory results) external onlyOwner {
        uint256 resultsLength = results.length;
        require(resultsLength > 0, "no data");

        string[] memory voteUrls = new string[](resultsLength);
        uint256 currentRound = rounds;
        uint256 requestTime = block.timestamp;

        voteRounds.push();
        voteRounds[currentRound].timestamp = requestTime;
        voteRounds[currentRound].proposer = msg.sender;

        for (uint256 i = 0; i < resultsLength; i++) {
            voteRounds[currentRound].voteResults.push(results[i]);

            voteUrls[i] = results[i].voteUrl;

            uint256 optionsLength = results[i].votePercentage.length;
            string[] memory optionsConverted = new string[](optionsLength);

            for (uint256 j = 0; j < optionsLength; j++) {
                optionsConverted[j] = uintToDecimalString(
                    results[i].votePercentage[j]
                );
            }

            emit VoteResultReceived(
                results[i].voteUrl,
                results[i].voteCategory,
                results[i].options,
                optionsConverted
            );
        }

        bytes memory ancillaryData = createQuery(voteUrls, resultsLength);
        voteRounds[currentRound].request = ancillaryData;

        ++rounds;

        if (callOo) {
            IERC20 _currency = currency;
            uint256 _bond = bond;
            uint256 _reward = reward;
            bytes32 _identifier = identifier;

            uint256 defaultBond = getDefaultFee(address(_currency));
            require(_bond >= defaultBond, "Bond update required");
            uint256 extraBond = _bond - defaultBond;

            _currency.safeTransferFrom(
                msg.sender,
                address(this),
                _reward + _bond
            );

            _currency.safeApprove(address(OO), _reward + _bond);
            OO.requestPrice(
                _identifier,
                requestTime,
                ancillaryData,
                address(_currency),
                _reward
            );

            if (extraBond != defaultBond) {
                OO.setBond(_identifier, requestTime, ancillaryData, extraBond);
            }

            OO.setCustomLiveness(
                _identifier,
                requestTime,
                ancillaryData,
                1 days
            );

            OO.proposePrice(
                address(this),
                identifier,
                requestTime,
                ancillaryData,
                1e18
            );

            voteRounds[currentRound].bondAmountPaid = _bond;
            voteRounds[currentRound].rewardAmountPaid = _reward;
            voteRounds[currentRound].currencyPaid = address(_currency);
        }
    }

    function settleRound(uint256 _round) external onlyOwner {
        VoteRound memory round = voteRounds[_round];

        OO.settle(address(this), identifier, round.timestamp, round.request);

        currency.safeTransfer(round.proposer, round.bondAmountPaid + round.rewardAmountPaid);
        console.log(currency.balanceOf(address(this)));
    }

    function getRound(
        uint256 round
    )
        public
        view
        returns (
            VoteResult[] memory voteResults,
            uint256 timestamp,
            bytes memory request,
            string memory requestString,
            address proposer,
            uint256 bondAmountPaid,
            uint256 rewardAmountPaid,
            address currencyPaid
        )
    {
        voteResults = voteRounds[round].voteResults;
        timestamp = voteRounds[round].timestamp;
        request = voteRounds[round].request;
        requestString = string(voteRounds[round].request);
        proposer = voteRounds[round].proposer;
        bondAmountPaid = voteRounds[round].bondAmountPaid;
        rewardAmountPaid = voteRounds[round].rewardAmountPaid;
        currencyPaid = voteRounds[round].currencyPaid;
    }

    // Fetch the resolved price from the Optimistic Oracle that was settled.
    function getRequest(
        uint256 round
    ) public view returns (IUmaOptimisticOracleV2.Request memory) {
        return
            OO.getRequest(
                address(this),
                identifier,
                voteRounds[round].timestamp,
                voteRounds[round].request
            );
    }

    function setCallOo(bool value) external onlyOwner {
        callOo = value;
    }

    function multicall(
        address[] calldata destinations,
        bytes[] calldata calldatas
    ) external onlyOwner {
        uint256 length = destinations.length;
        require(length == calldatas.length, "lengths");
        for (uint256 i = 0; i < length; i++) {
            destinations[i].functionCall(calldatas[i]);
        }
    }

    function setBondAndCurrency(
        uint256 _bond,
        address _currency
    ) external onlyOwner {
        uint256 defaultBond = getDefaultFee(_currency);
        require(_bond >= defaultBond, "Bond lower than default");

        bond = _bond;
        currency = IERC20(_currency);
    }

    function setReward(uint256 _reward) external onlyOwner {
        reward = _reward;
    }

    function setIdentifier(bytes32 _identifier) external onlyOwner {
        identifier = _identifier;
    }

    function setQueryTemplate(string memory _query) external onlyOwner {
        queryTemplate = _query;
    }

    function setAnswersTemplate(string memory _answers) external onlyOwner {
        answersTemplate = _answers;
    }

    function getDefaultFee(address _currency) public view returns (uint256) {
        FinderInterface finder = FinderInterface(OO.finder());
        StoreInterface store = StoreInterface(
            finder.getImplementationAddress(OracleInterfaces.Store)
        );
        return store.computeFinalFee(_currency).rawValue;
    }

    function uintToDecimalString(
        uint16 value
    ) public pure returns (string memory) {
        require(value <= 10000, ">100%");

        uint16 integer = value / 100;
        uint16 remainder = value % 100;

        if (remainder < 10) {
            return
                string(
                    abi.encodePacked(
                        Strings.toString(integer),
                        ".0",
                        Strings.toString(remainder),
                        "%"
                    )
                );
        }

        return
            string(
                abi.encodePacked(
                    Strings.toString(integer),
                    ".",
                    Strings.toString(remainder),
                    "%"
                )
            );
    }

    function createQuery(
        string[] memory voteUrls,
        uint256 length
    ) private view returns (bytes memory) {
        bytes memory query = bytes(queryTemplate);

        for (uint256 i = 0; i < length; i++) {
            if (length - 1 == i) {
                query = abi.encodePacked(query, voteUrls[i]);
                break;
            }

            query = abi.encodePacked(query, voteUrls[i], "\n");
        }

        query = abi.encodePacked(query, answersTemplate);

        return query;
    }
}
