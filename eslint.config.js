import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/out/**", "**/test-results/**", "**/node_modules/**", "engine/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
