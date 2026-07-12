// GITHUB_PAGES=true is set by the deploy workflow - the site then builds
// under the /ic2-reactor-planner base path for windingduke77.github.io
const basePath = process.env.GITHUB_PAGES === "true" ? "/ic2-reactor-planner" : "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
