# LingoClub product context

LingoClub is an immersive language-learning tool for Chinese-native English learners. Its core learning loop is watching films or videos, understanding dialogue, studying expressions in context, saving vocabulary, reviewing it, and returning to the original scene.

The product already has an established visual system (black and teal) and complete existing flows. Changes should be focused fixes or optimizations, not redesigns. Reuse existing components, data structures, interactions, and visual conventions. Avoid unnecessary buttons; automate work where practical, communicate loading/progress clearly, and keep mobile comfortable and feature-equivalent with desktop.

For subtitle work, captions, semantic sentences, translations, close reading, vocabulary sources, and playback must share one sentence/source-timing model. Follow regression-first: inspect history, reuse existing logic, and avoid duplicate implementations. Changes in this area are for DEV acceptance first; do not push `main` or deploy Production until the user explicitly approves.
