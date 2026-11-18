// Component tests (React Native Testing Library) run under jest-expo (DECISIONS §6.2).
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/tests/components/**/*.test.tsx'],
  setupFiles: ['<rootDir>/tests/components/jest.setup.ts'],
  // the first test in a file pays for loading the app's modules: seconds on a cold Windows run
  testTimeout: 20_000,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.lep$': '<rootDir>/tests/components/assetStub.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|i18next|react-i18next|i18next-icu|intl-messageformat|@formatjs/.*|zustand|@tanstack/.*)',
  ],
};
