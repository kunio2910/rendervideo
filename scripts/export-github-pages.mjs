import { cp, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repositoryBase = "/rendervideo";
const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("github-pages-export", `${Date.now()}`);

const { default: worker } = await import(workerUrl.href);
const response = await worker.fetch(
  new Request("http://localhost/", {
    headers: { accept: "text/html" },
  }),
  {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  },
  {
    waitUntil() {},
    passThroughOnException() {},
  },
);

if (!response.ok) {
  throw new Error(`Static export failed with status ${response.status}`);
}

const source = await response.text();
const html = source
  .replaceAll('href="/assets/', `href="${repositoryBase}/assets/`)
  .replaceAll('src="/assets/', `src="${repositoryBase}/assets/`)
  .replaceAll('href="/favicon.svg"', `href="${repositoryBase}/favicon.svg"`)
  .replaceAll('src="/favicon.svg"', `src="${repositoryBase}/favicon.svg"`)
  .replace(
    "</head>",
    '<meta name="github-pages-base" content="/rendervideo"></head>',
  );

await cp(
  fileURLToPath(new URL("../dist/client/assets/", import.meta.url)),
  fileURLToPath(new URL("../assets/", import.meta.url)),
  { recursive: true, force: true },
);
await cp(
  fileURLToPath(new URL("../public/favicon.svg", import.meta.url)),
  fileURLToPath(new URL("../favicon.svg", import.meta.url)),
  { force: true },
);
await writeFile(
  fileURLToPath(new URL("../index.html", import.meta.url)),
  html,
  "utf8",
);
await writeFile(
  fileURLToPath(new URL("../.nojekyll", import.meta.url)),
  "",
  "utf8",
);

const exportedHtml = await readFile(
  fileURLToPath(new URL("../index.html", import.meta.url)),
  "utf8",
);
if (!exportedHtml.includes("Kito Video Studio")) {
  throw new Error("Exported page is missing the product title");
}

console.log("GitHub Pages export ready at /index.html");
