import eslintComments from '@eslint-community/eslint-plugin-eslint-comments'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import testingLibrary from 'eslint-plugin-testing-library'
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

export default [
  { ignores: ['out/**', 'dist/**', 'node_modules/**', '*.config.ts', '*.config.mjs'] },

  // ---- everything ---------------------------------------------------------
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, 'ts-nocheck': true },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
      'no-restricted-syntax': ['error', NO_DEFAULT_EXPORT],
    },
  },

  // ---- main, preload, shared ---------------------------------------------
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/shared/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'exit', message: 'process.exit. Set the exit status and return.' },
      ],
    },
  },

  // ---- main (type-aware) --------------------------------------------------
  {
    files: ['src/main/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.node.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },

  // ---- renderer -----------------------------------------------------------
  {
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    plugins: {
      '@eslint-community/eslint-comments': eslintComments,
      'jsx-a11y': jsxA11y,
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-restricted-syntax': ['error', NO_DEFAULT_EXPORT, NO_CLASS_COMPONENT],
      '@eslint-community/eslint-comments/no-restricted-disable': ['error', 'react-hooks/exhaustive-deps'],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Direct HTTP. Reach main through the tRPC hooks in hooks/.' },
      ],
      'jsx-a11y/click-events-have-key-events': 'error',
      'jsx-a11y/no-static-element-interactions': 'error',
    },
  },
  {
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    ignores: ['src/renderer/src/hooks/**', 'src/renderer/src/main.tsx', 'src/renderer/src/trpc.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [NO_TRPC_OUTSIDE_HOOKS] }] },
  },
  {
    files: ['src/renderer/**/*.spec.ts', 'src/renderer/**/*.spec.tsx'],
    plugins: { 'testing-library': testingLibrary },
    rules: {
      'testing-library/no-container': 'error',
      'testing-library/no-node-access': 'error',
      'testing-library/prefer-user-event': 'error',
    },
  },

  // ---- specifications (last, so it applies over the blocks above) --------
  {
    files: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    rules: { 'no-restricted-imports': ['error', { paths: FORBIDDEN_IN_SPECS }] },
  },
]
