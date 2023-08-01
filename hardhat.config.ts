import * as dotenv from "dotenv";

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      { version: "0.8.19" },
      { 
        version: "0.6.12", 
        settings: { 
          optimizer: {
            enabled: true,
            runs: 100
          } 
        } 
      }
    ]
  },
  networks: {
    hardhat: {
      accounts: {
        mnemonic: process.env.MNEMONIC,
      },
      allowUnlimitedContractSize: true,
      chainId: 1,
      forking: {
        enabled: false,
        url: process.env.MAINNET_URL as string,
      }
    },
    local: {
      url: "http://127.0.0.1:8545/",
      accounts: {
        mnemonic: process.env.MNEMONIC
      }
    },
    sepolia: {
      url: process.env.SEPOLIA_URL,
      accounts: {
        mnemonic: process.env.MNEMONIC
      }
    },
    mainnet: {
      url: process.env.MAINNET_URL,
      accounts: {
        mnemonic: process.env.MNEMONIC
      }
    },
    polygon: {
      url: process.env.POLYGON_URL,
      accounts: {
        mnemonic: process.env.MNEMONIC
      }
    },
    goerliOptimism: {
      url: "https://goerli.optimism.io",
      accounts: {
        mnemonic: process.env.MNEMONIC
      }
    }
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY != undefined ? process.env.ETHERSCAN_API_KEY : "",
      polygon: process.env.POLYGONSCAN_API_KEY != undefined ? process.env.POLYGONSCAN_API_KEY : "",
      sepolia: process.env.ETHERSCAN_API_KEY != undefined ? process.env.ETHERSCAN_API_KEY : "",
      optimisticGoerli: process.env.OPTIMISM_API_KEY != undefined ? process.env.OPTIMISM_API_KEY : "",
    }
  },
};

export default config;
