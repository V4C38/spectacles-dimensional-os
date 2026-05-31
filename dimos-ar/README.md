# dimos-ar — Python AR bridge for DimOS

This folder is the **DimOS extension** inside the [`spectacles-unitree`](../) monorepo.

**Start here for the full project overview:** [../README.md](../README.md)

## Quick start

```bash
cd dimos-ar
./setup.sh
./start.sh              # Go2 discovery or replay; WebSocket :8765
./start.sh --replay     # replay only
```

Spectacles Lens: [`../lens-studio/`](../lens-studio/) — see [docs/LENS_DEVELOPMENT.md](docs/LENS_DEVELOPMENT.md).

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Package layout, threading, data flow |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | WebSocket message schema |
| [docs/LENS_DEVELOPMENT.md](docs/LENS_DEVELOPMENT.md) | Spectacles Lens Studio guide |
| [docs/MARKER_ASSETS.md](docs/MARKER_ASSETS.md) | AprilTag generation and Lens sync |
