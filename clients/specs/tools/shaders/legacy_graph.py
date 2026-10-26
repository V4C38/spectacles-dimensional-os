"""Lossless codec for Lens Studio 5.15's observed .ss_graph tree format.

Keep primitive types and bytes intact: UInt32 node metadata is not interchangeable
with Int32, even when values are positive. Native shader import checks those types.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import struct
from typing import Any

MAGIC = 0x000EE24E


@dataclass
class Leaf:
    type: int
    data: bytes
    children: int = 0

    def value(self) -> Any:
        if self.type == 2:
            return struct.unpack("<i", self.data)[0]
        if self.type == 3:
            return struct.unpack("<I", self.data)[0]
        if self.type == 4:
            return bool(self.data[0])
        if self.type == 5:
            return self.data.rstrip(b"\0").decode("utf-8")
        return self.data


def loads(raw: bytes) -> dict[str, Any]:
    position = 0

    def take(length: int) -> bytes:
        nonlocal position
        if length > len(raw) - position:
            raise ValueError("Truncated shader graph")
        value = raw[position:position + length]
        position += length
        return value

    def u32() -> int:
        return struct.unpack("<I", take(4))[0]

    def entries(count: int) -> dict[str, Any]:
        if count > (len(raw) - position) // 12:
            raise ValueError("Invalid shader graph entry count")
        result: dict[str, Any] = {}
        for _ in range(count):
            key = take(u32()).decode("utf-8")
            kind, length = u32(), u32()
            if kind == 0:
                value: Any = entries(length)
            else:
                value = Leaf(kind, take(length), u32())
                if value.children:
                    raise ValueError("Unexpected children on a primitive shader value")
            if key in result:
                raise ValueError(f"Duplicate graph entry: {key}")
            result[key] = value
        return result

    if u32() != MAGIC:
        raise ValueError("Expected a legacy Lens Studio 5.15 shader graph")
    tree = entries(u32())
    if position != len(raw):
        raise ValueError("Trailing shader graph data")
    return tree


def load(path: Path) -> dict[str, Any]:
    return loads(path.read_bytes())


def dumps(tree: dict[str, Any]) -> bytes:
    def u32(value: int) -> bytes:
        return struct.pack("<I", value)

    def entries(value: dict[str, Any]) -> bytes:
        output: list[bytes] = []
        for key, node in value.items():
            encoded = key.encode("utf-8")
            output.extend([u32(len(encoded)), encoded])
            if isinstance(node, dict):
                output.extend([u32(0), u32(len(node)), entries(node)])
            elif isinstance(node, Leaf):
                output.extend([u32(node.type), u32(len(node.data)), node.data, u32(node.children)])
            else:
                raise TypeError(f"Unsupported graph value: {type(node).__name__}")
        return b"".join(output)

    return u32(MAGIC) + u32(len(tree)) + entries(tree)


def save(path: Path, tree: dict[str, Any]) -> None:
    path.write_bytes(dumps(tree))


def string(value: str) -> Leaf:
    return Leaf(5, value.encode("utf-8") + b"\0")


def integer(value: int) -> Leaf:
    return Leaf(2, struct.pack("<i", value))


def unsigned(value: int) -> Leaf:
    return Leaf(3, struct.pack("<I", value))


def boolean(value: bool) -> Leaf:
    return Leaf(4, bytes([int(value)]))


def variable(data: bytes, kind: int) -> dict[str, Leaf]:
    return {"Data": Leaf(7, data), "Size": unsigned(len(data)), "Type": unsigned(kind)}


def text_variable(value: str) -> dict[str, Leaf]:
    return variable(value.encode("utf-8"), 3)


def float_variable(value: float) -> dict[str, Leaf]:
    return variable(struct.pack("<d", value), 0)


def port(name: str, dimensions: int, output: bool = False) -> dict[str, Any]:
    result: dict[str, Any] = {
        "ClassType1": string("FLOAT"), "ClassType2": string(""),
        "ID": string(name), "IOType": unsigned(1 if output else 0),
        "MetaData": string(""),
        "Property": {"Variables": {
            axis: float_variable(0) for axis in
            ("VariableX", "VariableY", "VariableZ", "VariableW")[:dimensions]
        }},
        "SubPropertyCount": unsigned(0), "Wireless": boolean(False),
    }
    if not output:
        result["ConnectionCount"] = unsigned(0)
    return result


def connect(target: dict[str, Any], level: int, output: str) -> None:
    target["Connection0"] = {"NodeLevelID": integer(level), "PortID": string(output)}
    target["ConnectionCount"] = unsigned(1)
