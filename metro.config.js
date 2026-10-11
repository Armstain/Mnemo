const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

const config = getDefaultConfig(__dirname);

// expo-sqlite's web worker imports wa-sqlite.wasm; Metro won't resolve it
// unless .wasm is an asset extension.
config.resolver.assetExts.push("wasm");

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
});
