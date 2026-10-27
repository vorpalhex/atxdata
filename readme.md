# ATX Data

Tools for monitoring Austin City Council activity.

## Programs

- [legistar-consume](programs/legistar-consume/README.md): Bun CLI for downloading public Austin Legistar meeting documents and recording metadata in SQLite.

Each program currently retains its own dependencies, configuration, and commands.

### legistar-consume

Run from the program directory:

```sh
cd programs/legistar-consume
bun install --frozen-lockfile
just verify
bun run src/cli.ts --help
```

See the program README for ingestion commands and environment variables. Default runtime output stays in `programs/legistar-consume/data/` (ignored by Git). No existing databases, downloaded documents, exports, or local environment files are included in this port.
