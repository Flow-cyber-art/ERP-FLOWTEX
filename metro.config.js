const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, {
  input: "./global.css",
  // NOTE: forceWriteFileSystem was previously "true" to fix iOS dev styling,
  // but it makes Nativewind write a cache file mid-bundle that races with
  // Metro's own file watcher and crashes static/web exports (e.g. on Vercel)
  // with "Failed to get the SHA-1 for ... web.css". Disabled for web builds.
  forceWriteFileSystem: false,
});
