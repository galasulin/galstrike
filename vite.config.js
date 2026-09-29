// GH_PAGES=1 builds for https://galasulin.github.io/galstrike/ (assets are resolved through import.meta.env.BASE_URL)
export default { base: process.env.GH_PAGES ? '/galstrike/' : '/', build: { target: 'esnext', chunkSizeWarningLimit: 2500 } };
