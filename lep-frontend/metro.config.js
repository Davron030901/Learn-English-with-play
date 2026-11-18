// Learn English with Play — Metro configuration.
// Course content ships as data assets with the `.lep` extension (JSON inside), so Metro copies
// them next to the bundle instead of inlining 16 MB of JSON into the JavaScript bundle
// (brief §15: "content is data, never bundled").
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('lep');

// Tree shaking (Expo SDK 52+, production bundles, still experimental): unused exports are
// dropped, so a library imported for a few functions does not ship whole — zod's 45 locales,
// unused animations (brief §15: the JS bundle stays under 4 MB). Only where
// EXPO_UNSTABLE_TREE_SHAKING is set, which `npm run export:web` does (DECISIONS §28): development
// and native builds keep Metro's usual import handling.
if (process.env.EXPO_UNSTABLE_TREE_SHAKING === '1') {
  config.transformer.getTransformOptions = async () => ({
    transform: { experimentalImportSupport: true },
  });
}

module.exports = config;
