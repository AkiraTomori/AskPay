import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      'packages/corpus/raw/**',
      'plugins/**',
      '.agents/**',
      'contracts/lib/**',
      'contracts/out/**',
      'contracts/cache/**',
    ],
  },
  ...tseslint.configs.strict,
  { rules: { '@typescript-eslint/no-explicit-any': 'error' } },
);
