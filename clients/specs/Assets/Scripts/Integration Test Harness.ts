@component
export class IntegrationTestHarness extends BaseScriptComponent {
  @input autoRun: boolean = false;

  onAwake(): void {
    if (!global.deviceInfoSystem.isEditor()) this.autoRun = false;
  }
}

export function integrationTestsEnabled(host: SceneObject): boolean {
  if (!global.deviceInfoSystem.isEditor()) return false;
  const harness = host.getComponent(IntegrationTestHarness.getTypeName()) as IntegrationTestHarness | null;
  return harness?.autoRun === true;
}
