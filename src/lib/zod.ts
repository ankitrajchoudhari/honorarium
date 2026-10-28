import { z } from "zod";

// Zod's fast path compiles validators with `new Function`, which the Content-Security-Policy forbids in the browser.
z.config({ jitless: true });

export { z };
