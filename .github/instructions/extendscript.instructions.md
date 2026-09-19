---
applyTo: "src/bridge/**/*.ts,src/tools/**/*.ts,cep-plugin/**,after-effects-cep-plugin/**"
---

Follow `AGENTS.md` (ExtendScript section).

Generated Premiere/After Effects scripts must be ECMAScript 3: `var`, traditional functions, `for` loops. Do not emit `let`, `const`, arrows, template literals, destructuring, spread, default parameters, or `Array.forEach`/`map`/`filter`.

Escape every user-controlled string with `escapeForExtendScript` before embedding. Never interpolate raw paths, names, expressions, or prompts. Use `buildToolScript` / `buildScript` and existing `__result` / `__error` / `__find*` helpers. Label QE DOM usage as experimental.
