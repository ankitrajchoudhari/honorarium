// Serves the Lottie player's WebAssembly engine from this app instead of a CDN (the CSP allows only same-origin
// connections). Runs after every install, so the copy always matches the installed @lottiefiles/dotlottie-web version.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const source = join(dirname(require.resolve("@lottiefiles/dotlottie-web")), "dotlottie-player.wasm");
mkdirSync("public/animations", { recursive: true });
copyFileSync(source, "public/animations/dotlottie-player.wasm");
