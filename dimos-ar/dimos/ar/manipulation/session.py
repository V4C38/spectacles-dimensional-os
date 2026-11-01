from dataclasses import dataclass, field


@dataclass
class ManipulationSession:
    owner: str | None = None
    group_id: str | None = None
    token: str | None = None
    sequence: int = -1
    updated_at: float = 0.0
    evaluated_at: float = float("-inf")
    generation: int = 0
    retired: set[str] = field(default_factory=set)
    cancelling: bool = False
    stopped: bool = False
    stop_confirmed: bool = True
    shutdown: bool = False
    quiesced: bool = False

    def retire(self) -> None:
        self.generation += 1
        self.token = None
        self.owner = None
        self.group_id = None
