import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      // Machine-generated, and only present once the web app has been run or
      // built: Vite's pre-bundled dep cache and Vitest's cache. Linting them
      // reports thousands of errors against vendor code on any dev machine.
      "**/.vite/**",
      "**/.vitest/**",
      // The OpenAPI client is generated from openapi.yaml — fix the spec, not
      // the output.
      "packages/*/src/generated/**",
      "prisma/migrations/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier
];
