// @ts-check
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments'
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import testingLibrary from 'eslint-plugin-testing-library'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const NO_DEFAULT_EXPORT = { selector: 'ExportDefaultDeclaration', message: 'Default export. Export it by name.' }
const NO_CLASS_COMPONENT = {
  selector:
    'ClassDeclaration[superClass.name="Component"], ClassDeclaration[superClass.property.name="Component"], ClassDeclaration[superClass.property.name="PureComponent"]',
  message: 'Class component. Write a function component.',
}
const NO_TRPC_OUTSIDE_HOOKS = {
  group: ['**/trpc', '**/trpc.js', '**/trpc.ts'],
  message: 'The tRPC client is called from a hook in hooks/. Call the hook.',
}
const FORBIDDEN_IN_SPECS = [
  { name: 'electron', message: 'Stub the module; a unit test never starts Electron.' },
  { name: 'node:fs', message: 'A unit test never touches the filesystem.' },
  { name: 'node:fs/promises', message: 'A unit test never touches the filesystem.' },
  { name: 'node:child_process', message: 'Stub the driver; a unit test never starts a process.' },
]

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'docs/**'] },

  // ---- baseline: recommended sets -----------------------------------------
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.web.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  // Plain JS config files are outside both tsconfigs.
  { files: ['**/*.{js,mjs,cjs}'], ...tseslint.configs.disableTypeChecked },
  { files: ['**/*.{js,mjs,cjs}', '*.config.ts'], languageOptions: { globals: globals.node } },

  // ---- everything in src ---------------------------------------------------
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, 'ts-nocheck': true },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': ['error', NO_DEFAULT_EXPORT],
    },
  },

  // ---- main, preload, shared ---------------------------------------------
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/shared/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'exit', message: 'process.exit. Set the exit status and return.' },
      ],
    },
  },

  // ---- renderer -----------------------------------------------------------
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ...react.configs.flat.recommended,
    ...react.configs.flat['jsx-runtime'],
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: globals.browser,
    },
    settings: { react: { version: 'detect' } },
  },
  { files: ['src/renderer/**/*.{ts,tsx}'], ...reactHooks.configs.flat.recommended },
  { files: ['src/renderer/**/*.{ts,tsx}'], ...jsxA11y.flatConfigs.recommended },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { '@eslint-community/eslint-comments': eslintComments },
    rules: {
      'react/prop-types': 'off', // TypeScript types the props.
      'react-hooks/exhaustive-deps': 'error',
      'no-restricted-syntax': ['error', NO_DEFAULT_EXPORT, NO_CLASS_COMPONENT],
      '@eslint-community/eslint-comments/no-restricted-disable': ['error', 'react-hooks/exhaustive-deps'],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Direct HTTP. Reach main through the tRPC hooks in hooks/.' },
      ],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ignores: ['src/renderer/src/hooks/**', 'src/renderer/src/main.tsx', 'src/renderer/src/trpc.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [NO_TRPC_OUTSIDE_HOOKS] }] },
  },
  {
    files: ['src/renderer/**/*.spec.{ts,tsx}'],
    ...testingLibrary.configs['flat/react'],
  },
  {
    files: ['src/renderer/**/*.spec.{ts,tsx}'],
    rules: {
      'testing-library/no-container': 'error',
      'testing-library/no-node-access': 'error',
      'testing-library/prefer-user-event': 'error',
    },
  },

  // ---- specifications (after the blocks above, so it applies over them) ----
  {
    files: ['src/**/*.spec.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { paths: FORBIDDEN_IN_SPECS }] },
  },

  // ---- config files: tooling expects a default export ----------------------
  { files: ['*.config.{ts,mjs}'], rules: { 'no-restricted-syntax': 'off' } },

  // ---- formatting is Prettier's job (last) --------------------------------
  prettier,
)
