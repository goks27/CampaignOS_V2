/**
 * Live view of the job that is running, for the dashboard on THIS PC.
 *
 * Everything is held in memory: a short list of steps and ONE latest picture of the test browser (a small JPEG). Nothing is
 * written to disk or to Supabase, and it is cleared when the job ends. The connector serves it on GET /live and
 * GET /live/frame (127.0.0.1 only, dashboard origins only). View only: there is no way to send input to the browser.
 *
 * While a login is being filled in, the picture is paused and cleared so typed values never appear on screen.
 */
export function createLive({ now = () => Date.now(), maxSteps = 40 } = {}) {
  let s = null;
  let frame = null;

  return {
    start({ jobId, type }) { s = { jobId, type, startedAt: now(), steps: [], where: null, paused: false, seq: 0, frameAt: null }; frame = null; },
    /** What the connector is doing now, in plain words. The same step twice in a row is shown once. */
    step(text) {
      if (!s) return;
      const t = String(text).slice(0, 160);
      if (s.steps.at(-1)?.text === t) return;
      s.steps.push({ at: now(), text: t });
      if (s.steps.length > maxSteps) s.steps.splice(0, s.steps.length - maxSteps);
    },
    /** Which page and device the browser is on, and how far through the pages it is. */
    where(w) { if (s) s.where = { ...(s.where ?? {}), ...w }; },
    setFrame(buf) { if (!s || s.paused || !buf?.length) return; frame = buf; s.seq++; s.frameAt = now(); },
    pause(on) { if (!s) return; s.paused = Boolean(on); if (on) frame = null; },
    end() { s = null; frame = null; },
    state() { return s ? { active: true, ...s, hasFrame: Boolean(frame) } : { active: false }; },
    frame() { return frame; },
  };
}

/** The one the connector and the browser share. */
export const live = createLive();
