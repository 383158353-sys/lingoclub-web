# Acceptance

Checked in this branch with `npm test` and `npm run build`.

## Covered by unit tests

- Opening a sentence preview asks for muted inline `autoplay=1`, an integer `start`, and `controls=0`, and loops by seeking to the cue start. It does not render 「播放原句」 or YouTube's `loop=1` / `playlist` whole-video loop. Study playback that does not request cue autoplay stays at `autoplay=0` with the default controls.
- A programmatic subtitle follow-scroll does not cancel the next tap. A scroll event with no finger movement still counts as a tap.
- Daily review size scales around the existing 40-card quotas, clamps to 5–100, and leaves the default 40-card queue unchanged.
- `mastery_level: "mastered"` cards are left out of the daily queue and `isDue`. `斩` on the detail and review footers writes that existing mastered state; undoing it returns the card to learning. Corpus list rows do not render 斩 or 取消斩.
- Removing a 斩'd card from a saved queue keeps the following card in place. Same-day resume, next-day restart, and finished sessions keep their previous rules.
- Listening and translation choices are filled synchronously from the vocabulary pool, then a fixed bank, before any network distractor request. A slow or failed prefetch does not remove those choices.

## Not device-verified here

iPhone Safari and the installed PWA were not available in this environment. These still need a pass on a phone:

- Cue autoplay actually starts the saved loop on a phone. Unmuted playback can still be blocked by the browser; the preview keeps looping muted and does not show a second play button.
- First tap on a vocabulary card and on 「精读」 opens the detail or study view.
- The vocabulary header sits below the Dynamic Island.
- 「隐藏来源」 and 「每日题量」 match the screenshots. 斩 sits in the detail footer beside 关闭, and in the review footer beside 继续复习, without covering the gloss, sentence, or video. List cards have no 斩.
- Round 3 「听音选词」 shows four choices without staying on 「正在准备相近干扰项」.

Resume-from-exit behavior was left as it already works and was not rewritten.
