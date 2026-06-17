// CJS shim for text-encoding-utf-8.
// borsh (CJS) does `require("text-encoding-utf-8")` but the real package
// is ESM-only, which workerd cannot resolve from CJS.
// In Workers, TextDecoder/TextEncoder are globally available, so the
// polyfill is never actually used — we just need the require() to succeed.
module.exports = {
  TextDecoder: globalThis.TextDecoder,
  TextEncoder: globalThis.TextEncoder,
};
