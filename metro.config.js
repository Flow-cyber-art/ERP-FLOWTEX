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
// wizard PDF export, and @supabase/functions-js) — Babel's CJS interop
// then wraps that ESM module as `{ default: ... }`, but tslib's ESM
// build doesn't shape itself that way, so `n.default` is undefined and
// `__extends` etc. crash at runtime ("Cannot destructure property
// '__extends' of 'n.default' as it is undefined").
//
// Force "tslib" to resolve via its legacy "main" field (tslib.js, CJS,
// exports helpers directly — matching what CJS-compiled code expects)
// instead of its "exports" map — narrowly, only for this one module,
// by delegating back into Metro's own resolver with package-exports
// resolution turned off for just this request. NOT a raw
// require.resolve("tslib/tslib.js"): under pnpm's isolated node_modules
// that resolves relative to metro.config.js's own location, can land on
// a *different* tslib copy than the one actually needed by the
// importing package, and some versions' "exports" map rejects that
// deep subpath outright (ERR_PACKAGE_PATH_NOT_EXPORTED) — Metro's
// resolver, unlike raw require.resolve, resolves consistently from the
// importing module's own context.
const defaultResolveRequest = wrapped.resolver.resolveRequest;
wrapped.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "tslib") {
    return context.resolveRequest({ ...context, unstable_enablePackageExports: false }, moduleName, platform);
  }
  if (defaultResolveRequest) return defaultResolveRequest(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = wrapped;
