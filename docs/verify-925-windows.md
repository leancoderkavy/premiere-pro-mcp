# KAV-312 live Premiere 26.x verification

1. Run `npm ci` then `npm run build` on Windows. Install/reload the CEP panel, open Premiere 26.x, and make a disposable active sequence with media spanning at least 101 seconds. Keep all participating tracks unlocked and sync-locked.
2. Run `node scripts/verify-925.mjs`. It connects through local stdio, previews then applies ten one-second spread ranges at QE batch sizes 8, 4, and 16. Record its JSON `pass`, `undoSteps`, and `undoStackIndex` output.
3. Before the 41-step case, create 41 disposable undoable timeline actions in Premiere, note the current QE undo-stack index, then run `$env:KAV312_UNDO_INDEX=<index>; node scripts/verify-925.mjs`. The result must report `multipleUndo41: true` and `undoSteps: 41`.

Each apply changes the active sequence. Use a fresh disposable sequence for each run, or undo its reported `undoSteps` before rerunning. This is live-host verification only; repository tests do not establish Premiere behavior.
