import * as React from "react";
import { browserService, type BrowserCommand, type BrowserConsole, type BrowserEvent, type BrowserInput, type BrowserOpenRequest, type BrowserRequest, type BrowserState } from "@/services/connector";

export type Browser = ReturnType<typeof useBrowserSession>;
const FRAME_PREFIX = "data:image/jpeg;base64,";

/**
 * One interactive preview: opens it, listens to its stream (pictures, state, events), polls the console and network lists, and sends
 * commands and input. `connection` says whether the stream is up; when it drops the last picture stays and a banner says so.
 */
export function useBrowserSession() {
  const [token, setToken] = React.useState<string | null>(null);
  const [state, setState] = React.useState<BrowserState | null>(null);
  const [frame, setFrame] = React.useState<string | null>(null);
  const [events, setEvents] = React.useState<BrowserEvent[]>([]);
  const [consoleLog, setConsole] = React.useState<BrowserConsole[]>([]);
  const [network, setNetwork] = React.useState<BrowserRequest[]>([]);
  const [connection, setConnection] = React.useState<"idle" | "connecting" | "live" | "lost">("idle");
  const [opening, setOpening] = React.useState(false);
  const [openError, setOpenError] = React.useState<string | null>(null);
  const [reviewed, setReviewed] = React.useState<Set<number>>(new Set());
  const toggleReviewed = React.useCallback((id: number) => setReviewed((r) => { const n = new Set(r); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);

  const reset = () => { setReviewed(new Set()); setState(null); setFrame(null); setEvents([]); setConsole([]); setNetwork([]); };

  // the stream
  React.useEffect(() => {
    if (!token) { setConnection("idle"); return; }
    if (typeof EventSource === "undefined") { setConnection("lost"); return; }
    setConnection("connecting");
    const es = new EventSource(browserService.streamUrl(token));
    es.onopen = () => setConnection("live");
    es.onerror = () => setConnection((c) => (c === "idle" ? c : "lost"));
    const data = (m: Event) => (m as MessageEvent<string>).data;
    es.addEventListener("frame", (m) => setFrame(FRAME_PREFIX + data(m)));
    es.addEventListener("state", (m) => { try { const s = JSON.parse(data(m)) as BrowserState; setState(s); if (s.paused) setFrame(null); } catch { /* ignore a bad message */ } });
    es.addEventListener("event", (m) => { try { const e = JSON.parse(data(m)) as BrowserEvent; setEvents((l) => (l.some((x) => x.id === e.id) ? l : [...l, e])); } catch { /* ignore */ } });
    es.addEventListener("evidence", (m) => { try { const { ids, shot } = JSON.parse(data(m)) as { ids: number[]; shot: number }; setEvents((l) => l.map((e) => (ids.includes(e.id) ? { ...e, shotRef: shot, hasShot: true } : e))); } catch { /* ignore */ } });
    es.addEventListener("closed", () => { es.close(); setConnection("idle"); });
    return () => es.close();
  }, [token]);

  // console and network lists have no stream: ask again about once a second while the preview is open
  const live = Boolean(token) && state?.status !== "closed";
  React.useEffect(() => {
    if (!token || !live) return;
    let gone = false;
    const tick = async () => {
      const log = await browserService.log(token, 0);
      if (gone || !log) return;
      setConsole(log.console);
      setNetwork(log.network);
      // events missed while the stream was down
      setEvents((cur) => { const have = new Set(cur.map((e) => e.id)); const add = log.events.filter((e) => !have.has(e.id)); return add.length ? [...cur, ...add].sort((a, b) => a.id - b.id) : cur; });
      setState(log.state);
    };
    void tick();
    const t = setInterval(() => void tick(), 1000);
    return () => { gone = true; clearInterval(t); };
  }, [token, live]);

  const open = React.useCallback(async (req: BrowserOpenRequest) => {
    setOpening(true); setOpenError(null); reset();
    try {
      const r = await browserService.open(req);
      setToken(r.token); setState(r.state);
    } catch (e) {
      setToken(null);
      setOpenError(e instanceof Error ? e.message : "Could not open the preview.");
    } finally { setOpening(false); }
  }, []);

  const command = React.useCallback(async (cmd: BrowserCommand) => {
    if (!token) return null;
    const r = await browserService.command(token, cmd);
    if ("viewport" in r) setState(r as BrowserState);
    return r;
  }, [token]);
  const send = React.useCallback((msg: BrowserInput) => { if (token) void browserService.input(token, msg); }, [token]);
  const close = React.useCallback(async () => { if (token) await browserService.command(token, { type: "close" }).catch(() => undefined); setToken(null); reset(); setConnection("idle"); }, [token]);
  const shot = React.useCallback((id: number) => (token ? browserService.shot(token, id) : Promise.resolve(null)), [token]);

  return { token, state, frame, events, consoleLog, network, connection, opening, openError, reviewed, toggleReviewed, open, command, send, close, shot };
}
