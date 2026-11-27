/**
 * A real pack reveal on Base Sepolia, for the tests that read one (not a test file itself).
 *
 * tx 0x923ea166…18982355, block 64,095,822, copied from its receipt on 2026-11-26: Letters
 * (0xb6e3…00CC) opened commit 177 and minted five letters to its buyer: r, i, d, d, a. The receipt
 * holds one ERC-1155 `TransferSingle` per letter and then the one `Revealed` that names the commit.
 * (This reveal was sent by the buyer's own wallet, before the relay: the operator in each transfer
 * is the buyer. A relayed reveal's logs differ only in that operator.)
 */
export const LETTERS = "0xb6e3B233Ff7cEB709f20A36FA947a53E47e600CC";
export const PACK_COMMIT = 177n;
export const PACK_BUYER = "0x0Fc0F78fc939606db65F5BBF2F3715262C0b2F6E";
/** r, i, d, d, a */
export const PACK_LETTERS = [17, 8, 3, 3, 0];
export const PACK_BLOCK = 64_095_822n;

const ADDRESS = "0xb6e3b233ff7ceb709f20a36fa947a53e47e600cc";
const TRANSFER_SINGLE = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
const REVEALED = "0x53891208e42d94e86f84dd291f0f89de8738a6662798851574b37cb41a37d93b";
const BUYER_TOPIC = "0x0000000000000000000000000fc0f78fc939606db65f5bbf2f3715262c0b2f6e";
const ZERO_TOPIC = "0x0000000000000000000000000000000000000000000000000000000000000000";
const word = (n: number) => n.toString(16).padStart(64, "0");

/** The mint of one letter: TransferSingle(operator, from = 0, to, id, value = 1). */
const minted = (id: number) => ({
  address: ADDRESS,
  topics: [TRANSFER_SINGLE, BUYER_TOPIC, ZERO_TOPIC, BUYER_TOPIC] as `0x${string}`[],
  data: `0x${word(id)}${word(1)}` as `0x${string}`,
});

export const PACK_REVEAL_LOGS = [
  ...PACK_LETTERS.map(minted),
  {
    address: ADDRESS,
    topics: [REVEALED, `0x${word(177)}`, BUYER_TOPIC] as `0x${string}`[],
    // the dynamic array: its offset (0x20), its length (5), then the five ids
    data: `0x${word(0x20)}${word(5)}${PACK_LETTERS.map(word).join("")}` as `0x${string}`,
  },
];
