// Learn English with Play — ESLint flat config.
// Guardrails enforced here (DECISIONS §7.7, §7.8):
//   * no colour literal outside src/design/*.generated.ts (tokens are the only colour source);
//   * logical properties only in styles (start/end, never left/right) so RTL works;
//   * the auth code never touches AsyncStorage, localStorage or sessionStorage;
//   * type-aware promise rules on (brief §3: no-floating-promises).
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const tseslint = require('typescript-eslint');

const COLOUR_LITERAL =
  "Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/], Literal[value=/^(?:rgb|rgba|hsl|hsla)\\(/i]";
const COLOUR_NAME =
  "Property[key.name=/^(?:color|backgroundColor|borderColor|tintColor|shadowColor|textDecorationColor|borderTopColor|borderBottomColor|borderStartColor|borderEndColor)$/] > Literal[value=/^(?!transparent$)[a-z]+$/i]";
const PHYSICAL_SIDE =
  '/^(?:marginLeft|marginRight|paddingLeft|paddingRight|left|right|borderLeftWidth|borderRightWidth|borderLeftColor|borderRightColor|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius)$/';

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'dist/*',
      '.expo/*',
      'assets/*',
      'coverage/*',
      'playwright-report/*',
      'e2e/.results/*',
      'design-system/*',
      'scripts/*',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: { projectService: { allowDefaultProject: ['*.config.ts'] }, tsconfigRootDir: __dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: COLOUR_LITERAL, message: 'Colours come from design tokens only (src/design).' },
        { selector: COLOUR_NAME, message: 'Colours come from design tokens only (src/design).' },
        {
          selector: `CallExpression[callee.property.name='create'] Property[key.name=${PHYSICAL_SIDE}]`,
          message: 'Use logical properties (start/end) so layouts mirror in right-to-left languages.',
        },
        {
          selector: `JSXAttribute[name.name='style'] Property[key.name=${PHYSICAL_SIDE}]`,
          message: 'Use logical properties (start/end) so layouts mirror in right-to-left languages.',
        },
      ],
    },
  },
  {
    files: ['src/design/*.generated.ts', 'src/content/*.generated.ts', 'src/api/*.generated.ts'],
    rules: { 'no-restricted-syntax': 'off', 'import/no-unresolved': 'off' },
  },
  {
    files: ['src/api/**/*.ts', 'src/api/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@react-native-async-storage/async-storage',
              message: 'Tokens never touch AsyncStorage (brief §4.1). Use tokenStorage.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'Tokens never touch localStorage (brief §4.1).' },
        { name: 'sessionStorage', message: 'Tokens never touch sessionStorage (brief §4.1).' },
      ],
    },
  },
  {
    files: ['tests/**/*', 'e2e/**/*', '*.config.*', 'jest.setup.*'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // CommonJS config files run in Node.
    files: ['*.config.js', 'tests/components/*.js'],
    languageOptions: { globals: { __dirname: 'readonly', module: 'writable', require: 'readonly', process: 'readonly' } },
  },
]);
