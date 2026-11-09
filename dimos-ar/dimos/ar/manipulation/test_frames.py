import numpy as np
import pytest
from scipy.spatial.transform import Rotation

from dimos.ar.manipulation.frames import ReferencePose


def test_rotated_translated_reference_preserves_complete_tool_pose():
    frame = ReferencePose(
        position=(1, -2, 0.7),
        orientation=tuple(Rotation.from_euler("xyz", [0.1, -0.2, 1.3]).as_quat()),
    )
    position = [0.2, 0.1, 0.4]
    orientation = Rotation.from_euler("xyz", [0.7, 0.1, -0.5]).as_quat().tolist()
    p, q = frame.transform(position, orientation)
    restored_p, restored_q = frame.transform(p, q, inverse=True)
    np.testing.assert_allclose(restored_p, position, atol=1e-12)
    np.testing.assert_allclose(
        Rotation.from_quat(restored_q).as_matrix(),
        Rotation.from_quat(orientation).as_matrix(),
        atol=1e-12,
    )


@pytest.mark.parametrize(
    "data", [{"position": [float("nan"), 0, 0]}, {"orientation": [0, 0, 0, 0]}]
)
def test_reference_rejects_invalid_configuration(data):
    with pytest.raises(ValueError):
        ReferencePose(**data)
