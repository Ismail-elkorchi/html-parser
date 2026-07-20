import js from "@eslint/js";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";
import importPlugin from "eslint-plugin-import-x";

const typedFiles = ["src/**/*.ts", "test/**/*.ts"];

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
    ignores: ["dist/**", "node_modules/**", "tmp/**", "test/fixtures/upstream/**"]
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    ...js.configs.recommended,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: {
        AbortController: "readonly",
        Buffer: "readonly",
        console: "readonly",
        process: "readonly",
        ReadableStream: "readonly",
        TextEncoder: "readonly",
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
      "import-x": importPlugin
    },
    settings: {
      "import-x/resolver-next": [
        createTypeScriptImportResolver({
          alwaysTryTypes: false,
          project: "./tsconfig.eslint.json"
        })
      ],
      "boundaries/elements": [
        { "type": "public", "pattern": "src/public/**" },
        { "type": "internal-foundation", "pattern": "src/internal/foundation/**" },
        { "type": "encoding", "pattern": "src/internal/encoding/**" },
        { "type": "engine", "pattern": "src/internal/html-engine/**" },
        { "type": "internal", "pattern": "src/internal/**" },
        { "type": "tests", "pattern": "test/**" }
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
      "import-x/no-duplicates": "error",
      "import-x/order": [
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
      "boundaries/dependencies": [
        "error",
        {
          "default": "disallow",
          "policies": [
            {
              "from": { "element": { "types": "public" } },
              "allow": {
                "to": {
                  "element": {
                    "types": { "anyOf": ["public", "engine", "encoding", "internal-foundation"] }
                  }
                }
              }
            },
            {
              "from": { "element": { "types": "engine" } },
              "allow": {
                "to": { "element": { "types": { "anyOf": ["engine", "internal-foundation"] } } }
              }
            },
            {
              "from": { "element": { "types": "encoding" } },
              "allow": {
                "to": { "element": { "types": { "anyOf": ["encoding", "internal-foundation"] } } }
              }
            },
            {
              "from": { "element": { "types": "internal-foundation" } },
              "allow": { "to": { "element": { "types": "internal-foundation" } } }
            },
            {
              "from": { "element": { "types": "internal" } },
              "allow": {
                "to": { "element": { "types": { "anyOf": ["internal", "internal-foundation"] } } }
              }
            },
            {
              "from": { "element": { "types": "tests" } },
              "allow": {
                  "to": {
                    "element": {
                      "types": {
                        "anyOf": [
                          "public",
                          "engine",
                          "encoding",
                          "internal",
                          "internal-foundation",
                          "tests"
                        ]
                      }
                    }
                  }
              }
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "import-x/no-nodejs-modules": "error",
      "no-restricted-syntax": [
        "error",
        {
          "selector": "ThrowStatement > NewExpression[callee.name='Error']",
          "message": "Production failures must use a typed error category."
        },
        {
          "selector": "ThrowStatement > CallExpression[callee.name='Error']",
          "message": "Production failures must use a typed error category."
        }
      ]
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
  },
  {
    files: ["src/mod.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          "patterns": [
            {
              "group": ["./internal", "./internal/*", "./internal/**"],
              "message": "The package root may export only modules owned by src/public."
            }
          ]
        }
      ]
    }
  }
];
