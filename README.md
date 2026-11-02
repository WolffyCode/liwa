# Liwa

English | [中文](README.zh.md)

Liwa (灵鲸, command `liwa`) is a self-hosted digital life. Its code base is a fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT, commit `f3803c96`, 0.2.2-alpha.2), maintained independently and no longer synced with upstream.

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512). Liwa uses DeepSeek models through the DeepSeek API.

## Developer preview

Liwa is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from source

Liwa is not published to npm. To run from a repository checkout:

```sh
git clone https://github.com/WolffyCode/liwa.git
cd liwa
pnpm install
pnpm run build
pnpm liwa web
```

`pnpm run build` prepares the repository artifacts. `pnpm liwa web` uses those built artifacts without rebuilding. The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

Liwa keeps its data under `~/.liwa`; set `LIWA_HOME` to use another directory.

The desktop application is packaged locally on an Apple Silicon Mac only: `pnpm run package:desktop` produces `Liwa.app` without a release certificate, notarization, or automatic updates. See [Desktop packaging](apps/desktop/packaging/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE). The upstream DeepSeek Harness copyright notice is retained there.

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
