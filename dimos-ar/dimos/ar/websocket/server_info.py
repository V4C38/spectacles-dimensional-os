"""Display metadata from the running environment; never infer it from a client address."""

from importlib.metadata import PackageNotFoundError, version

from dimos.core.global_config import global_config


def server_info() -> dict[str, str]:
    info: dict[str, str] = {}
    for package, key in (("dimos", "dimos_version"), ("dimos-ar", "armodule_version")):
        try:
            info[key] = version(package)
        except PackageNotFoundError:
            pass
    if global_config.replay or global_config.simulation:
        info["robot_ip"] = "Simulated"
    elif global_config.robot_ip:
        info["robot_ip"] = str(global_config.robot_ip)
    return info
