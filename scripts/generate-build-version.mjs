// Stempluje bieżący build wersją (timestamp), zapisując ją w DWÓCH
// miejscach, które muszą się rozjechać między starym a nowym buildem:
//
// 1. public/version.json — kopiowany 1:1 do dist/ przez `expo export`,
//    serwowany jako zwykły statyczny plik. Klient odpytuje go z
//    `cache: "no-store"`, więc zawsze dostaje wersję z aktualnie
//    wdrożonego builda na serwerze (nawet jeśli service worker
//    cache'uje resztę assetów).
//
// 2. constants/build-version.ts — importowany przez kod aplikacji,
//    więc jego wartość jest "wypieczona" (bundled) w JS-ie danego
//    builda. Stara, zbuforowana wersja apki zawsze będzie miała starą
//    wartość, nawet po redeployu serwera — to jest punkt odniesienia
//    do porównania z (1).
//
// Uruchamiane automatycznie przed `expo export -p web` (patrz
// package.json → "build:web").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// ISO timestamp buildu — czytelne w logach, unikalne przy każdym buildzie.
const buildVersion = new Date().toISOString();

const publicDir = path.join(rootDir, "public");
fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(
  path.join(publicDir, "version.json"),
  JSON.stringify({ version: buildVersion }, null, 2) + "\n",
);

const constantsDir = path.join(rootDir, "constants");
fs.mkdirSync(constantsDir, { recursive: true });
fs.writeFileSync(
  path.join(constantsDir, "build-version.ts"),
  `// Plik generowany automatycznie przez scripts/generate-build-version.mjs\n` +
    `// przed każdym \`expo export -p web\`. Nie edytować ręcznie — zmiany\n` +
    `// zostaną nadpisane przy następnym buildzie.\n` +
    `export const BUILD_VERSION = ${JSON.stringify(buildVersion)};\n`,
);

console.log(`[generate-build-version] BUILD_VERSION = ${buildVersion}`);
