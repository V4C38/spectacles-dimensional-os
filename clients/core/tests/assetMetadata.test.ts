import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { checkMetadataRoots, metadataDefinitions, metadataIdentityConflicts } from "../../../tools/architecture/metadata.mjs";

const ids = {
  metadata: "11111111-1111-4111-8111-111111111111",
  primary: "22222222-2222-4222-8222-222222222222",
  data: "33333333-3333-4333-8333-333333333333",
  component: "44444444-4444-4444-8444-444444444444",
};
function scriptMetadata(identity = ids): string {
  return `- !<AssetImportMetadata/${identity.metadata}>
  ImportedAssetIds:
    TypeScriptAsset: !<reference> ${identity.primary}
  PrimaryAsset: !<reference> ${identity.primary}
  AssetDataMap:
    TypeScriptAsset: !<own> ${identity.data}
- !<TypeScriptAssetData/${identity.data}>
  ComponentUid: ${identity.component}
  ExportUid: 00000000-0000-0000-0000-000000000000
  ReadMe: !<reference> 00000000-0000-0000-0000-000000000000
`;
}

it("keeps every defining identity unique across authored Core and Specs host metadata", () => {
  expect(checkMetadataRoots([
    fileURLToPath(new URL("../src/", import.meta.url)),
    fileURLToPath(new URL("../../specs/Assets/Scripts/DimOSSpecsClient/", import.meta.url)),
  ])).toEqual([]);
});

it.each(Object.keys(ids) as (keyof typeof ids)[])("detects copied %s identities even when all other IDs change", kind => {
  const different = Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, value.replaceAll("1", "a").replaceAll("2", "b").replaceAll("3", "c").replaceAll("4", "d")])) as typeof ids;
  const copied = { ...different, [kind]: ids[kind] };
  const conflicts = metadataIdentityConflicts([
    { path: "original.ts.meta", source: scriptMetadata() },
    { path: "copied.ts.meta", source: scriptMetadata(copied) },
  ]);
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0]).toContain(ids[kind]);
  expect(conflicts[0]).toContain("original.ts.meta");
  expect(conflicts[0]).toContain("copied.ts.meta");
});

it("ignores reference aliases and null sentinels while recognizing arbitrary AssetData definitions", () => {
  expect(metadataDefinitions(scriptMetadata())).toHaveLength(4);
  expect(metadataDefinitions(`- !<MaterialAssetData/${ids.data}>\n  ComponentUid: 00000000-0000-0000-0000-000000000000`))
    .toEqual([{ kind: "MaterialAssetData", id: ids.data, line: 1 }]);
  const conflicts = metadataIdentityConflicts([
    { path: "script.ts.meta", source: scriptMetadata() },
    { path: "other.meta", source: `- !<DifferentAssetData/${ids.component.toUpperCase()}>` },
  ]);
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0]).toContain("ComponentUid");
});
