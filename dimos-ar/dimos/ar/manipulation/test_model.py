import pytest

from dimos.ar.manipulation.model import describe_model

XML = """<robot name="arm"><link name="base"/><link name="finger"/>
<joint name="finger_slide" type="prismatic"><parent link="base"/><child link="finger"/>
<limit lower="-0.05" upper="0"/></joint></robot>"""


def test_gripper_articulation_and_profile_do_not_depend_on_asset_location():
    original = describe_model(
        XML, "/models/arm.glb", visual_profile="openyam", gripper_open_at_lower=["finger_slide"]
    )
    moved = describe_model(
        XML, "/cdn/renamed.glb", visual_profile="openyam", gripper_open_at_lower=["finger_slide"]
    )
    assert original["visual_signature"] == moved["visual_signature"]
    assert (
        original["gripper_joints"]
        == moved["gripper_joints"]
        == {"finger_slide": {"closed": 0.0, "open": -0.05}}
    )
    assert original["visual_profile"] == moved["visual_profile"] == "openyam"


def test_gripper_mapping_requires_a_real_bounded_independent_joint():
    with pytest.raises(ValueError, match="articulation"):
        describe_model(XML, gripper_open_at_lower=["missing"])
