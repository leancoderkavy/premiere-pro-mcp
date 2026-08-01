import premierepro from "@adobe/eslint-plugin-premierepro";
import tsParser from "@typescript-eslint/parser";

const premiereRules = premierepro.configs.recommended;

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "landing/**",
      "uxp-spike/**",
    ],
  },
  {
    files: ["uxp-plugin/**/*.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      parser: tsParser,
      globals: {
        URL: "readonly",
        WebSocket: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        document: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
      },
    },
    plugins: premiereRules.plugins,
    rules: {
      ...premiereRules.rules,
      "@adobe/premierepro/prefer-locked-access-wrapper": "error",
      "@adobe/premierepro/prefer-undo-string": "error",
    },
  },
];
