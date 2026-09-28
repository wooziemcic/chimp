// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Supabase Edge Functions run on Deno (checked by Supabase, not the app build).
    ignores: ["dist/*", "supabase/functions/*"],
  }
]);
