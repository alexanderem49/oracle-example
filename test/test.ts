import { ethers, network } from "hardhat";
import { IERC20, OptimisticOracleTest } from "../typechain-types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";

async function skipDays(days: number) {
    ethers.provider.send("evm_increaseTime", [days * 86400]);
    ethers.provider.send("evm_mine", []);
}

describe("OptimisticOracleTest", async () => {
    let contract: OptimisticOracleTest;
    let signers: SignerWithAddress[];

    let usdc: IERC20, weth: IERC20;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [{
                forking: {
                    enabled: true,
                    jsonRpcUrl: process.env.POLYGON_URL as string,
                    blockNumber: 45773775
                },
            },],
        });
    })

    beforeEach(async () => {
        signers = await ethers.getSigners();

        usdc = await ethers.getContractAt("IERC20", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174");
        weth = await ethers.getContractAt("IERC20", "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619");

        const factory = await ethers.getContractFactory("OptimisticOracleTest");
        contract = await factory.deploy(
            ethers.utils.parseUnits("1000.0", 6),
            ethers.utils.parseUnits("10.0", 6),
            usdc.address
        );
    })

    it("Should not deploy contract when bond is set to lower value than default", async () => {
        const factory = await ethers.getContractFactory("OptimisticOracleTest");
        const defaultBond = await contract.getDefaultFee(usdc.address);

        const tx = factory.deploy(
            defaultBond.sub(1),
            ethers.utils.parseUnits("10.0", 6),
            usdc.address
        );

        await expect(tx).to.be.revertedWith("Bond lower than default");
    })

    it("uintToDecimalString should correctly convert integers", async () => {
        for (let i = 0; i <= 10001; i++) {
            const resultPromise = contract.uintToDecimalString(i);
            if (i > 10000) {
                await expect(resultPromise).to.be.revertedWith(">100%");
                continue;
            }

            const expectedResult: string = (i / 100).toPrecision(Math.log10(i == 0 ? 100 : i) + 1) + "%";
            const result = await resultPromise;

            expect(result).to.be.equal(expectedResult);
        }
    });

    it("Should fetch default prices from Uma oracle", async () => {
        console.log("USDC minimum bond:", ethers.utils.formatUnits(await contract.getDefaultFee(usdc.address), 6), "USDC");
        console.log("WETH minimum bond:", ethers.utils.formatUnits(await contract.getDefaultFee(weth.address), 18), "WETH");
    })

    it("Try full cycle", async () => {
        const whale = await ethers.getImpersonatedSigner("0x2580f9954529853Ca5aC5543cE39E9B5B1145135");

        // reward + bond
        await usdc.connect(whale).transfer(signers[0].address, ethers.utils.parseUnits("1010.0", 6));
        await usdc.approve(contract.address, ethers.constants.MaxUint256);

        console.log("Proposer balance:", ethers.utils.formatUnits(await usdc.balanceOf(signers[0].address), 6))

        const usdcWhaleBalanceBefore = await usdc.balanceOf(signers[0].address);
        const usdcContractBalanceBefore = await usdc.balanceOf(contract.address);

        await contract.setCallOo(true);
        await contract.submitVotes([{
            voteUrl: "https://snapshot.org/#/hw.alexanderem49.eth/proposal/0x681a41788d88db5cebeb89a26d39e3c99cde472fb41484f52389232ab4336ab9",
            voteCategory: "CATEGORY_TEST",
            options: ["BTC", "ETH"],
            votePercentage: [5157, 4843]
        }])

        // const usdcContractBalanceAfter = await usdc.balanceOf(contract.address);
        // const usdcWhaleBalanceAfter = await usdc.balanceOf(signers[0].address);

        // console.log("Whale diff:   ", usdcWhaleBalanceBefore.sub(usdcWhaleBalanceAfter));
        // console.log("Contract diff:", usdcContractBalanceBefore.sub(usdcContractBalanceAfter));

        await skipDays(1);

        await contract.settleRound(0);
        const usdcContractBalanceAfter = await usdc.balanceOf(contract.address);
        const usdcWhaleBalanceAfter = await usdc.balanceOf(signers[0].address);

        console.log("Whale diff:   ", usdcWhaleBalanceBefore.sub(usdcWhaleBalanceAfter));
        console.log("Contract diff:", usdcContractBalanceBefore.sub(usdcContractBalanceAfter));
    })
})