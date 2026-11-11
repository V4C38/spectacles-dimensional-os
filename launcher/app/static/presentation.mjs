/** Presentation is derived from service facts and current user selections. */
export function launcherPresentation({ status, manipulation, simulated, can, planner, settingUp }) {
  const phase = status.phase || "idle";
  const locked = ["starting", "running", "stopping"].includes(phase);
  const busy = ["checking", "installing", "starting", "stopping"].includes(phase);
  const canRequired = manipulation && !simulated && can.state !== "not_required";
  const hardwareMissing = manipulation && (!planner.ready || (canRequired && !can.ready));
  const dependenciesReady = status.check_ok === true;
  return {
    locked, busy, canRequired, hardwareMissing,
    startDisabled: locked || busy || !dependenciesReady || settingUp || hardwareMissing,
    installDisabled: locked || busy || settingUp,
    dependencyText: phase === "installing" ? "installing…" : phase === "checking" ? "checking…" : dependenciesReady && !hardwareMissing ? "" : "incomplete",
    dependencyPhase: phase === "installing" || phase === "checking" ? phase : dependenciesReady && !hardwareMissing ? "" : "needs_setup",
    setupReady: dependenciesReady && (!manipulation || planner.ready),
    stopLabel: phase === "stopping" ? "Force stop" : "Stop",
    stopDanger: locked,
  };
}
