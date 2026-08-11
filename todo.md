# To-do list

## Instructions to AI agents (CLAUDE, CLINE)

These are issues and suggestions from manual user testing. Some are small tweaks, some might require more thinking - evaluate each and decide if my input is needed.

Work from top to bottom. Where it makes sense to combine multiple items (e.g. 2 items about margins and spacing) and it would be more efficient, combine them. Otherwise, do each item in a separate commit.

## Items

### General UI/UX

- ~~add app icon (incl favicon) - see `/home/andrie/Downloads/gain-icons/`~~ done (acfbcb8)
- ~~the top and bottom margin of the exercise cue paragraphs (`cue svelte-10ev20x`) are too much, wastes real estate. Change it to 2px.~~ done (b643cfe)
- ~~the block name (`block-head`) needs some margin bottom, it sits tightly against the exercises div (`ul exercises`).~~ done (b643cfe)
- ~~generalize bootstrap prompt, don't be specific to home training.~~ done (df6bc9b)
- ~~change the tone of the app UI and prompt templates to be a little less "neutral", I'm thinking it should be a bit more motivational, like a personal trainer would be. Not too much though.~~ done (8934b55)
- ~~add some personalisation - read the user's display name from OIDC and use it for a greeting, and include it in the bootstrap prompt.~~ done
- ~~change the session start links to buttons to give it a more modern feel.~~ done (b463480)
- ~~change the "End session" button to a different colour, maybe a red, shaded to match the app colour theme.~~ done (fc39fe8) — used the accent colour instead of red; UI-DECISIONS §5 reserves red for the symptom scale
- ~~move the "End session" button to the bottom - it's typically clicked at the end of a session, not at the start.~~ done
- ~~the "Round 1 of 2 done" needs some spacing between it and the exercise - currently it's pressed together.~~ done
- ~~The session start buttons look different to the rest of the buttons. Can we change them to look like the "Continue to session" button, keeping the full width though.~~ done
- ~~highlight the current set more - currently the set number is accented, but that's not much to draw eyes. Could we do something like highlight the row?~~ done

### Behavior

- ~~when starting an exercise with no history, always populate a default number of reps. For example, an exercise stating 8-12 reps, use the lower limit of 8. Also, when starting set 2, always default to the previous set's rep count.~~ done (cc39ba0) — also extended to duration for timed exercises (e.g. side-plank), same rule
- ~~the same should apply to weight - currently it populates a default weight when no history exists e.g. 6 kg; when the user enters 8 kg for set, then when starting set 2, it should keep the 8 kg of set 1.~~ done (cc39ba0)

### Decision-challenging

- ~~When building a plan with an AI, it seems there is some confusion about the loads. We land on heavy, moderate, and light loads, but then it gets confused about loads with kg and 1-dumbbell vs 2-dumbbell exercises.~~ done — the "total kg, not per-dumbbell" rule lived only in the internal UI-DECISIONS.md, never in CONTRACT.md, which is the doc actually shipped to the authoring AI; added it there plus explicit `per_side` guidance for alternating-arm movements (e.g. alternating curls: one set, total reps, total kg, `per_side` omitted — no schema change needed), and a matching question to the bootstrap prompt's equipment interview.
