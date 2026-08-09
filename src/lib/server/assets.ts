/**
 * The byte-sensitive markdown assets, inlined at build time via Vite `?raw`
 * imports. `docs/CONTRACT.md` ships verbatim in the bootstrap prompt (§7) and
 * every export; the templates are the two outbound documents (§7, §11). A `?raw`
 * import is the file content untouched — the same bytes the golden test asserts
 * on — and bundling them means the container image cannot lose them.
 */

import contractMd from "../../../docs/CONTRACT.md?raw";
import bootstrapPromptTemplate from "../../../templates/bootstrap-prompt.md?raw";
import defaultInstructionsTemplate from "../../../templates/default-ai-instructions.md?raw";

export { contractMd, bootstrapPromptTemplate, defaultInstructionsTemplate };
