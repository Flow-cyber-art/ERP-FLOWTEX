const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

const wrapped = withNativeWind(config, {
  input: "./global.css",
  // NOTE: forceWriteFileSystem was previously "true" to fix iOS dev styling,
  // but it makes Nativewind write a cache file mid-bundle that races with
  // Metro's own file watcher and crashes static/web exports (e.g. on Vercel)
  // with "Failed to get the SHA-1 for ... web.css". Disabled for web builds.
  forceWriteFileSystem: false,
});

// tslib's package.json "exports" field is conditional (module/import/
// require) and Metro's package-exports resolution picks the ESM build
// for some CJS-compiled consumers (e.g. pdf-lib, used by the oferta
// wizard PDF export) — Babel's CJS interop then wraps that ESM module
// as `{ default: ... }`, but tslib's ESM build doesn't shape itself
// that way, so `n.default` is undefined and `__extends` etc. crash at
// runtime ("Cannot destructure property '__extends' of 'n.default' as
// it is undefined"). Force "tslib" to resolve to its plain CJS file
// (which exports helpers directly, matching what CJS-compiled code
// expects) — narrowly, so package-exports resolution for every other
// dependency is untouched.
const defaultResolveRequest = wrapped.resolver.resolveRequest;
wrapped.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "tslib") {
    return { type: "sourceFile", filePath: require.resolve("tslib/tslib.js") };
  }
  if (defaultResolveRequest) return defaultResolveRequest(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = wrapped;
