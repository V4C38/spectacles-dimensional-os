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
export async function profilesForRobot(request, robot, editable) {
  const load = async () => {
    const response = await request("/api/robot-profiles");
    if (!response.ok) throw new Error("Could not load robot profiles");
    return (await response.json()).profiles.filter(profile => profile.robot === robot);
  };
  let profiles = await load();
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
