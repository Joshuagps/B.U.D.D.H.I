/* Background worker for B.U.D.D.H.I.'s singer: eSpeak (meSpeak, GPL) + pitch correction (singer-core.js).
   eSpeak breaks after about 80 words in one instance, so a fresh engine is started every 60 words. */
importScripts("singer/mespeak.min.js", "singer-core.js");
let singer = null, config = null, voices = {}, current = 0, uses = 0, voiceIds = {};
async function json(path) { const r = await fetch(path); if (!r.ok) throw new Error("couldn't load " + path); return r.json(); }
function freshEngine() {
  importScripts("singer/mespeak.min.js"); // re-running the script makes a brand-new engine
  self.meSpeak.loadConfig(config);
  for (const v of Object.values(voices)) self.meSpeak.loadVoice(v);
  uses = 0;
}
function engine(restart) { if (restart || uses >= 60) freshEngine(); uses++; return self.meSpeak; }
const loading = {};
function setup(lang) {
  const v = ["fr", "es", "it", "pt", "de"].includes(lang) ? lang : "en";
  // one shared loading step, so a warm-up and a song arriving together don't load the engine twice
  return loading[v] || (loading[v] = (async () => {
    if (!loading.config) loading.config = json("singer/mespeak_config.json").then(c => { config = c; self.meSpeak.loadConfig(c); });
    await loading.config;
    if (!voices[v]) { const data = await json("singer/" + v + ".json"); voices[v] = data; self.meSpeak.loadVoice(data); voiceIds[v] = data.voice_id; }
    if (!singer) singer = self.BuddhiSingerCore.makeSinger(engine);
    return voiceIds[v];
  })().catch(err => { delete loading[v]; throw err; }));
}
self.onmessage = async e => {
  const { id, events, lang, variant, warm } = e.data;
  try {
    const voice = await setup(lang);
    if (warm) { singer._word("hello", { voice, variant: variant || "singf" }); self.postMessage({ id, warm: true }); return; }
    current = id;
    singer.renderChunks(events, { voice, variant }, (chunk, t0) => { if (current === id) self.postMessage({ id, chunk, t0, rate: singer.FS }, [chunk.buffer]); });
    self.postMessage({ id, done: true, rate: singer.FS });
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
