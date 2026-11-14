// MagicBlock Quests that players claim on this site (#/claim). The ids are MagicBlock's quest
// numbers; keep the list in sync with QUESTS in worker/index.ts.
export interface Quest {
  id: number;
  title: string;
  text: string;
  steps: string[];
}

export const QUESTS: Quest[] = [
  {
    id: 115,
    title: "Win 3 Free Nights",
    text: "Win 3 nights on BLACKOUT, then share them on X tagging @_playblackout and @magicblock.",
    steps: [
      "Connect the same wallet as your MagicBlock Quests account and win 3 nights.",
      "After each win, tap 🎬 Make Clip on the results screen.",
      "Tap Post on X and attach your clips in one post or a thread.",
    ],
  },
];

/** The text a wallet signs to claim a quest (the Worker rebuilds and checks it). */
export const claimMessage = (quest: number, wallet: string, post: string, at: number) =>
  `BLACKOUT quest claim\nquest: ${quest}\nwallet: ${wallet}\npost: ${post}\ntime: ${at}`;
