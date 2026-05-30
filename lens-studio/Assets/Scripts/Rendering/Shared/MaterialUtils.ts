export function cloneMaterialWithColor(
  source: Material,
  color: vec4,
): Material {
  const material = source.clone();
  const pass = material.mainPass as any;
  pass.baseColor = color;
  pass.Port_Emissive_N006 = new vec3(color.x, color.y, color.z);
  return material;
}
