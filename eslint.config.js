import javascript from '@eslint/js';
import typescript from 'typescript-eslint';

export default typescript.config(
  {
    ignores: [
      '**/dist/**',
      'tai_lieu/**',
      'tam_thoi/**',
      '**/node_modules/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  javascript.configs.recommended,
  ...typescript.configs.recommended,
  // Tệp JavaScript chạy trên Node
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
);
