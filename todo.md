# To-do list

## Instructions to AI agents (CLAUDE, CLINE)

These are issues and suggestions from manual user testing. Some are small tweaks, some might require more thinking - evaluate each and decide if my input is needed.

Work from top to bottom. Where it makes sense to combine multiple items (e.g. 2 items about margins and spacing) and it would be more efficient, combine them. Otherwise, do each item in a separate commit.

## Items

- ~~add app icon (incl favicon) - see `/home/andrie/Downloads/gain-icons/`~~ done (acfbcb8)
- ~~the top and bottom margin of the exercise cue paragraphs (`cue svelte-10ev20x`) are too much, wastes real estate. Change it to 2px.~~ done (b643cfe)
- ~~the block name (`block-head`) needs some margin bottom, it sits tightly against the exercises div (`ul exercises`).~~ done (b643cfe)
- ~~generalize bootstrap prompt, don't be specific to home training.~~ done (df6bc9b)
- ~~change the tone of the app UI and prompt templates to be a little less "neutral", I'm thinking it should be a bit more motivational, like a personal trainer would be. Not too much though.~~ done (8934b55)
- seems like AI that creates GAIN plans based on the bootstrap prompt doesn't realise that the GAIN app uses _total_ weight for loads. And all exercises using e.g. "heavy" load uses the same weight, regardless of whether the exercise uses 1 or 2 dumbbells. For example, goblet squat vs dumbbell floor press.
- ~~add some personalisation - read the user's display name from OIDC and use it for a greeting, and include it in the bootstrap prompt.~~ done
- when starting an exercise with no history, always populate a default number of reps. For example, an exercise stating 8-12 reps, use the lower limit of 8. Also, when starting set 2, always default to the previous set's rep count.
- the same should apply to weight - currently it populates a default weight when no history exists e.g. 6 kg; when the user enters 8 kg for set, then when starting set 2, it should keep the 8 kg of set 1.
- loads carry a default kg which is used when no history exists, correct? when a plan is revised and re-imported, would it be possible to use the updated default kg instead of history? my thinking is: user follows plan, progresses and logs higher weights, then exports the plan to AI and lands on a new "default" weight. Next training session on v2 plan should use the new weights, instead of using the historical weight. Although, argument might be that user went from 10 kg to 12 kg which is now the latest from history, v2 plan sets default weight to 12 kg, and we land on exactly this behaviour without changing anything. Worth a chat.

- change the session start links to buttons to give it a more modern feel.
- change the "End session" button to a different colour, maybe a red, shaded to match the app colour theme.
