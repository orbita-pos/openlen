import createMDX from "@next/mdx";

const withMDX = createMDX({ extension: /\.mdx$/ });

/** @type {import('next').NextConfig} */
export default withMDX({
  // Hay dos package-lock.json por encima (éste y el de la app) y Next no sabe
  // cuál es la raíz. La raíz es ésta.
  outputFileTracingRoot: import.meta.dirname,
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  pageExtensions: ["ts", "tsx"],
  reactStrictMode: true,
});
