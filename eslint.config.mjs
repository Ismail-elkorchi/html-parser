import js from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";
import importPlugin from "eslint-plugin-import";

const typedFiles = ["src/**/*.ts", "tests/**/*.ts"];

const recommendedTypeChecked = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: typedFiles
}));

const strictTypeChecked = tseslint.configs.strictTypeChecked.map((config) => ({
  ...config,
  files: typedFiles
}));

export default [
  {
    ignores: ["dist/**", "node_modules/**", "tmp/**"]
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    ...js.configs.recommended,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: {
        console: "readonly",
        URL: "readonly"
      }
    }
  },
  ...recommendedTypeChecked,
  ...strictTypeChecked,
  {
    files: typedFiles,
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      boundaries,
      import: importPlugin
    },
    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: false,
          project: "./tsconfig.eslint.json"
        }
      },
      "boundaries/elements": [
        { "type": "public", "pattern": "src/public/**" },
        { "type": "internal", "pattern": "src/internal/**" },
        { "type": "tests", "pattern": "tests/**" }
      ]
    },
    rules: {
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { "prefer": "type-imports", "fixStyle": "inline-type-imports" }
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "import/no-duplicates": "error",
      "import/order": [
        "error",
        {
          "groups": ["builtin", "external", "internal", "parent", "sibling", "index", "type"],
          "newlines-between": "always",
          "alphabetize": {
            "order": "asc",
            "caseInsensitive": true
          }
        }
      ],
      "boundaries/element-types": [
        "error",
        {
          "default": "disallow",
          "rules": [
            { "from": "public", "allow": ["public", "internal"] },
            { "from": "internal", "allow": ["internal"] },
            { "from": "tests", "allow": ["public", "internal", "tests"] }
          ]
        }
      ]
    }
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "import/no-nodejs-modules": "error"
    }
  },
  {
    files: ["src/internal/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          "patterns": [
            {
              "group": [
                "src/public",
                "src/public/*",
                "../public",
                "../public/*",
                "../../public",
                "../../public/*"
              ],
              "message": "src/internal must not import src/public."
            }
          ]
        }
      ]
    }
  }
];
