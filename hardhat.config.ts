import * as dotenv from "dotenv";

import { HardhatUserConfig, task } from "hardhat/config";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";

dotenv.config();
const accounts = {
  mnemonic:
    process.env.MNEMONIC ||
    "test test test test test test test test test test test test",
};

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: {
    compilers: [ 
      {
        version: "0.4.25",
      },
      {
        version: "0.5.16",
      },
      {
        version: "0.8.11",
        settings: {},
      },
    ],
  },
  networks: {
    hardhat: {
      forking: {
        enabled: true,
        url: process.env.MAINNET_URL || "",
        blockNumber: 14186942
      },
    },
    goerli: {
      url: process.env.GOERLI_URL || "",
      accounts,
    },
    rinkeby: {
      url: process.env.RINKEBY_URL || "",
      accounts,
    },
    mumbai: {
      url: process.env.MUMBAI_URL || "",
      accounts,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "SGLD",
    gasPrice: 55,
    coinmarketcap: process.env.COINMARKETCAPAPI,
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  mocha: {
    timeout: 180000
  }
};

export default config;
