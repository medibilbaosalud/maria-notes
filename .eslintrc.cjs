module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  ignorePatterns: [
    'dist',
    'dist-electron',
    'node_modules',
    'test-results',
    'old_supabase.ts',
    'old_supabase_utf8.ts',
  ],
  rules: {},
};
