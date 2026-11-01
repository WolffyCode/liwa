// Preserve Node's exit before Vitest installs its test-level process.exit guard.
globalThis.__liwaCoverageFixtureExit = process.exit.bind(process)
