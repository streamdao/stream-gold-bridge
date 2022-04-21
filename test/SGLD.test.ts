/* eslint-disable no-unused-vars */
import { BigNumber, Wallet } from "ethers";
import { ethers, waffle, network } from "hardhat";
// eslint-disable-next-line node/no-extraneous-import
import { BigNumber as BigNJS } from "bignumber.js";
// import { Signer } from "ethers";
import { expect } from "chai";
import { describe } from "mocha";
// eslint-disable-next-line node/no-missing-import
import { StreamGoldBridge, StreamGold } from "../typechain";

// Some contract constants
const DEFAULT_TRANSFERFEE = 0.001;
const DECIMALS = 8;
const TOKEN = ethers.BigNumber.from(10 ** DECIMALS);
const SUPPLY_LIMIT = BigNumber.from("8133525786").mul(TOKEN);
const DAY = 86400;
const INACTIVE_THRESHOLD_DAYS = 1095;
let cgt: StreamGoldBridge;

const locked_oracle = "0x99bbA657f2BbC93c02D617f8bA121cB8Fc104Acf";

// Start test block
describe("SGLD complies with cache gold standards", () => {
  let owner: Wallet;
  let feeAddr: Wallet;
  let external1: Wallet;
  let external2: Wallet;
  let external3: Wallet;
  let bridge: Wallet;
  let redeemAddr: Wallet;
  const createFixtureLoader = waffle.createFixtureLoader;
  let loadFixture: ReturnType<typeof createFixtureLoader>;

  // Expected storage fees, must pass in non-decimal amount (int/bignum)
  // and returns big number like truffle test invocations
  function calcStorageFee(
    balance: BigNumber,
    daysSincePaidStorage: number,
    daysSinceActivity = 0
  ) {
    // Specifically using BigNumber here just for decimal precision
    const amount = BigNumber.from(balance);

    // Only pay storge fee up to when inactive threshold is activated
    if (daysSinceActivity >= INACTIVE_THRESHOLD_DAYS) {
      daysSincePaidStorage =
        daysSincePaidStorage - (daysSinceActivity - INACTIVE_THRESHOLD_DAYS);
    }
    // multiplying by TOKEN here for matching TOKEN , 10000 is for adding precision
    const daysAtRate = BigNumber.from(
      ((daysSincePaidStorage * TOKEN.toNumber() * 10000) / 365).toFixed(0)
    );

    const fee = amount.mul(daysAtRate).div(40000000000).div(10000); // extra padded zeroes for avoiding rounding errors
    if (amount.sub(fee).toNumber() < 0) {
      // changing toFixed(0) to toString() because ethers.bignumber is only for integers
      return BigNumber.from(amount.toString());
    }
    return BigNumber.from(fee.toString());
  }

  // Calculate the maximum you could send given the transfer
  // basis points and current balance
  function calcSendAllBalance(
    transferBasisPoints: number,
    balance: BigNumber
  ): BigNumber {
    const amount = new BigNJS(balance.toNumber());
    const transferFeeDecimal = new BigNJS(transferBasisPoints).div(10000);
    const divisor = transferFeeDecimal.plus(1);

    // Add a round up to near-est int
    const sendAll = new BigNJS(amount.div(divisor).plus(1).toFixed(0));

    // Now see the transfer fee on that amount
    // const transferFee = new BigNJS(
    //   sendAll.times(transferFeeDecimal).toFixed(0)
    // );

    // Now if the sendAll + transferFee would be greater than balance, subtract 1 from sendAll
    // to fix rounding result
    // if (sendAll.plus(transferFee).gt(amount)) {
    //     sendAll = sendAll.minus(1);
    // }
    return BigNumber.from(sendAll.toFixed(0));
  }

  // Expected inactive fees, must pass in non-decimal amount (int/bignum)
  // and returns big number like truffle test invocations
  function calcInactiveFee(
    currentBalance: BigNumber,
    daysInactive: number,
    snapshotBalance: BigNumber,
    paidAlready: number
  ) {
    const balance = new BigNJS(currentBalance.toNumber());
    const snapshot = new BigNJS(snapshotBalance.toNumber());
    const inactive = new BigNJS(daysInactive);

    // 50 bps or 1 token minimum per year
    let perYear = snapshot.times(0.005);
    if (perYear.minus(TOKEN.toNumber()).toNumber() <= 0.0) {
      perYear = new BigNJS(TOKEN.toNumber());
    }

    // And get prorated amount due after daysInactive
    const owed = perYear
      .times(inactive.minus(INACTIVE_THRESHOLD_DAYS).div(365.0))
      .minus(paidAlready);

    if (owed.gt(balance)) {
      return BigNumber.from(balance.toFixed(0));
    }

    return BigNumber.from(owed.toFixed(0));
  }

  const expectTotals = async (instance: StreamGoldBridge) => {
    const totalSupply = await instance.totalSupply();

    // Sum balance of all accounts
    let actualSupply = BigNumber.from(0);
    const accounts = [owner, feeAddr, external1, external2, external3, bridge];
    for (const account of accounts) {
      actualSupply = actualSupply.add(
        await instance.balanceOfNoFees(account.address)
      );
    }

    expect(totalSupply).to.eq(actualSupply);
  };

  const advanceTimeAndBlock = async (_days: number) => {
    await network.provider.send("evm_increaseTime", [_days]);
    await network.provider.send("evm_mine");
  };

  const fixture = async () => {
    const _cgt = await ethers.getContractFactory("StreamGoldBridge");
    cgt = (await _cgt.deploy()) as StreamGoldBridge;
    // const StreamFactoryRoot = await ethers.getContractFactory("StreamGold");
    // const cacheFactoryRoot = (await StreamFactoryRoot.deploy(
    //   owner.address,
    //   owner.address,
    //   owner.address,
    //   owner.address,
    //   owner.address
    // )) as StreamGold;
    console.log(owner.address);

    return cgt;
  };

  beforeEach("create fixture loader", async () => {
    [owner, feeAddr, external1, external2, external3, bridge, redeemAddr] =
      await (ethers as any).getSigners();
    loadFixture = createFixtureLoader([
      owner,
      feeAddr,
      external1,
      external2,
      external3,
      bridge,
      redeemAddr,
    ]);
    cgt = await loadFixture(fixture);
    cgt.initialize(
      feeAddr.address,
      owner.address,
      bridge.address,
      owner.address,
      "STREAM GOLD TOKEN",
      "SGLD",
      8
    );
  });

  // Just make sure non-owners can't call protected functions
  it("Test onlyOwner protection", async function () {
    await expect(
      cgt.connect(external1).setFeeAddress(feeAddr.address)
    ).to.be.revertedWith("Caller is not STREAM ADMIN");
    await expect(
      cgt.connect(external1).setFeeExempt(feeAddr.address)
    ).to.be.revertedWith("Caller is not STREAM ADMIN");
    await expect(
      cgt.connect(external1).unsetFeeExempt(feeAddr.address)
    ).to.be.revertedWith("Caller is not STREAM ADMIN");
    await expect(
      cgt.connect(external1).setStorageFeeGracePeriodDays(feeAddr.address)
    ).to.be.revertedWith("Caller is not STREAM ADMIN");
    await expect(
      cgt.connect(external1).setTransferFeeBasisPoints(feeAddr.address)
    ).to.be.revertedWith("Caller is not STREAM ADMIN");
    // await expect(
    //   cgt.connect(external1).transferOwnership(feeAddr.address)
    // ).to.be.revertedWith("Caller is not the owner");
  });

  it("Test onlybridge protection", async function () {
    await expect(
      cgt.connect(external1).setFxManager(feeAddr.address)
    ).to.be.revertedWith("Caller is not STREAM ADMIN");
  });

  // Only one account is allowed to force paying storage / late fees and it is different
  // from the contract owner, who is going to be a multisig address. We want a single
  // key address for this so it can make signing transactions in a script without
  // interaction from other multisig participants
  it("Test onlyEnforcer protection", async function () {
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(external1.address, TOKEN); // give tokens to external1

    await network.provider.send("evm_increaseTime", [367 * 24 * 3600]);

    await expect(
      cgt.connect(external1).forcePayFees(external1.address)
    ).to.be.revertedWith(""); // not enforcer will fail

    // and enforcer won't fail
    await cgt.forcePayFees(external1.address);

    // Check enforcement on inactive fees
    await network.provider.send("evm_increaseTime", [366 * 10 * 24 * 3600]);

    await expect(
      cgt.connect(external1).forcePayFees(external1.address)
    ).to.be.revertedWith(""); // not enforcer will fail
    // and enforcer won't fail
    await cgt.forcePayFees(external1.address);
  });

  // // Inherited from OpenZeppelin stuff
  // it("Test approve methods",  async function () {
  //     await cgt.addBackedTokens(1000*TOKEN.toNumber()
  //     await cgt.transfer(external1, TOKEN.mul(10), {'from': backed_addr});

  //     // Allow external 2 to transfer up to 2 tokens
  //     expect(await cgt.approve(external2.address, 2*TOKEN.toNumber(, {'from': external1}));
  //     let approved = await cgt.allowance(external1, external2);
  //     expect.equal(approved, 2*TOKEN.toNumber();

  //     // Now do transfer to external 3
  //    expect(await cgt.transferFrom(external1, external3, TOKEN, {'from': external2}));

  //     let balance1 = await cgt.balanceOfNoFees(external1);
  //     let balance3 = await cgt.balanceOfNoFees(external3.address);
  //     let expected1 = TOKEN.mul(10) - TOKEN.toNumber() - TOKEN * DEFAULT_TRANSFERFEE;
  //     let expected3 = TOKEN.toNumber();
  //     expect.equal(balance1, expected1, "Balance 1 is unexpected");
  //     expect.equal(balance3, expected3, "Balance 3 is unexpected");

  //     // Assert transfer more than approved fails
  //     await expect.reverted(cgt.transferFrom(external1, external3, 3*TOKEN, {'from': external2}));

  //     // Now approve more
  //     expect(await cgt.increaseAllowance(external2.address, TOKEN, {'from': external1}));
  //     approved = await cgt.allowance(external1, external2);
  //     expect.equal(approved, 2*TOKEN);

  //     // And remove more
  //     expect(await cgt.decreaseAllowance(external2.address, TOKEN, {'from': external1}));
  //     approved = await cgt.allowance(external1, external2);
  //     expect.equal(approved, TOKEN.toNumber());

  //     // Can't approve on zero addr
  //     await expect.reverted(cgt.approve(ethers.constants.AddressZero, 2*TOKEN, {'from': backed_addr}));
  //     //await expect.reverted(cgt.approve(external1, 2*TOKEN, {'from': ethers.constants.AddressZero}));
  //     await expect.reverted(cgt.increaseAllowance(ethers.constants.AddressZero, 2*TOKEN, {'from': backed_addr}));
  //     await expect.reverted(cgt.decreaseAllowance(ethers.constants.AddressZero, 2*TOKEN, {'from': backed_addr}));
  // });

  // Make sure transfer fees are properly calculated

  // Make sure transfer fees are properly calculated
  it("Test simple transfer fees", async function () {
    // Test a normal amount
    let transferAmount = 51232134000;
    let expectedTransferFee = Math.floor(transferAmount * DEFAULT_TRANSFERFEE);
    // Transfer of normal amount has correct fee
    let actualFee = await cgt.calcTransferFee(
      external1.address,
      transferAmount
    );
    expect(actualFee).to.equal(expectedTransferFee);

    // Test an amount sub 1000 (fee should be 0)
    transferAmount = 999;
    expectedTransferFee = Math.floor(transferAmount * DEFAULT_TRANSFERFEE);
    // Transfer of normal amount has correct fee
    actualFee = await cgt.calcTransferFee(external1.address, transferAmount);
    expect(actualFee).to.equal(expectedTransferFee);
  });

  // // Test to make sure the storage fees are properly calculated
  it("Test correctly setting the storage fee", async function () {
    // Test all the edge cases on fees
    for (const day of [
      1, 128, 365, 366, 500, 730, 731, 900, 1095, 1096, 3000,
    ]) {
      for (const amount of [1, 50, 75, 100, 333, 1000, 3333, 10000, 100000]) {
        const expectedFee = calcStorageFee(
          TOKEN.mul(BigNumber.from(amount)),
          day
        );
        const actualFee = await cgt.storageFee(
          TOKEN.mul(BigNumber.from(amount)),
          day
        );
        expect(actualFee.sub(expectedFee).abs()).to.lt(BigNumber.from(1));
      }
    }

    // Now test some hand calculated fees

    // Test storage fee for 1 day
    let daysSincePaid = 1;
    const balance = BigNumber.from(8997100000000);
    let expectedFee = calcStorageFee(balance, daysSincePaid);
    let actualFee = await cgt.storageFee(balance, daysSincePaid);
    expect(actualFee.sub(expectedFee).abs()).to.lt(BigNumber.from(1));

    // Test storage fee for 128 days
    daysSincePaid = 128;

    expectedFee = calcStorageFee(balance, daysSincePaid);
    actualFee = await cgt.storageFee(balance, daysSincePaid);
    expect(actualFee.sub(expectedFee).abs()).to.lt(BigNumber.from(1));

    // Test storage fee for 365 days
    daysSincePaid = 365;

    expectedFee = calcStorageFee(balance, daysSincePaid);
    actualFee = await cgt.storageFee(balance, daysSincePaid);
    expect(actualFee.sub(expectedFee).abs()).to.lt(BigNumber.from(1));

    // Test storage fee for 366 day
    daysSincePaid = 366;

    expectedFee = calcStorageFee(balance, daysSincePaid);
    actualFee = await cgt.storageFee(balance, daysSincePaid);
    expect(actualFee.sub(expectedFee).abs()).to.lt(BigNumber.from(1));

    // Test storage fee for 730
    daysSincePaid = 730;

    expectedFee = calcStorageFee(balance, daysSincePaid);
    actualFee = await cgt.storageFee(balance, daysSincePaid);
    expect(actualFee.sub(expectedFee).abs()).to.lt(BigNumber.from(1));

    // Test storage fee for 731 days
    daysSincePaid = 731;

    expectedFee = calcStorageFee(balance, daysSincePaid);
    actualFee = await cgt.storageFee(balance, daysSincePaid);
    expect(actualFee.sub(expectedFee).abs()).to.lt(BigNumber.from(1));

    // Test storage fee for 1095 days
    daysSincePaid = 1095;

    expectedFee = calcStorageFee(balance, daysSincePaid);
    actualFee = await cgt.storageFee(balance, daysSincePaid);
    expect(actualFee.sub(expectedFee).abs()).to.lt(BigNumber.from(1));

    // Test storage fee for 1096 days
    daysSincePaid = 1096;

    expectedFee = calcStorageFee(balance, daysSincePaid);
    actualFee = await cgt.storageFee(balance, daysSincePaid);
    expect(actualFee.sub(expectedFee).abs()).to.lt(BigNumber.from(1));
  });

  // // Test the storage fees can be foribly collected after 365 days
  it("Test force paying storage fees", async function () {
    const value = BigNumber.from(1250000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give tokens to owner
    const dbackedBalance = await cgt.balanceOfNoFees(owner.address);
    expect(dbackedBalance).to.eq(value.mul(TOKEN));
    let feeAddressBalance = await cgt.balanceOfNoFees(feeAddr.address);
    // exempt the owner address from fees calculation

    await cgt.setFeeExempt(owner.address);
    // Transfer them to external accounts
    await cgt.transfer(external1.address, BigNumber.from(1000).mul(TOKEN));
    let externalBalance = await cgt.balanceOfNoFees(external1.address);
    expect(externalBalance, "Incorrect balance, bad transfer").to.eq(
      BigNumber.from(1000).mul(TOKEN)
    );
    feeAddressBalance = await cgt.balanceOfNoFees(feeAddr.address);

    // Advance the block time a day and verify you can't force collect storage fees
    await advanceTimeAndBlock(DAY);

    await expect(cgt.forcePayFees(external1.address)).to.be.revertedWith("");

    // Advance blocktime a year and force storage fee works
    await advanceTimeAndBlock(365 * DAY);
    const result = await cgt.forcePayFees(external1.address);
    expect(result.confirmations).to.eq(1);
    feeAddressBalance = await cgt.balanceOfNoFees(feeAddr.address);

    externalBalance = await cgt.balanceOfNoFees(external1.address);

    // Fee on 366 days is 30 basis points
    const expectedFee = calcStorageFee(BigNumber.from(1000).mul(TOKEN), 366);

    const expectedBalance = BigNumber.from(1000).sub(expectedFee);

    expect(
      externalBalance.eq(expectedBalance),
      "Incorrect balance, bad storage fee"
    );

    // Assert fee address got correct balance
    feeAddressBalance = await cgt.balanceOfNoFees(feeAddr.address);
    expect(feeAddressBalance, "Incorrect fee collection balance").to.eq(
      expectedFee
    );

    // Trying to force pay on an overdue address with no fees refunds tx
    // Send 0.00000001 tokens to address
    await cgt.transfer(external3.address, 1);
    await advanceTimeAndBlock(400 * DAY);

    // Force pay will fail since there is no collectable fee
    await expect(cgt.forcePayFees(external3.address)).to.be.revertedWith("");

    // Can't force pay on zero add
    await expect(
      cgt.forcePayFees(ethers.constants.AddressZero)
    ).to.be.revertedWith("");

    // Can't force pay on addr with no balance
    await expect(cgt.forcePayFees(external2.address)).to.be.revertedWith("");
  });

  it("Test pay storage fees", async function () {
    // Mint some starting tokens to backed treasury

    const value = BigNumber.from(1250000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give tokens to owner
    const dbackedBalance = await cgt.balanceOfNoFees(owner.address);
    expect(dbackedBalance).to.eq(value.mul(TOKEN));

    // exempt the owner address from fees calculation

    await cgt.setFeeExempt(owner.address);
    // Transfer them to external accounts
    const initialBalance1 = BigNumber.from(100000).mul(TOKEN);
    await cgt.transfer(external1.address, initialBalance1);
    let externalBalance = await cgt.balanceOfNoFees(external1.address);
    expect(externalBalance, "Incorrect balance, bad transfer").to.eq(
      initialBalance1
    );

    // Assert no storage fee immediately after transfer
    let daysSincePaidStorageFee = await cgt.daysSincePaidStorageFee(
      external1.address
    );
    expect(daysSincePaidStorageFee).to.eq(0);
    const storageFeeExpected = await cgt.calcStorageFee(external1.address);
    expect(storageFeeExpected).to.eq(0);

    // Test paying once per every 30 days, 12 mul
    for (let i = 0; i < 12; i++) {
      await advanceTimeAndBlock(DAY * 30);
      const result = await cgt.connect(external1).payStorageFee();
      // expect always a transfer in the tx
      expect(result.confirmations).to.eq(1);
    }
    externalBalance = await cgt.balanceOfNoFees(external1.address);
    const feeBalance = await cgt.balanceOfNoFees(feeAddr.address);
    console.log("feeBalance ----", feeBalance)
    console.log("externalBalance ----", externalBalance)
    // 9901814505999

    // There can be some floating point error, but based on other calcs should be similar
    // to the values below
    expect(externalBalance.add(feeBalance).toNumber()).to.eq(
      BigNumber.from(100000).mul(TOKEN)
    );
    // Make sure all the accounts add up to total still
    await expectTotals(cgt);

    // Calculated from python program - Also for cgt fees are 4 times
    const expectedBalance = BigNumber.from("9975370313074");
    const expectedFees = BigNumber.from("24629686932");

    // Allow error of up to 0.00000100 tokens
    expect(externalBalance.sub(expectedBalance).abs()).to.lt(
      BigNumber.from(100)
    );
    expect(feeBalance.sub(expectedFees).abs()).to.lt(BigNumber.from(100));

    // Now transfer less than token to external2 and test storage fees
    // for small amounts
    const initialBalance2 = BigNumber.from(99).div(100).mul(TOKEN);
    await cgt.transfer(external2.address, initialBalance2);

    // Make sure all the accounts add up to total still
    await expectTotals(cgt);

    // Make sure daysSincePaidStorageFee and calcStorageFee is 0 for
    // account that has never received coins
    daysSincePaidStorageFee = await cgt.daysSincePaidStorageFee(
      external3.address
    );
    expect(daysSincePaidStorageFee).to.eq(BigNumber.from(0));
    const storageFee = await cgt.calcStorageFee(external3.address);
    expect(storageFee).to.eq(BigNumber.from(0));
  });

  it("Test storage fee grace period is saved per address", async function () {
    const value = BigNumber.from(15000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give tokens to owner
    const dbackedBalance = await cgt.balanceOfNoFees(owner.address);
    expect(dbackedBalance).to.eq(value.mul(TOKEN));
    // exempt the owner address from fees calculation

    await cgt.setFeeExempt(owner.address);
    // Transfer them to external accounts
    const initialBalance1 = BigNumber.from(4000).mul(TOKEN);
    await cgt.transfer(external1.address, initialBalance1);
    let externalBalance = await cgt.balanceOfNoFees(external1.address);
    expect(externalBalance, "Incorrect balance, bad transfer").to.eq(
      initialBalance1
    );

    // Assert storgae fee grace period is 0
    let storageFeeGracePeriod = await cgt.storageFeeGracePeriodDays();
    expect(storageFeeGracePeriod).to.eq(0);

    // Change it to 30 days
    await cgt.setStorageFeeGracePeriodDays(30);
    storageFeeGracePeriod = await cgt.storageFeeGracePeriodDays();
    expect(storageFeeGracePeriod).to.eq(30);

    // Now perform a transfer to another external address
    await cgt.transfer(external2.address, TOKEN.mul(4000));
    externalBalance = await cgt.balanceOfNoFees(external2.address);
    expect(externalBalance, "Incorrect balance, bad transfer").to.eq(
      TOKEN.mul(4000)
    );

    // Advance 30 days
    await advanceTimeAndBlock(DAY * 30);

    // External 1 address should have 30 days worth of storage fees
    // owed, because that was what was set when the transfer
    // was received, while External 2 should have no fee set, because
    // the transfer happened after the storage fee was changed
    let storageFee1 = await cgt.calcStorageFee(external1.address);
    expect(storageFee1).to.gt(0);
    let storageFee2 = await cgt.calcStorageFee(external2.address);
    expect(storageFee2).to.eq(BigNumber.from(0));

    // Changing grace period to 15 days should not affect the
    // grace period of external1.address or external2
    await cgt.setStorageFeeGracePeriodDays(15);
    const storageFee1After = await cgt.calcStorageFee(external1.address);
    const storageFee2After = await cgt.calcStorageFee(external2.address);
    expect(storageFee1).to.eq(storageFee1After);
    expect(storageFee2).to.eq(storageFee2After);

    // Now pay the storage fee, expect it's zero after
    await cgt.connect(external1).payStorageFee();
    let storageFee = await cgt.calcStorageFee(external1.address);
    expect(storageFee).to.eq(BigNumber.from(0));

    // Advance 5 days and expect that both addresseses now
    // have to pay storage fees, because their initial period is over
    await advanceTimeAndBlock(DAY * 5);
    storageFee1 = await cgt.calcStorageFee(external1.address);
    expect(storageFee1).to.gt(BigNumber.from(0));
    storageFee2 = await cgt.calcStorageFee(external2.address);
    expect(storageFee2).to.gt(BigNumber.from(0));

    // Pay storage fee on external2 and make sure grace period doesn't restart
    await cgt.connect(external2).payStorageFee();
    // Advance 15 days
    await advanceTimeAndBlock(DAY * 15);
    storageFee = await cgt.calcStorageFee(external2.address);
    expect(storageFee).to.gt(BigNumber.from(0));
  });

  it("Set transfer fee and storage fee exempt separately", async function () {
    const value = BigNumber.from(15000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give tokens to owner
    const dbackedBalance = await cgt.balanceOfNoFees(owner.address);
    expect(dbackedBalance).to.eq(value.mul(TOKEN));
    // exempt the owner address from fees calculation

    await cgt.setFeeExempt(owner.address);
    // Transfer them to external accounts
    const initialBalance1 = BigNumber.from(10).mul(TOKEN);
    await cgt.transfer(external1.address, initialBalance1);

    await advanceTimeAndBlock(365 * DAY);

    expect(!(await cgt.isTransferFeeExempt(external1.address)));
    expect(!(await cgt.isStorageFeeExempt(external1.address)));
    expect(!(await cgt.isAllFeeExempt(external1.address)));

    // Turn off transfer fees and test
    await cgt.setTransferFeeExempt(external1.address);
    expect(await cgt.isTransferFeeExempt(external1.address));
    expect(!(await cgt.isStorageFeeExempt(external1.address)));
    expect(!(await cgt.isAllFeeExempt(external1.address)));

    // BalanceOf should show balance - owed storage and not
    // account for future transfer fee
    const expectedStorageFee = await cgt.calcStorageFee(external1.address);
    const expectedBalance = BigNumber.from(TOKEN.mul(10)).sub(
      expectedStorageFee
    );
    const realBalance = await cgt.balanceOf(external1.address);
    expect(expectedBalance, "Balances do not match").to.eq(realBalance);

    // Send transfer and make sure only storage fee is paid
    let result = await cgt
      .connect(external1)
      .transfer(external2.address, TOKEN);
    const balanceFee = await cgt.balanceOf(feeAddr.address);
    let balanceAfter = await cgt.balanceOf(external1.address);
    expect(balanceFee.eq(expectedStorageFee));
    expect(balanceAfter.eq(expectedBalance.sub(TOKEN)));

    // Now make only storage fee exempt
    await cgt.unsetFeeExempt(external1.address);
    expect(!(await cgt.isTransferFeeExempt(external1.address)));
    expect(!(await cgt.isStorageFeeExempt(external1.address)));
    expect(!(await cgt.isAllFeeExempt(external1.address)));

    await cgt.setStorageFeeExempt(external1.address);
    expect(!(await cgt.isTransferFeeExempt(external1.address)));
    expect(await cgt.isStorageFeeExempt(external1.address));
    expect(!(await cgt.isAllFeeExempt(external1.address)));

    // Advance a year, storage fee should be 0
    await advanceTimeAndBlock(365 * DAY);
    const storageFee = await cgt.calcStorageFee(external1.address);
    expect(storageFee.eq(BigNumber.from(0)));

    // Sending a transfer should incur a fee though
    const expectedTransFee = await cgt.calcTransferFee(
      external1.address,
      TOKEN
    );
    expect(expectedTransFee.gt(BigNumber.from(0)));
    result = await cgt.connect(external1).transfer(external2.address, TOKEN);
    balanceAfter = await cgt.balanceOfNoFees(external1.address);
    expect(
      balanceAfter.eq(
        expectedBalance.sub(TOKEN).sub(TOKEN).sub(expectedTransFee)
      )
    );
  });

  it("Test storage and transfer fees on real looking transfers", async function () {
    const value = BigNumber.from(1250000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give tokens to owner
    const dbackedBalance = await cgt.balanceOfNoFees(owner.address);
    expect(dbackedBalance).to.eq(value.mul(TOKEN));
    // exempt the owner address from fees calculation

    await cgt.setFeeExempt(owner.address);
    // Transfer them to external accounts
    const initialBalance1 = BigNumber.from(10).mul(TOKEN);
    await cgt.transfer(external1.address, initialBalance1);
    await cgt.transfer(external2.address, BigNumber.from(20).mul(TOKEN));
    await cgt.transfer(external3.address, BigNumber.from(30).mul(TOKEN));

    // Assert no storage fees yet
    expect(
      await cgt.calcStorageFee(external1.address),
      "Unexpected storage fee"
    ).to.eq(0);
    expect(
      await cgt.calcStorageFee(external2.address),
      "Unexpected storage fee"
    ).to.eq(0);
    expect(
      await cgt.calcStorageFee(external3.address),
      "Unexpected storage fee"
    ).to.eq(0);

    // Initially start with 0 storage fee and only transfer fee
    // sending 5 Stream Gold tokens from account 1 to account 2
    let result = await cgt
      .connect(external1)
      .transfer(external2.address, TOKEN.mul(5));
    // Two transfer events occured (the regular transfer and the fee)
    // expect(result.logs.length, 2);
    const external1Balance = await cgt.balanceOfNoFees(external1.address);
    let external2Balance = await cgt.balanceOfNoFees(external2.address);
    const feeBalance = await cgt.balanceOfNoFees(feeAddr.address);
    const expectedFee = 5 * TOKEN.toNumber() * 0.001;
    const expectedBalance1 =
      10 * TOKEN.toNumber() - 5 * TOKEN.toNumber() - expectedFee;

    // External2 account should just receive the full balance
    expect(external2Balance, "External 2 did no receive full balance").eq(
      TOKEN.mul(25)
    );
    // External1 has sent amount - transfer fee
    expect(external1Balance, "External 1 balance not expected").to.eq(
      expectedBalance1.toFixed(0)
    );
    // And fee addr just collected fees
    expect(feeBalance, "Fee balance not expected").to.eq(expectedFee);

    // Advance the chain 90 days and then transfer from account 2 to account 3
    // which should cause transfer and storage fee on full balance of 25 tokens
    // to trigger and a transfer fee on the 10 tokens being transferred
    //
    // Account 3 receiving should trigger a storage fee on the original 30 Stream Gold tokens
    await advanceTimeAndBlock(DAY * 90);

    // Calculated expected storage fees beforehand to make sure consistent from those
    // actually applied
    const calcStorFee2 = await cgt.calcStorageFee(external2.address);
    let calcStorFee3 = await cgt.calcStorageFee(external3.address);
    const expectedStorageFee2 = calcStorageFee(TOKEN.mul(25), 90);
    let expectedStorageFee3 = calcStorageFee(TOKEN.mul(30), 90);
    expect(
      calcStorFee2.eq(expectedStorageFee2),
      "Storage fee incorrect for external 2"
    );
    expect(
      calcStorFee3.eq(expectedStorageFee3),
      "Storage fee incorrect for external 3"
    );

    // Now do the transfer
    result = await cgt
      .connect(external2)
      .transfer(external3.address, TOKEN.mul(10));
    // Should trigger 3 transfer events.
    // From account 2 -> 3
    // From account 2 -> fee address
    // From account 3 -> fee address
    let receipt = await result.wait();
    expect(receipt.events?.length).to.eq(3);
    external2Balance = await cgt.balanceOfNoFees(external2.address);
    let external3Balance = await cgt.balanceOfNoFees(external3.address);
    let feeBalanceNew = await cgt.balanceOfNoFees(feeAddr.address);
    let expectedTransferFee = 10 * TOKEN.toNumber() * 0.001;
    let expectedNewFeeBalance =
      expectedFee +
      expectedStorageFee2.toNumber() +
      expectedStorageFee3.toNumber() +
      expectedTransferFee;
    const expectedBalance2 = Math.floor(
      25 * TOKEN.toNumber() -
        10 * TOKEN.toNumber() -
        expectedStorageFee2.toNumber() -
        expectedTransferFee
    );
    let expectedBalance3 = Math.floor(
      30 * TOKEN.toNumber() +
        10 * TOKEN.toNumber() -
        expectedStorageFee3.toNumber()
    );
    expect(external2Balance, "External 2 balance not expected").to.eq(
      expectedBalance2
    );
    expect(external3Balance, "External 3 balance not expected").to.eq(
      expectedBalance3
    );
    expect(feeBalanceNew, "Fee balance not expected").to.eq(
      expectedNewFeeBalance
    );

    // Verify transferring to backed treasury only induces fees for the sender
    await advanceTimeAndBlock(DAY * 90);

    // Verify expected storage fee
    calcStorFee3 = await cgt.calcStorageFee(external3.address);
    expectedStorageFee3 = calcStorageFee(BigNumber.from(expectedBalance3), 90);
    expect(calcStorFee3, "Storage fee incorrect for external 3").to.eq(
      expectedStorageFee3
    );

    // Exec transfer
    result = await cgt
      .connect(external3)
      .transfer(redeemAddr.address, TOKEN.mul(10));
    receipt = await result.wait();
    expect(receipt.events?.length).to.eq(2);
    external3Balance = await cgt.balanceOfNoFees(external3.address);
    feeBalanceNew = await cgt.balanceOfNoFees(feeAddr.address);
    const redeemBalance = await cgt.balanceOfNoFees(redeemAddr.address);

    // Calc expected values
    expectedTransferFee = Math.floor(TOKEN.toNumber() * 10 * 0.001);
    expectedBalance3 = Math.floor(
      expectedBalance3 -
        TOKEN.toNumber() * 10 -
        expectedStorageFee3.toNumber() -
        expectedTransferFee
    );
    expectedNewFeeBalance =
      expectedNewFeeBalance +
      expectedStorageFee3.toNumber() +
      expectedTransferFee;

    // Still good!
    expect(external3Balance, "External 3 balance not expected").to.eq(
      expectedBalance3
    );
    expect(feeBalanceNew, "Fee balance not expected").to.eq(
      expectedNewFeeBalance
    );
    expect(redeemBalance, "Redeem addr balance not expected").to.eq(
      TOKEN.mul(10)
    );
  });

  it("Test simulate transfers", async function () {
    const value = BigNumber.from(1250000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give Stream Gold tokens to owner
    const dbackedBalance = await cgt.balanceOfNoFees(owner.address);
    expect(dbackedBalance).to.eq(value.mul(TOKEN));

    await cgt.transfer(external2.address, BigNumber.from(20).mul(TOKEN));
    await cgt.transfer(external3.address, BigNumber.from(30).mul(TOKEN));

    // Advance the chain 90 days and then simulate transfer from account 2 to account 3
    // which should cause transfer and storage fee on full balance of 25 Stream Gold tokens
    // to trigger and a transfer fee on the 10 tokens being transferred
    //
    // Account 3 receiving should trigger a storage fee on the original 30 tokens
    await advanceTimeAndBlock(DAY * 90);

    // Calculated expected storage fees beforehand to make sure consistent from those
    // actually applied
    const expectedStorageFee2 = calcStorageFee(TOKEN.mul(20), 90);
    const expectedStorageFee3 = calcStorageFee(TOKEN.mul(30), 90);
    const expectedTransferFee = TOKEN.toNumber() * 10 * 0.001;
    let expectedBalance2 = Math.floor(
      20 * TOKEN.toNumber() -
        TOKEN.toNumber() * 10 -
        expectedStorageFee2.toNumber() -
        expectedTransferFee
    );

    const expectedBalance3 = Math.floor(
      30 * TOKEN.toNumber() +
        TOKEN.toNumber() * 10 -
        expectedStorageFee3.toNumber()
    );

    // Simulate transfer
    let result = await cgt.simulateTransfer(
      external2.address,
      external3.address,
      TOKEN.mul(10)
    );
    expect(result[0], "External 2 storage fee not expected").to.eq(
      expectedStorageFee2
    );
    expect(result[1], "External 3 storage fee not expected").eq(
      expectedStorageFee3
    );
    expect(result[2], "External 2 transfer fee not expected").to.eq(
      expectedTransferFee
    );
    expect(result[3], "External 2 balance not expected").to.eq(
      expectedBalance2
    );
    expect(result[4], "External 3 balance not expected").to.eq(
      expectedBalance3
    );

    // Test simulate transfer to self to pay storage fee
    result = await cgt.simulateTransfer(
      external2.address,
      external2.address,
      TOKEN.mul(10)
    );
    expectedBalance2 = Math.floor(
      20 * TOKEN.toNumber() - expectedStorageFee2.toNumber()
    );
    expect(result[0], "External 2 storage fee not expected").to.eq(
      expectedStorageFee2
    );
    expect(result[1].toNumber(), "Storage fee to self not expected").to.eq(0);
    expect(result[2].toNumber(), "Transfer fee to self not expected").to.eq(0);
    expect(result[3], "External 2 balance not expected").to.eq(
      expectedBalance2
    );
    expect(result[4], "External 2 balance not expected").to.eq(
      expectedBalance2
    );

    // Make sure simulate more than balance fails
    await expect(
      cgt.simulateTransfer(
        external2.address,
        external3.address,
        100 * TOKEN.toNumber()
      )
    ).to.be.revertedWith("");
  });

  // // There should only be a storage fee and no transfer fee when
  // // sending coins to self
  it("Test no transfer fee when sending to self", async function () {
    const value = BigNumber.from(1250000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give Stream Gold tokens to owner
    const dbackedBalance = await cgt.balanceOfNoFees(owner.address);
    expect(dbackedBalance).to.eq(value.mul(TOKEN));

    await cgt.transfer(external1.address, BigNumber.from(10).mul(TOKEN));

    // Move 555 days into the future
    await advanceTimeAndBlock(DAY * 555);

    let expectedFee = calcStorageFee(TOKEN.mul(10), 555);
    let calcFee = await cgt.calcStorageFee(external1.address);
    expect(
      calcFee.sub(expectedFee).abs(),
      "The storage fee is not correct on 555 days"
    ).to.lt(BigNumber.from(1));

    // Have user transfer to self to trigger storage fee, but excluding transfer fee
    await cgt.connect(external1).transfer(external1.address, TOKEN.mul(5));
    let externalBalance = await cgt.balanceOfNoFees(external1.address);
    let expectedBalance = TOKEN.mul(10).sub(expectedFee);
    expect(externalBalance).to.eq(expectedBalance);

    // Move 666 days into the future
    await advanceTimeAndBlock(DAY * 666);

    // Make sure calculated fee is expected
    expectedFee = calcStorageFee(externalBalance, 666);
    calcFee = await cgt.calcStorageFee(external1.address);
    expect(
      calcFee.sub(expectedFee).abs(),
      "The storage fee is not correct on 666 days"
    ).to.lte(BigNumber.from(1));

    // Make sure you can 0 transfer to yourself and pay storage fee
    await cgt.connect(external1).transfer(external1.address, 0);
    externalBalance = await cgt.balanceOfNoFees(external1.address);
    expectedBalance = expectedBalance.sub(expectedFee);
    expect(
      calcFee.sub(expectedFee).abs(),
      "The storage fee is not correct on 666 days"
    ).to.lte(BigNumber.from(1));
  });

  it("Test reset storage fee clock on small amounts", async () => {
    const value = BigNumber.from(10);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give Stream Gold tokens to owner
    const dbackedBalance = await cgt.balanceOfNoFees(owner.address);
    expect(dbackedBalance).to.eq(value.mul(TOKEN));

    await cgt.transfer(external1.address, TOKEN);
    // Get max sendable balance of external1
    const sendable = await cgt.balanceOf(external1.address);

    // Send all but 10 tokens to an another address
    await cgt
      .connect(external1)
      .transfer(external2.address, sendable.sub(BigNumber.from(10)));

    // Advance the blockchain one year
    await advanceTimeAndBlock(365 * DAY);

    // The storage fee after 1 year should still be 0 because the balance is so small
    const storageFee = await cgt.calcStorageFee(external1.address);
    expect(storageFee).to.eq(BigNumber.from(0));

    // If receiving new tokens, it should reset the storage fee clock because
    // we don't want a persist an unpaid storage fee on negligible amounts
    await cgt.transfer(external1.address, TOKEN);

    // Assert days since paid reset to 0 even though no storage fee was really paid
    const daysSincePaid = await cgt.daysSincePaidStorageFee(external1.address);
    expect(daysSincePaid).to.eq(BigNumber.from(0));
  });

  it("Test fees with dust amounts", async () => {
    const value = BigNumber.from(1000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give tokens to owner
    const dbackedBalance = await cgt.balanceOfNoFees(owner.address);
    expect(dbackedBalance).to.eq(value.mul(TOKEN));
    // exempt the owner address from fees calculation

    await cgt.setFeeExempt(owner.address);
    // Send 0.00000010 tokens to address and see how it affects
    // storage and transfer fee
    await cgt.transfer(external1.address, 10);
    await cgt.transfer(external2.address, 1000);

    // Assert transfer fee on 0.00000005 tokens is 0
    let transferFee = await cgt.calcTransferFee(external1.address, 5);
    expect(transferFee).to.eq(BigNumber.from(0));

    // Assert transfer fee on 0.00000999 is 0
    transferFee = await cgt.calcTransferFee(external2.address, 999);
    expect(transferFee).to.eq(BigNumber.from(0));

    // Assert transfer fee on 0.00001000 is 0.00000001 Stream Gold token
    transferFee = await cgt.calcTransferFee(external2.address, 1000);
    expect(transferFee).to.eq(BigNumber.from(1));

    // Advance a year
    await advanceTimeAndBlock(365 * DAY);

    // Assert storage fees on 0.00000010 is 0
    let storageFee = await cgt.calcStorageFee(external1.address);
    expect(storageFee).to.eq(BigNumber.from(0));

    // Assert storage fee on 0.00001000 is rounded down to 0.00000010
    // (fee is 100 basis points)
    storageFee = await cgt.calcStorageFee(external2.address);
    expect(storageFee).to.eq(BigNumber.from(2));

    // Advance a year
    await advanceTimeAndBlock(365 * DAY);

    // Assert storage fee on 0.00001000 for 2 years is 0.00000020
    // (fee is 100 basis points)
    storageFee = await cgt.calcStorageFee(external2.address);
    expect(storageFee).to.eq(BigNumber.from(5));

    // Make sure sendAllAmount is expected
    const sendAllAmount = await cgt.calcSendAllBalance(external2.address);
    const sendAllCalc = calcSendAllBalance(10, BigNumber.from(995));
    expect(sendAllAmount).to.eq(sendAllCalc);
  });

  it("Test inactive fees", async () => {
    const value = BigNumber.from(5000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give Stream Gold tokens to owner
    // exempt the owner address from fees calculation

    await cgt.setFeeExempt(owner.address);
    await cgt.transfer(external1.address, TOKEN.mul(2000));

    // At a day before INACTIVE_THRESHOLD_DAYS there should be no inactive fees
    await advanceTimeAndBlock((INACTIVE_THRESHOLD_DAYS - 1) * DAY);
    let inactiveFee = await cgt.calcInactiveFee(external1.address);
    expect(inactiveFee).to.eq(BigNumber.from(0));

    // At INACTIVE_THRESHOLD_DAYS, you can mark the account inactive and
    // it will record the snapshot balance
    await advanceTimeAndBlock(DAY);

    // The storage fee should be 25 bps on 3 years, for 2000 Stream Gold tokens this is
    // 5 tokens, leaving balance of 1975
    let storageFee = await cgt.calcStorageFee(external1.address);
    const storageFeeCalc = calcStorageFee(
      TOKEN.mul(2000),
      INACTIVE_THRESHOLD_DAYS
    );
    expect(storageFee).to.eq(storageFeeCalc);
    await cgt.setAccountInactive(external1.address);

    // After setting account inactive the storage fee should be paid, with balance
    // deducted and storage fee reset to day
    const balance = await cgt.balanceOfNoFees(external1.address);
    expect(balance).to.eq(
      BigNumber.from(2000 * TOKEN.toNumber()).sub(storageFee)
    );
    storageFee = await cgt.calcStorageFee(external1.address);
    expect(storageFee).to.eq(BigNumber.from(0));

    // Inactive fee should still be 0 on first day marked inactive
    inactiveFee = await cgt.calcInactiveFee(external1.address);
    expect(inactiveFee.toNumber()).to.eq(0);

    // Move forward one year and...
    // 1. The storage fee should still be 0
    // 2. The days since paid storage fee should be 0
    // 3. The inactive fee should be 50 basis points on 1095 tokens, which is 5.475 Stream Gold tokens
    await advanceTimeAndBlock(DAY * 365);

    // The account should show 6 years of inactivity
    const daysInactive = await cgt.daysSinceActivity(external1.address);
    expect(daysInactive).to.eq(BigNumber.from(INACTIVE_THRESHOLD_DAYS + 365));

    // Inactive fee should be on one year of inactivity
    inactiveFee = await cgt.calcInactiveFee(external1.address);
    const inactiveFeeCalc = calcInactiveFee(
      balance,
      INACTIVE_THRESHOLD_DAYS + 365,
      balance,
      0
    );
    expect(inactiveFee.eq(inactiveFeeCalc));

    // Storage fee should still be zero
    storageFee = await cgt.calcStorageFee(external1.address);
    expect(storageFee.eq(BigNumber.from(0)));

    // Assert non-fee enforcer can't force collection
    await expect(cgt.connect(feeAddr).forcePayFees(external1.address)).to.be
      .reverted;

    // Collect inactive fee
    await cgt.forcePayFees(external1.address);
    let externalBalance = await cgt.balanceOfNoFees(external1.address);
    const expectedBalance = balance.sub(inactiveFee);
    expect(externalBalance.eq(expectedBalance));

    // Now inactive fee owed should be 0
    inactiveFee = await cgt.calcInactiveFee(external1.address);
    expect(inactiveFee.eq(BigNumber.from(0)));

    // Advance 199 more years should just show remaining balance
    await advanceTimeAndBlock(365 * 199 * DAY);
    inactiveFee = await cgt.calcInactiveFee(external1.address);
    expect(inactiveFee.eq(externalBalance));

    // Now pay and expect totals
    await cgt.forcePayFees(external1.address);
    externalBalance = await cgt.balanceOfNoFees(external1.address);
    expect(externalBalance.toNumber()).to.eq(0);
    const feeBalance = await cgt.balanceOfNoFees(feeAddr.address);
    expect(feeBalance.toNumber()).to.eq(2000 * TOKEN.toNumber());
    inactiveFee = await cgt.calcInactiveFee(external1.address);
    expect(inactiveFee.eq(BigNumber.from(0)));

    // Assert can't pay inactive fees on zero address
    await expect(cgt.forcePayFees(ethers.constants.AddressZero)).to.be.reverted;

    // Assert can't force paying inactive fees on address with no balance
    await expect(cgt.forcePayFees(external3.address)).to.be.reverted;

    // Assert can't set account inactive early
    await cgt.transfer(external3.address, 1000 * TOKEN.toNumber());
    await expect(cgt.setAccountInactive(external3.address)).to.be.revertedWith(
      ""
    );

    // Assert fee exempt address can't be marked inactive
    await advanceTimeAndBlock(INACTIVE_THRESHOLD_DAYS * DAY);
    await expect(cgt.setAccountInactive(owner.address)).to.be.revertedWith("");

    // Can now pay fees on external3
    await cgt.forcePayFees(external3.address);
    // Second call should refund gas since no fees are due
    await expect(cgt.forcePayFees(external3.address)).to.be.revertedWith("");
  });

  it("Test advanced inactive fees and reactivation", async () => {
    const value = BigNumber.from(5000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give Stream Gold tokens to owner

    await cgt.transfer(external1.address, TOKEN.mul(2000));

    // At INACTIVE_THRESHOLD_DAYS + 1 year,
    // can force collect storage fees and inactive fees
    await advanceTimeAndBlock((INACTIVE_THRESHOLD_DAYS + 365) * DAY);
    let inactiveFee = await cgt.calcInactiveFee(external1.address);
    const snapshotBalance = BigNumber.from(2000 * TOKEN.toNumber()).sub(
      calcStorageFee(TOKEN.mul(2000), INACTIVE_THRESHOLD_DAYS)
    );
    let inactiveFeeCalc = calcInactiveFee(
      snapshotBalance,
      INACTIVE_THRESHOLD_DAYS + 365,
      snapshotBalance,
      0
    );
    expect(inactiveFee.eq(inactiveFeeCalc));
    let storageFee = await cgt.calcStorageFee(external1.address);
    const storageFeeCalc = calcStorageFee(
      TOKEN.mul(2000),
      INACTIVE_THRESHOLD_DAYS
    );
    expect(storageFee.eq(storageFeeCalc));

    // Collect that inactive fee and verify ending balances are expected
    // 2000 * TOKEN - storage fee for INACTIVE_THRESHOLD_DAYS - inactive fee for 1 year
    await cgt.forcePayFees(external1.address);
    const externalBalance = await cgt.balanceOfNoFees(external1.address);
    const expectedBalance = BigNumber.from(
      TOKEN.mul(2000).sub(storageFeeCalc).sub(inactiveFeeCalc)
    );
    expect(externalBalance.eq(expectedBalance));

    // Advance two years.
    await advanceTimeAndBlock(365 * 2 * DAY);

    // 1. The storage fee should still be zero
    storageFee = await cgt.calcStorageFee(external1.address);
    expect(storageFee.eq(BigNumber.from(0)));

    // 2. The inactive fee should be 50 bps on snapshotBalance for two years,
    // which is 1.0% (or divide by 100)
    inactiveFee = await cgt.calcInactiveFee(external1.address);
    inactiveFeeCalc = snapshotBalance.div(BigNumber.from(100));
    expect(inactiveFee.eq(inactiveFeeCalc));

    // 3. The sendAllBalance function should report this correctly
    // balance - owed inactive fees - transfer fee
    const sendAll = await cgt.calcSendAllBalance(external1.address);
    const expectedSendAll = BigNumber.from(
      externalBalance.sub(inactiveFee).toString()
    )
      .mul(1000)
      .div(1001)
      .toNumber()
      .toFixed(0);
    expect(
      sendAll.sub(BigNumber.from(expectedSendAll)).abs().lte(BigNumber.from(1))
    );

    // 4. Reactiving account can actually send this entire balance
    await cgt.connect(external1).transfer(external2.address, sendAll);
    const balance1 = await cgt.balanceOfNoFees(external1.address);
    expect(balance1.eq(BigNumber.from(0)));
    const balance2 = await cgt.balanceOfNoFees(external2.address);
    expect(balance2.eq(sendAll));

    // Advance a year, make sure neither account is inactive
    await advanceTimeAndBlock(365 * DAY);
    expect(!(await cgt.isInactive(external1.address)));
    expect(!(await cgt.isInactive(external2.address)));

    // Fees owed should only be storage fees
    storageFee = await cgt.calcStorageFee(external2.address);
    inactiveFee = await cgt.calcInactiveFee(external2.address);
    expect(storageFee.gt(BigNumber.from(0)));
    expect(inactiveFee.eq(BigNumber.from(0)));

    // Advance 204 years and entire balance should owed
    await advanceTimeAndBlock(365 * 204 * DAY);
    storageFee = await cgt.calcStorageFee(external2.address);
    inactiveFee = await cgt.calcInactiveFee(external2.address);
    expect(storageFee.add(inactiveFee).eq(sendAll));

    // Force paying storage fees in between doesn't mess with inactive fees?
    await cgt.forcePayFees(external2.address);
    expect(
      (await cgt.balanceOfNoFees(external2.address)).eq(BigNumber.from(0))
    );
  });

  it("Test inactive fees on small and dust collection", async () => {
    const value = BigNumber.from(5000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give Stream Gold tokens to owner

    await cgt.transfer(external1.address, TOKEN.mul(10));

    // The minimum inactive fee is 1 token per year, so should only take
    // 10 years (after set inactive to clear this account)
    await advanceTimeAndBlock((INACTIVE_THRESHOLD_DAYS + 365 * 10) * DAY);
    const storageFee = await cgt.calcStorageFee(external1.address);
    const inactiveFee = await cgt.calcInactiveFee(external1.address);
    expect(storageFee.add(inactiveFee).eq(BigNumber.from(TOKEN.mul(10))));

    // Assert sendAllBalance is shown as 0
    expect(
      (await cgt.calcSendAllBalance(external1.address)).eq(BigNumber.from(0))
    );
    // And collecting trends to zero
    await cgt.forcePayFees(external1.address);
    expect(
      (await cgt.balanceOfNoFees(external1.address)).eq(BigNumber.from(0))
    );

    // Sending tiny amount to account should be collectable after
    // INACTIVE_THRESHOLD_DAYS + 1 year
    await cgt.transfer(external2.address, 100);
    await advanceTimeAndBlock((INACTIVE_THRESHOLD_DAYS + 365) * DAY);
    expect(
      (await cgt.calcSendAllBalance(external2.address)).eq(BigNumber.from(0))
    );
    await cgt.forcePayFees(external2.address);
    expect(
      (await cgt.balanceOfNoFees(external2.address)).eq(BigNumber.from(0))
    );
  });

  it("Test advanced storage grace period with inactive fees", async () => {
    const value = BigNumber.from(5000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give Stream Gold tokens to owner

    await cgt.transfer(external1.address, TOKEN.mul(10));

    // Set storage fee grace period to a year
    await cgt.setStorageFeeGracePeriodDays(365);
    const storageFeeGracePeriod = await cgt.storageFeeGracePeriodDays();
    expect(storageFeeGracePeriod).to.eq(365);

    // Have account receive 10 tokens and go inactive for INACTIVE_THRESHOLD_DAYS + 1 year
    await cgt.transfer(external1.address, TOKEN.mul(10));
    await advanceTimeAndBlock((INACTIVE_THRESHOLD_DAYS + 365) * DAY);
    const storageFee = await cgt.calcStorageFee(external1.address);
    const inactiveFee = await cgt.calcInactiveFee(external1.address);

    // Storage fee should be on INACTIVE_THRESHOLD_DAYS - 1 year, because there
    // was a 1 year grace period on storage fees, and inactive fees take over
    const storageFeeCalc = calcStorageFee(
      TOKEN.mul(10),
      INACTIVE_THRESHOLD_DAYS - 365
    );
    expect(storageFee.eq(storageFeeCalc));

    // Inactive fee should be on one year. Because account only has 10 tokens, it
    // will hit the min inactive fee threshold of 1 token, so 1 SGLD token should be owed
    expect(inactiveFee.eq(TOKEN));
  });

  it("Test forgetting to collect inactive fee then user reactivates", async () => {
    const value = BigNumber.from(5000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give Stream Gold tokens to owner
    // User receives 100 tokens and forgets about it
    await cgt.transfer(external1.address, TOKEN.mul(100));

    // INACTIVE_THRESHOLD_DAYS + 5 years pass
    await advanceTimeAndBlock((INACTIVE_THRESHOLD_DAYS + 365 * 5) * DAY);

    // User decides to send coins to another account.
    // We should automatically collect:
    // 1. INACTIVE_THRESHOLD_DAYS worth of storage fees
    // 2. 5 years of inactive fees. (Should be 5 Stream Gold tokens because 50 bps threshold does not meet 1 token minimum)
    const expectedStorageFees = calcStorageFee(
      TOKEN.mul(100),
      INACTIVE_THRESHOLD_DAYS
    );
    const expectedSnapshotBalance = BigNumber.from(
      TOKEN.mul(100).sub(expectedStorageFees)
    );
    const expectedInactiveFees = calcInactiveFee(
      expectedSnapshotBalance,
      INACTIVE_THRESHOLD_DAYS + 365 * 5,
      expectedSnapshotBalance,
      0
    );
    // const expectedSendable = BigNumber.from(
    //   TOKEN.mul(100).sub(expectedStorageFees).sub(expectedInactiveFees)
    // );
    const storageFee = await cgt.calcStorageFee(external1.address);
    const inactiveFee = await cgt.calcInactiveFee(external1.address);
    expect(storageFee.eq(expectedStorageFees));
    expect(inactiveFee.eq(expectedInactiveFees));

    // Now send 5 Tokens to another account and expect the storage
    // and inactive fees are autodeducted
    await cgt.connect(external1).transfer(external2.address, TOKEN.mul(5));
    const balanceAfter = await cgt.balanceOfNoFees(external1.address);
    const transferFee = BigNumber.from(TOKEN.mul(5).div(BigNumber.from(1000)));
    expect(balanceAfter).to.eq(
      BigNumber.from(
        TOKEN.mul(95).sub(storageFee).sub(inactiveFee).sub(transferFee)
      )
    );
  });

  it("Test force paying storage fees does not invalidate inactive fees", async () => {
    const value = BigNumber.from(5000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give Stream Gold tokens to owner

    // User receives 100 tokens and forgets about it
    await cgt.transfer(external1.address, TOKEN.mul(1000));

    // Each year until INACTIVE_THRESHOLD_DAYS we can force collection of storage
    for (let i = 0; i < INACTIVE_THRESHOLD_DAYS / 365 - 1; i++) {
      await advanceTimeAndBlock(365 * DAY);
      await cgt.forcePayFees(external1.address);
    }

    // Been in active for year less than INACTIVE_THRESHOLD_DAYS
    await advanceTimeAndBlock(365 * DAY);
    const daysInactive = await cgt.daysSinceActivity(external1.address);
    expect(daysInactive.eq(BigNumber.from(INACTIVE_THRESHOLD_DAYS)));

    // Calling forcePayFees now
    await cgt.forcePayFees(external1.address);

    // Now the account should be marked inactive
    expect(await cgt.isInactive(external1.address));
  });

  it("Test inactive fee edge case", async () => {
    const value = BigNumber.from(5000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give Stream Gold tokens to owner

    // User receives 100 tokens and forgets about it
    await cgt.transfer(external1.address, TOKEN.mul(100));
    await cgt.transfer(external2.address, 100 * TOKEN.toNumber());

    // After INACTIVE_THRESHOLD_DAYS + 5 years, they should both owe
    // storage and inactive fees
    await advanceTimeAndBlock((INACTIVE_THRESHOLD_DAYS + 365 * 5) * DAY);
    const storageFee1 = await cgt.calcStorageFee(external1.address);
    const inactiveFee1 = await cgt.calcInactiveFee(external1.address);
    const storageFee2 = await cgt.calcStorageFee(external1.address);
    const inactiveFee2 = await cgt.calcInactiveFee(external1.address);
    expect(storageFee1.eq(storageFee2));
    expect(inactiveFee1.eq(inactiveFee2));

    // Neither account is marked inactive currently. If external1.address makes a transfer
    // of 10 token to external2 to final state should be
    // Account1: 100 - storage fees - inactive fees - transfer fee - 10
    // Account2: 100 - storage fees - inactive fees + 10
    //
    // with 3 Transfer Events 2 Inactive Events, and 1 ReActivateEvent
    await cgt.connect(external1).transfer(external2.address, TOKEN.mul(10));
    const expectedBalance1 = BigNumber.from(
      TOKEN.mul(100)
        .sub(storageFee1)
        .sub(inactiveFee1)
        .sub(BigNumber.from(TOKEN.mul(10)))
        .sub(TOKEN.div(BigNumber.from(100)))
    );
    const expectedBalance2 = BigNumber.from(TOKEN.mul(10))
      .sub(storageFee1)
      .sub(inactiveFee1);
    const balance1 = await cgt.balanceOfNoFees(external1.address);
    const balance2 = await cgt.balanceOfNoFees(external2.address);
    expect(balance1.eq(expectedBalance1));
    expect(balance2.eq(expectedBalance2));

    // Assert account 2 is marked inactive and account 1 is active
    expect(await cgt.isInactive(external2.address));
    expect(!(await cgt.isInactive(external1.address)));
  });

  it("Test receiving coins during inactive period", async () => {
    const value = BigNumber.from(5000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give Stream Gold tokens to owner

    // User receives 100 tokens and forgets about it
    await cgt.transfer(external1.address, TOKEN.mul(1000));

    // At INACTIVE_THRESHOLD_DAYS, mark account inactive
    await advanceTimeAndBlock(INACTIVE_THRESHOLD_DAYS * DAY);
    await cgt.forcePayFees(external1.address);
    expect(await cgt.isInactive(external1.address));

    // Balance should be 1000 - 25 bps on INACTIVE_THRESHOLD_DAYS years
    // with no inactive fee yet
    let balance = await cgt.balanceOfNoFees(external1.address);
    let balanceExpected = BigNumber.from(
      TOKEN.mul(1000).sub(
        calcStorageFee(TOKEN.mul(1000), INACTIVE_THRESHOLD_DAYS)
      )
    );
    expect(balance.eq(balanceExpected));

    // The inactive fee will be 50 bps of the balanceSnapshot at this point
    const inactiveFeePerYear = balance.div(BigNumber.from(200));

    // If we send equivalent to 10x the inactive fee, it should take 10 years
    // longer for the balance to clear
    await cgt.transfer(
      external1.address,
      inactiveFeePerYear.mul(BigNumber.from(10))
    );

    // There should have been no fees paid, since the account was just marked inactive
    // and owed storage fees were paid
    balance = await cgt.balanceOfNoFees(external1.address);
    balanceExpected = balanceExpected.add(
      inactiveFeePerYear.mul(BigNumber.from(10))
    );
    expect(balance.eq(balanceExpected));

    // Advance 200 years, and the balance left should the total balance of coins left
    // after the account was marked inactive
    await advanceTimeAndBlock(365 * 200 * DAY);
    await cgt.forcePayFees(external1.address);
    balance = await cgt.balanceOfNoFees(external1.address);
    balanceExpected = inactiveFeePerYear.mul(BigNumber.from(10));
    expect(balance.eq(balanceExpected));
    // Since storage fees are higher it has already covered the fees here at this point
    // // In another 10 years the balance should clear
    // await advanceTimeAndBlock(365 * 200 * DAY);
    // await cgt.forcePayFees(external1.address);
    // balance = await cgt.balanceOfNoFees(external1.address);
    // expect(balance.eq(BigNumber.from(0)));
  });

  it("Test keeping account active", async () => {
    const value = BigNumber.from(5000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give Stream Gold tokens to owner

    // User receives 100 Stream Gold tokens and forgets about it
    await cgt.transfer(external1.address, TOKEN);

    // Have account stay active by making an approve transaction every so often
    for (let i = 0; i < 10; i++) {
      await advanceTimeAndBlock(365 * DAY);
      await cgt.connect(external1).approve(external3.address, 1);
    }

    // 10 years have passed, but the account is still not inactive and owes 10
    // years worth of storage fees
    expect(!(await cgt.isInactive(external1.address)));
    let storageFee = await cgt.calcStorageFee(external1.address);
    const storageFeeCalc = calcStorageFee(TOKEN, 365 * 10);

    expect(storageFee.eq(storageFeeCalc));
    let inactiveFee = await cgt.calcInactiveFee(external1.address);
    expect(inactiveFee).to.eq(BigNumber.from(0));

    // After 400 years, the storage fee should consume entire balance
    // try it out!
    for (let i = 0; i < 400; i++) {
      await advanceTimeAndBlock(365 * DAY);
      await cgt.connect(external1).approve(external3.address, 1);
    }
    expect(!(await cgt.isInactive(external1.address)));
    storageFee = await cgt.calcStorageFee(external1.address);
    expect(storageFee.eq(TOKEN));
    inactiveFee = await cgt.calcInactiveFee(external1.address);
    expect(inactiveFee.eq(BigNumber.from(0)));

    // Even if we go another INACTIVE_THRESHOLD_DAYS without activity
    // the account won't be able to go inactive because
    // there is no balance left after storage fees
    await advanceTimeAndBlock(INACTIVE_THRESHOLD_DAYS * DAY);
    inactiveFee = await cgt.calcInactiveFee(external1.address);
    expect(inactiveFee.eq(BigNumber.from(0)));
    await expect(cgt.setAccountInactive(external1.address)).reverted;

    // Now collect entire storage fee
    await cgt.forcePayFees(external1.address);
    const balance = await cgt.balanceOfNoFees(external1.address);
    expect(balance.eq(BigNumber.from(0)));
    expect(!(await cgt.isInactive(external1.address)));
  });

  it("Test changing transfer fee", async function () {
    const currentTransferFee = await cgt.transferFeeBasisPoints();
    expect(currentTransferFee).to.eq(10);

    // Trying to change it over the MAX_TRANSFER_BASIS_POINTS should fail
    await expect(cgt.setTransferFeeBasisPoints(11)).reverted;

    // Transfer some tokens to external address
    const amount = BigNumber.from(123456789);
    const value = BigNumber.from(15000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give Stream Gold tokens to owner

    await cgt.transfer(external1.address, amount);

    // Make sure the transfer fee we calculate in floating point matches
    // the contract
    let sendAllContract = await cgt.calcSendAllBalance(external1.address);
    let sendAllCalc = calcSendAllBalance(currentTransferFee.toNumber(), amount);
    expect(sendAllContract.eq(sendAllCalc));

    // Now try it for all basis points with changing balance
    for (let i = 0; i < 10; i++) {
      await cgt.setTransferFeeBasisPoints(i);
      sendAllContract = await cgt.calcSendAllBalance(external1.address);
      sendAllCalc = calcSendAllBalance(i, amount);

      expect(sendAllContract.eq(sendAllCalc));
    }
  });

  it("Test force collection of storage fees on a contract address", async function () {
    const value = BigNumber.from(100);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give Stream Gold tokens to owner
    // exempt the owner address from fees calculation

    await cgt.setFeeExempt(owner.address);
    // Send tokens to contract address will fail // cgt have not checked this condition,
    // TODO: Good to have - ideally we should inherit from erc677 so that we can auto reject
    // await expect(cgt.transfer(cgt.address, TOKEN.mul(10))).to.be.reverted;
    await cgt.transfer(locked_oracle, TOKEN.mul(10));

    // Await 1 years and verify you can force pay storage fee
    await advanceTimeAndBlock(DAY * 365);

    const storageFee = await cgt.calcStorageFee(locked_oracle);
    const expectedFee = calcStorageFee(TOKEN.mul(10), 365);

    expect(storageFee.sub(expectedFee).abs()).to.eq(0);
    await cgt.forcePayFees(locked_oracle);
    expect(await cgt.balanceOf(feeAddr.address)).to.eq(storageFee);
  });

  // Someone trying to cheat the storage fees may try to transfer tokens
  // every day before the interest period kicks in (1 day), however the
  // contract is programmed intelligently in that it won't reset the storage
  // fee timer unless fees were actually paid during a transfer.
  it("Test cheating storage fee schedule", async function () {
    const value = BigNumber.from(10000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give Stream Gold tokens to owner

    await cgt.transfer(external1.address, TOKEN.mul(5000));

    // 6 hours
    const QUARTER_DAY = 60 * 60 * 6;
    await advanceTimeAndBlock(QUARTER_DAY);

    // Storage fee after 23 hours should be 0 dollars
    let storageFee = await cgt.calcStorageFee(external1.address);

    expect(storageFee, "Storage fee should be 0").to.eq(0);

    // A cheater should try to do a small transfer every day to avoid
    // paying storage fees
    let timePassedSincePaid = QUARTER_DAY;
    const lastDay = 0;
    for (let i = 0; i < 20; i++) {
      // Transfer 0.0000001 SGLD tokens every day to try to avoid paying
      // the storage fee
      const passed = Math.floor(timePassedSincePaid / DAY);
      storageFee = await cgt.calcStorageFee(external1.address);
      // Should only pay fees when the day has increased
      if (passed > 0) {
        timePassedSincePaid = 0;
        expect(
          storageFee.gt(BigNumber.from(0)),
          "Should owe storage fees when day has passed"
        );
      } else {
        expect(storageFee.eq(BigNumber.from(0)), "Storage fee should be 0");
      }
      await cgt.connect(external1).transfer(external2.address, 1);
      await advanceTimeAndBlock(QUARTER_DAY);
      timePassedSincePaid += QUARTER_DAY;
    }
  });

  it("Test calcSendAllBalance", async function () {
    // Mint some starting tokens to backed treasury
    const value = BigNumber.from(1250000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value.mul(TOKEN)); // give Stream Gold tokens to owner

    // Distribute tokens to external account
    await cgt.transfer(external2.address, TOKEN.mul(10));

    // Move 555 days into the future
    await advanceTimeAndBlock(DAY * 555);

    // Calcuate the amount needed to send entire balance to another address
    const amount = await cgt.calcSendAllBalance(external2.address);
    const expectedAmount = TOKEN.mul(10)
      .sub(calcStorageFee(TOKEN.mul(10), 555))
      .mul(1000)
      .div(1001);
    expect(
      amount.sub(BigNumber.from(expectedAmount)).abs(),
      "Not the expected amount"
    ).to.lte(BigNumber.from(1));

    // Now try to actually send all balance
    await cgt.connect(external2).transfer(redeemAddr.address, amount);
    const finalBalance = await cgt.balanceOfNoFees(external2.address);
    expect(finalBalance.toNumber() === 0);

    // Check zero address
    await expect(cgt.calcSendAllBalance(ethers.constants.AddressZero)).reverted;

    // Send Stream Gold tokens to fee address and expect the send all balance is everything
    await cgt.setFeeExempt(external3.address);
    await cgt.transfer(external3.address, TOKEN);
    await advanceTimeAndBlock(DAY * 555);
    const externalbalance1 = await cgt.balanceOfNoFees(external3.address);
    const externalbalance2 = await cgt.balanceOf(external3.address);
    const sendAll = await cgt.calcSendAllBalance(external3.address);
    expect(externalbalance1.toNumber()).to.eq(externalbalance2.toNumber());
    expect(externalbalance1.toNumber()).to.eq(sendAll.toNumber());
    expect(externalbalance1.toNumber()).to.eq(TOKEN);
  });

  it("Test advance transfer simulations", async function () {
    const supply = BigNumber.from(1250000);
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, TOKEN.mul(supply)); // give tokens to owner
    // Mint some starting tokens to backed treasury

    // Transfer entire amount to addr1
    await cgt.transfer(external1.address, supply);
    expect((await cgt.balanceOfNoFees(external1.address)).eq(supply));

    // Test all the edge cases on fees
    let daysPassedReceived = -1;
    for (const day of [1, 365, 366, 730, 731, 1095]) {
      for (const amount of [1, 50, 100, 1000, 10000, 100000]) {
        daysPassedReceived += day;

        // hack to make external2 never hit inactive limit
        await cgt.connect(external2).approve(external3.address, 1);

        await advanceTimeAndBlock(day * DAY);

        // amount = (amount * TOKEN.toNumber());

        const daysSinceActive1 = await cgt.daysSinceActivity(external1.address);
        const daysSinceActive2 = await cgt.daysSinceActivity(external2.address);

        // Simulate a transfer for amount
        const simulateResult = await cgt.simulateTransfer(
          external1.address,
          external2.address,
          amount
        );
        const beforeBalanceFrom = await cgt.balanceOfNoFees(external1.address);
        const beforeBalanceTo = await cgt.balanceOfNoFees(external2.address);

        // Check contract calculation vs javascript calculation
        const expectedStorageFeeFrom = simulateResult[0];
        const expectedStorageFeeTo = simulateResult[1];
        const expectedTransferFee = simulateResult[2];
        const expectedFinalBalanceFrom = simulateResult[3];
        const expectedFinalBalanceTo = simulateResult[4];

        const contractCalcStorageFeeFrom = await cgt.calcStorageFee(
          external1.address
        );
        const contractCalcStorageFeeTo = await cgt.calcStorageFee(
          external2.address
        );

        expect(
          expectedStorageFeeFrom.eq(contractCalcStorageFeeFrom),
          "Conflicting storage fee calc from"
        );
        expect(
          expectedStorageFeeTo.eq(contractCalcStorageFeeTo),
          "Conflicting storage fee calc to"
        );

        const calcStorageFeeFrom = calcStorageFee(
          beforeBalanceFrom,
          day,
          daysSinceActive1.toNumber()
        );
        const calcStorageFeeTo = calcStorageFee(
          beforeBalanceTo,
          daysPassedReceived,
          daysSinceActive2.toNumber()
        );
        const calcAmountWithTransferFee = BigNumber.from(amount)
          .mul(1000)
          .div(1001);
        const calcTransferFee = BigNumber.from(amount).sub(
          calcAmountWithTransferFee
        );
        const calcFinalBalanceFrom = beforeBalanceFrom
          .sub(amount)
          .sub(calcStorageFeeFrom)
          .sub(calcTransferFee);
        const calcFinalBalanceTo = beforeBalanceTo
          .add(amount)
          .sub(calcStorageFeeTo);

        //             calcStorageFeeTo.toString(),
        //             calcTransferFee.toString(),
        //             calcFinalBalanceFrom.toString(),
        //             calcFinalBalanceTo.toString());

        expect(
          expectedStorageFeeFrom
            .sub(calcStorageFeeFrom)
            .abs()
            .lte(BigNumber.from(1)),
          "Bad storage fee calculation from"
        );
        expect(
          expectedStorageFeeTo
            .sub(calcStorageFeeTo)
            .abs()
            .lte(BigNumber.from(1)),
          "Bad storage fee calculation to"
        );
        expect(
          expectedTransferFee.sub(calcTransferFee).abs().lte(BigNumber.from(1)),
          "Bad transfer fee calculation"
        );
        expect(
          expectedFinalBalanceFrom
            .sub(calcFinalBalanceFrom)
            .abs()
            .lte(BigNumber.from(1)),
          "Bad final balance calculation from"
        );
        expect(
          expectedFinalBalanceTo
            .sub(calcFinalBalanceTo)
            .abs()
            .lte(BigNumber.from(1)),
          "Bad final balance calculation to"
        );

        // Now actually do the transfer and observer the final balances
        await cgt.connect(external1).transfer(external2.address, amount);
        const afterBalanceFrom = await cgt.balanceOfNoFees(external1.address);
        const afterBalanceTo = await cgt.balanceOfNoFees(external2.address);
        expect(
          afterBalanceFrom.eq(expectedFinalBalanceFrom),
          "Expected from balance does not match acutal"
        );
        expect(
          afterBalanceTo.eq(expectedFinalBalanceTo),
          "Expected from balance does not match acutal"
        );

        if (calcStorageFeeTo.gt(BigNumber.from(0))) {
          daysPassedReceived = 0;
        }
      }
    }

    // Finally expect that the totals are still matching
    await expectTotals(cgt);
  });

  it("Test advanced calcSendAllBalance", async function () {
    const value = SUPPLY_LIMIT;
    await cgt.setFxManager(bridge.address); // set the bridge to mint new tokens
    await cgt.connect(bridge).mint(owner.address, value); // give Stream Gold tokens to external1
    const dbackedBalance = await cgt.balanceOfNoFees(owner.address);
    expect(dbackedBalance).to.eq(value);

    let finalBalance = BigNumber.from(0);
    expect(dbackedBalance, "Incorrect balance").to.eq(SUPPLY_LIMIT);

    // Test all the edge cases on fees
    for (const day of [1, 365, 366, 730, 731, 1095]) {
      for (const tokens of [1, 50, 123, 1234, 12345, 123456]) {
        for (const basisPoints of [1, 3, 5, 7, 9]) {
          // Set basis points for transfer fee
          await cgt.setTransferFeeBasisPoints(basisPoints);

          // Send certain amount of Stream Gold tokens
          const amount = BigNumber.from(TOKEN.mul(tokens));
          await cgt.transfer(external2.address, amount.sub(finalBalance));

          // hack to make external2 never hit inactive limit
          await cgt.connect(external2).approve(external3.address, 1);

          // Advance time
          await advanceTimeAndBlock(day * DAY);

          // Calcuate the amount needed to send entire balance to another address
          const calcSendAll = await cgt.calcSendAllBalance(external2.address);
          const expectedAmount = calcSendAllBalance(
            basisPoints,
            amount.sub(calcStorageFee(amount, day))
          );

          expect(
            calcSendAll.sub(expectedAmount).abs(),
            "Not the expected amount"
          ).to.lte(BigNumber.from(2));

          const balanceBeforeSentBalance = await cgt.balanceOfNoFees(
            external2.address
          );
          const feeAddrBeforeSentBalance = await cgt.balanceOfNoFees(
            feeAddr.address
          );
          // Now try to actually send all balance
          await cgt
            .connect(external2)
            .transfer(redeemAddr.address, calcSendAll);
          finalBalance = await cgt.balanceOfNoFees(external2.address);
          const redeemBalance = await cgt.balanceOfNoFees(redeemAddr.address);
          const feeAfterBalance = await cgt.balanceOfNoFees(feeAddr.address);

          const balanceWFees = await cgt.balanceOf(external2.address);

          expect(finalBalance).to.lte(BigNumber.from(2));
          expect(balanceWFees).to.lte(BigNumber.from(1));
        }
      }
    }
  }).timeout(200000);
});
