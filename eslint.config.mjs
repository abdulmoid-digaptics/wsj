import { defineConfig, globalIgnores } from "eslint/config";
import {readFileSync} from 'node:fs';
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Read the installed version directly instead of plugin-react's parent-path
// auto-detection, which can fail in restricted workspaces. No rules are disabled.
const reactVersion = JSON.parse(readFileSync(new URL('./node_modules/react/package.json', import.meta.url), 'utf8')).version;
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {settings:{react:{version:reactVersion}}},
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**", "backend/**", "scripts/**", "data/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

