import { ScopedRequests } from "./source-selection.mjs";

/** Each write retains its original profile and values until its response completes. */
export function settingsWriter({ request, saved, failed }) {
  let tail = Promise.resolve(null);
  return {
    save(values) {
      const snapshot = JSON.parse(JSON.stringify(values));
      tail = tail.catch(() => null).then(async () => {
        try {
          const response = await request(snapshot);
          const data = await response.json();
          if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : response.statusText);
          saved(snapshot.profile_id, data);
          return data;
        } catch (error) {
          failed(error);
          return null;
        }
      });
      return tail;
    },
    flush: () => tail,
  };
}

/** A missing profile may be created once; failed persistence must not cause polling. */
export async function profilesForRobot(request, robot, editable, current = () => true) {
  const load = async () => {
    const response = await request("/api/robot-profiles");
    if (!response.ok) throw new Error("Could not load robot profiles");
    return (await response.json()).profiles.filter(profile => profile.robot === robot);
  };
  let profiles = await load();
  if (!current()) return [];
  if (!profiles.length && editable) {
    const response = await request("/api/robot-profiles", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ robot }),
    });
    if (!response.ok) throw new Error("Could not create robot profile");
    profiles = await load();
    if (!profiles.length) throw new Error("Created robot profile was not returned");
  }
  return profiles;
}

/** Own profile identity and persistence timing; rendering supplies the current form draft. */
export class ProfileSettingsEditor {
  constructor(writer, timers = globalThis) {
    this.requests = new ScopedRequests();
    this.writer = writer;
    this.timers = timers;
    this.robotProfileId = null;
    this.robotProfiles = [];
    this.mounts = [];
    this.settingsReady = false;
    this.persistTimer = null;
  }

  setProfiles(profiles, preferredId, remembered) {
    this.robotProfiles = profiles;
    this.robotProfileId = profiles.find(profile => profile.id === preferredId)?.id
      ?? profiles.find(profile => profile.id === remembered)?.id
      ?? profiles[0]?.id ?? null;
  }

  schedule(readValues) {
    this.cancelScheduled();
    this.persistTimer = this.timers.setTimeout(() => {
      this.persistTimer = null;
      void this.save(readValues());
    }, 400);
  }

  cancelScheduled() {
    this.timers.clearTimeout(this.persistTimer);
    this.persistTimer = null;
  }

  save(values) {
    this.cancelScheduled();
    if (!this.settingsReady || !this.robotProfileId) return Promise.resolve(null);
    return this.writer.save(values);
  }

  saved(profileId, data) {
    const profile = this.robotProfiles.find(item => item.id === profileId);
    if (profile) profile.settings = { ...profile.settings, ...data };
  }
}

/** Preferences are serialized separately from calibration saves and never overwrite edits on load. */
export class LauncherPreferences {
  constructor() {
    this.requests = new ScopedRequests();
    this.values = { go2_source: "auto", openyam_source: "auto", replay: "", openyam_replay: "", openyam_playback: "simulator" };
    this.replayStreams = {};
    this.playbackRobot = null;
    this.edited = false;
    this.tail = Promise.resolve();
  }

  hydrate(preferences) {
    if (this.edited) return false;
    for (const key of Object.keys(this.values)) {
      if (typeof preferences[key] === "string") this.values[key] = key.endsWith("_source") && preferences[key] === "simulated" ? "auto" : preferences[key];
    }
    this.replayStreams = structuredClone(preferences.replay_streams || {});
    this.playbackRobot = null;
    return true;
  }

  save(request, manualIp) {
    this.edited = true;
    const body = JSON.stringify({ ...this.values, replay_streams: this.replayStreams, manual_ip: manualIp });
    this.tail = this.tail.catch(() => {}).then(async () => {
      const response = await request(body);
      if (!response.ok) throw new Error("Could not save launcher preferences");
    });
    return this.tail;
  }
}
