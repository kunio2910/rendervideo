import { access, cp, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

await cp(root("pages-dist/index.html"), root("index.html"), { force: true });
await cp(root("pages-dist/assets"), root("assets"), {
  recursive: true,
  force: true,
});
await cp(root("public/favicon.svg"), root("favicon.svg"), { force: true });
await writeFile(root(".nojekyll"), "", "utf8");

const html = await readFile(root("index.html"), "utf8");
if (
  !html.includes("Kito Video Studio") ||
  !html.includes("/rendervideo/assets/")
) {
  throw new Error("GitHub Pages export is incomplete");
}

const assetUrls = [
  html.match(/<script[^>]+src="(\/rendervideo\/assets\/[^\"]+\.js)"/)?.[1],
  html.match(/<link[^>]+href="(\/rendervideo\/assets\/[^\"]+\.css)"/)?.[1],
].filter(Boolean);

await Promise.all(assetUrls.map((assetUrl) => access(root(assetUrl.replace(/^\/rendervideo\//, "")))));

console.log("GitHub Pages SPA export ready");
