import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', 'packages/corpus/raw/**', 'plugins/**', '.agents/**'],
  },
  ...tseslint.configs.strict,
  { rules: { '@typescript-eslint/no-explicit-any': 'error' } },
);
