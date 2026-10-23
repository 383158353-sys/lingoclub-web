# Acceptance

Checked in this branch with `npm test` and `npm run build`.

## Covered by unit tests

- Word-card cue playback asks the YouTube player and the iframe fallback for muted inline `autoplay=1` plus an integer `start`. Study playback that does not request cue autoplay stays at `autoplay=0`.
- A programmatic subtitle follow-scroll does not cancel the next tap. A scroll event with no finger movement still counts as a tap.
- Daily review size scales around the existing 40-card quotas, clamps to 5–100, and leaves the default 40-card queue unchanged.
- `mastery_level: "mastered"` cards are left out of the daily queue and `isDue`. `斩` writes that existing mastered state; undoing it returns the card to learning.
- Removing a 斩'd card from a saved queue keeps the following card in place. Same-day resume, next-day restart, and finished sessions keep their previous rules.
- Listening and translation choices are filled synchronously from the vocabulary pool, then a fixed bank, before any network distractor request. A slow or failed prefetch does not remove those choices.

## Not device-verified here

iPhone Safari and the installed PWA were not available in this environment. These still need a pass on a phone:

- Cue autoplay actually starts the saved loop with sound, and the in-app 「播放原句」 button is the fallback when unmuted autoplay is blocked.
- First tap on a vocabulary card and on 「精读」 opens the detail or study view.
- The vocabulary header sits below the Dynamic Island.
- 「隐藏来源」, 「每日题量」, and 「斩」 / 「取消斩」 match the layout in the screenshots.
- Round 3 「听音选词」 shows four choices without staying on 「正在准备相近干扰项」.

Resume-from-exit behavior was left as it already works and was not rewritten.
