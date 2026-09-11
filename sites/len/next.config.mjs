import createMDX from "@next/mdx";

const withMDX = createMDX({ extension: /\.mdx$/ });

/** @type {import('next').NextConfig} */
export default withMDX({
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  pageExtensions: ["ts", "tsx"],
  reactStrictMode: true,
});
