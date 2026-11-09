from collections import OrderedDict
from dataclasses import dataclass, field


@dataclass
class ManipulationSession:
    owner: str | None = None
    group_id: str | None = None
    token: str | None = None
    sequence: int = -1
    updated_at: float = 0.0
    target_key: tuple[float, ...] | None = None
    rejected_key: tuple[float, ...] | None = None
    generation: int = 0
    retired: OrderedDict[str, None] = field(default_factory=OrderedDict)
    cancelling: bool = False
    stopped: bool = False
    stop_confirmed: bool = True
    shutdown: bool = False
    quiesced: bool = False

    def retire_client(self, client_id: str) -> None:
        self.retired[client_id] = None
        self.retired.move_to_end(client_id)
        # The native authority fence rejects old queued envelopes independently.
        while len(self.retired) > 256:
            self.retired.popitem(last=False)

    def retire(self) -> None:
        self.generation += 1
        self.target_key = self.rejected_key = None
        self.token = None
        self.owner = None
        self.group_id = None
