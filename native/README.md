# native/

English | [中文](README.zh.md)

Native source and local packages maintained with Liwa. The [`system/` workspace](system/README.md) owns the Landlock launcher and POSIX flock binding, their platform packages, and the [version procedure](system/docs/release.md).

## Workspace and packaging boundary

`system/` and its packages belong to the repository's root pnpm workspace and lockfile. Liwa consumers use the current workspace entry package during development and CI, so a launcher contract change and its consumer update can land and be tested together.

The main repository's `Node Addon System` workflow builds and tests each supported architecture. These packages are not published to npm: Desktop packaging builds the `darwin-arm64` binary locally and packs the entry and that platform package from this workspace. The entry package keeps platform packages as optional dependencies, so an install selects only the package matching the operating system and CPU.
