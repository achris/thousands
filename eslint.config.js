import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    // The rules engine must stay pure: no Foundry or PF2e globals.
    files: ["src/rules/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...["game", "foundry", "CONFIG", "Hooks", "ui", "canvas"].map((name) => ({
          name,
          message: "src/rules must not reference Foundry or PF2e globals.",
        })),
      ],
    },
  },
);
