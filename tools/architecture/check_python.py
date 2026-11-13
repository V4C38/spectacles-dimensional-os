"""Static Python dependency checks; parsing never imports application or hardware code."""
from __future__ import annotations

import ast
from pathlib import Path


def dependencies(source: str, module: str, package: bool = False) -> list[tuple[str, bool]]:
    result: list[tuple[str, bool]] = []

    def visit(node: ast.AST, runtime: bool = True) -> None:
        # Local imports execute after module initialization and do not form import-time cycles.
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            for child in ast.iter_child_nodes(node):
                visit(child, False)
            return
        if isinstance(node, ast.If):
            checking = (isinstance(node.test, ast.Name) and node.test.id == "TYPE_CHECKING"
                        or isinstance(node.test, ast.Attribute) and node.test.attr == "TYPE_CHECKING")
            for child in node.body:
                visit(child, runtime and not checking)
            for child in node.orelse:
                visit(child, runtime)
            return
        if isinstance(node, ast.Import):
            result.extend((item.name, runtime) for item in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = module.split(".") if package else module.split(".")[:-1]
            if node.level:
                base = base[:len(base) - node.level + 1]
                target = ".".join([*base, *([node.module] if node.module else [])])
            else:
                target = node.module or ""
            result.append((target, runtime))
            result.extend((target + "." + item.name, runtime) for item in node.names if item.name != "*")
        elif isinstance(node, ast.Call) and node.args and isinstance(node.args[0], ast.Constant):
            dynamic = (isinstance(node.func, ast.Name) and node.func.id == "__import__"
                       or isinstance(node.func, ast.Attribute) and node.func.attr == "import_module")
            if dynamic and isinstance(node.args[0].value, str):
                result.append((node.args[0].value, runtime))
        for child in ast.iter_child_nodes(node):
            visit(child, runtime)

    visit(ast.parse(source))
    return result


def runtime_cycles(graph: dict[str, set[str]]) -> list[list[str]]:
    active: list[str] = []
    done: set[str] = set()
    cycles: list[list[str]] = []

    def visit(node: str) -> None:
        if node in active:
            cycles.append([*active[active.index(node):], node])
            return
        if node in done:
            return
        active.append(node)
        for target in sorted(graph.get(node, set())):
            visit(target)
        active.pop()
        done.add(node)

    for node in sorted(graph):
        visit(node)
    return cycles


def check_project(root: Path, prefix: str = "") -> list[str]:
    files: dict[str, Path] = {}
    for path in root.rglob("*.py"):
        parts = path.relative_to(root).parts
        if any(part in {"tests", "test_support", "__pycache__", "node_modules"} or part.startswith(".") for part in parts):
            continue
        if path.name.startswith("test_") or path.name == "conftest.py":
            continue
        suffix = list(path.relative_to(root).with_suffix("").parts)
        if suffix[-1] == "__init__":
            suffix.pop()
        files[".".join([*([prefix] if prefix else []), *suffix])] = path
    graph: dict[str, set[str]] = {name: set() for name in files}
    failures = []
    for name, path in files.items():
        for target, runtime in dependencies(path.read_text(), name, path.name == "__init__.py"):
            parts = target.split(".")
            if any(part in {"tests", "test_support"} or part.startswith("test_") for part in parts):
                failures.append(f"{path.relative_to(root)} imports test code: {target}")
            if prefix == "dimos.ar" and parts[0] in {"launcher", "clients"}:
                failures.append(f"{path.relative_to(root)} imports a host: {target}")
            if (prefix == "dimos.ar" and target == "dimos.ar.module"
                    and name not in {target, "dimos.ar.blueprints", "dimos.ar.manipulation.blueprints", "dimos.ar.replay"}):
                failures.append(f"{path.relative_to(root)} imports the composition root")
            if prefix == "dimos.ar" and target.startswith(prefix + "."):
                domain = name.removeprefix(prefix + ".").split(".")[0]
                target_domain = target.removeprefix(prefix + ".").split(".")[0]
                excluded = {
                    "localization": {"navigation", "manipulation", "replication"},
                    "navigation": {"localization", "manipulation", "replication"},
                    "manipulation": {"localization", "navigation"},
                }
                if target_domain in excluded.get(domain, set()):
                    failures.append(f"{path.relative_to(root)} imports unrelated {target_domain}: {target}")
                if domain in {"numeric", "async_execution", "timing_diagnostics"}:
                    failures.append(f"{path.relative_to(root)} imports a feature: {target}")
            if runtime and target in files and target != name:
                graph[name].add(target)
    failures.extend("runtime dependency cycle: " + " → ".join(cycle) for cycle in runtime_cycles(graph))
    return sorted(set(failures))
