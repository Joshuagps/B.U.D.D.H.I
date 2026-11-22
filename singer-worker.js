/* Background worker for B.U.D.D.H.I.'s singer: eSpeak (meSpeak, GPL) + pitch correction (singer-core.js). */
importScripts("singer/mespeak.min.js", "singer-core.js");
let singer = null, loaded = {};
async function json(path) { const r = await fetch(path); if (!r.ok) throw new Error("couldn't load " + path); return r.json(); }
async function setup(lang) {
  if (!singer) { self.meSpeak.loadConfig(await json("singer/mespeak_config.json")); singer = self.BuddhiSingerCore.makeSinger(self.meSpeak); }
  const v = ["fr", "es", "it", "pt", "de"].includes(lang) ? lang : "en";
  if (!loaded[v]) { const data = await json("singer/" + v + ".json"); self.meSpeak.loadVoice(data); loaded[v] = data.voice_id; }
  return loaded[v];
}
self.onmessage = async e => {
  const { id, events, lang, variant } = e.data;
  try {
    const voice = await setup(lang);
    const track = singer.renderTrack(events, { voice, variant });
    self.postMessage({ id, track, rate: singer.FS }, [track.buffer]);
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
