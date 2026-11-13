/** Browser-side observation helpers. Targets remain real scene objects driven through XR input. */
export function installMenuQueries(): void {
  const geometry = new WeakMap<object, string>();
  const visible = (object: any): boolean => {
    for (let node = object; node; node = node.parent) {
      if (!node.visible || node.userData.rayDisabled === true) return false;
    }
    return true;
  };
  const queries = {
    button(menu: any, label: string): any {
      let result: any;
      menu.panel.traverse((object: any) => {
        if (object.ux && object.enabled !== false && (object.name === label || object.text === label) && visible(object)) result = object;
      });
      if (!result) throw new Error(`Missing visible menu button: ${label}`);
      return result;
    },
    response(menu: any, text: string): any {
      let result: any;
      menu.panel.traverse((object: any) => {
        const view = menu.scrollView(object);
        if (text && view?.text === text && visible(object)) result = view;
      });
      return result;
    },
    settled(menu: any): boolean {
      const plate = menu.panel.getObjectByName("Menu background");
      if (!plate || !visible(menu.panel) || plate.material.uniforms.uOpacity.value < 0.999) return false;
      if (![...menu.pageTransitions.values()].every((state: any) => state.progress === (state.target ? 1 : 0))) return false;
      const signature = JSON.stringify([plate.material.uniforms.uSize.value.toArray(), menu.panel.scale.toArray()]);
      const previous = geometry.get(menu);
      geometry.set(menu, signature);
      return previous === signature;
    },
  };
  (window as any).integrationMenuQueries = queries;
}
