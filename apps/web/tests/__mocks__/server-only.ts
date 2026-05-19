// no-op mock for vitest: server-only is a Next.js guard that throws in non-server envs.
// In integration tests running under Node/vitest, we skip the guard.
export default {};
