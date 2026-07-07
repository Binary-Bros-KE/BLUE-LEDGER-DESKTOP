import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    ignores: ["out/**", "out-tsc/**", "release/**", "node_modules/**"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    }
  }
];
