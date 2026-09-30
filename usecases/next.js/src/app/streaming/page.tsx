'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Lamatic } from 'lamatic';
import Image from 'next/image';
import Logo from '../../../public/logo.png';

/**
 * Side-by-side demo of token streaming.
 *
 * The same flow is executed twice, simultaneously:
 *   left  — executeFlow()            : one request, one answer at the end
 *   right — executeFlowTokenStream() : an SSE subscription, one token at a time
 *
 * The numbers that matter are "first text" (how long until the user sees
 * anything) and "complete" (how long until the answer is whole). Streaming
 * barely changes the second and transforms the first.
 */

type Config = {
  endpoint: string;
  projectId: string;
  apiKey: string;
  flowId: string;
  payloadKey: string;
  prompt: string;
};

const EMPTY: Config = {
  endpoint: process.env.NEXT_PUBLIC_LAMATIC_ENDPOINT ?? '',
  projectId: process.env.NEXT_PUBLIC_LAMATIC_PROJECT_ID ?? '',
  apiKey: process.env.NEXT_PUBLIC_LAMATIC_API_KEY ?? '',
  flowId: process.env.NEXT_PUBLIC_LAMATIC_FLOW_ID ?? '',
  payloadKey: process.env.NEXT_PUBLIC_LAMATIC_PAYLOAD_KEY ?? 'sampleInput',
  prompt: 'Write a detailed 400-word explanation of how tidal turbines work.',
};

const STORAGE_KEY = 'lamatic-streaming-demo-config';

type PaneState = {
  text: string;
  running: boolean;
  firstTextMs: number | null;
  completeMs: number | null;
  tokens: number;
  error: string | null;
};

const IDLE: PaneState = {
  text: '',
  running: false,
  firstTextMs: null,
  completeMs: null,
  tokens: 0,
  error: null,
};

function fmt(ms: number | null) {
  if (ms === null) return '—';
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Ticks while a pane is running so the elapsed time is visibly counting up. */
function useTicker(active: boolean) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => force((n) => n + 1), 50);
    return () => clearInterval(id);
  }, [active]);
}

export default function StreamingDemo() {
  const [config, setConfig] = useState<Config>(EMPTY);
  const [showConfig, setShowConfig] = useState(true);
  const [blocking, setBlocking] = useState<PaneState>(IDLE);
  const [streaming, setStreaming] = useState<PaneState>(IDLE);
  const startedAt = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);
  const streamBodyRef = useRef<HTMLDivElement | null>(null);

  const running = blocking.running || streaming.running;
  useTicker(running);

  // Restore whatever was last entered, so a re-run after a refresh is one click.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setConfig((c) => ({ ...c, ...JSON.parse(saved) }));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const { apiKey, ...safe } = config;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    } catch {
      /* ignore */
    }
  }, [config]);

  // Keep the newest tokens in view as they arrive.
  useEffect(() => {
    const el = streamBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [streaming.text]);

  const ready =
    config.endpoint && config.projectId && config.apiKey && config.flowId;

  function client() {
    return new Lamatic({
      endpoint: config.endpoint,
      projectId: config.projectId,
      apiKey: config.apiKey,
    });
  }

  async function runBlocking(payload: Record<string, string>) {
    const lamatic = client();
    setBlocking({ ...IDLE, running: true });
    try {
      const res: any = await lamatic.executeFlow(config.flowId, payload);
      const elapsed = Date.now() - startedAt.current;
      const body = res?.result ?? res?.data ?? res;
      const text =
        typeof body === 'string' ? body : JSON.stringify(body, null, 2);
      // Nothing was visible until now: first text and completion are the same moment.
      setBlocking({
        text,
        running: false,
        firstTextMs: elapsed,
        completeMs: elapsed,
        tokens: 0,
        error: null,
      });
    } catch (err: any) {
      setBlocking({
        ...IDLE,
        error: err?.message ?? String(err),
        completeMs: Date.now() - startedAt.current,
      });
    }
  }

  async function runStreaming(payload: Record<string, string>) {
    const lamatic = client();
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming({ ...IDLE, running: true });

    try {
      for await (const event of lamatic.executeFlowTokenStream(
        config.flowId,
        payload,
        { signal: controller.signal }
      )) {
        if (event.type === 'token') {
          setStreaming((s) => ({
            ...s,
            // Deltas are accumulated here, on the client. The node's own final
            // field repeats the whole text, so appending that too would double it.
            text: s.text + event.token,
            tokens: s.tokens + 1,
            firstTextMs: s.firstTextMs ?? Date.now() - startedAt.current,
          }));
        } else if (event.type === 'final') {
          setStreaming((s) => ({
            ...s,
            running: false,
            completeMs: Date.now() - startedAt.current,
            // The server occasionally returns a stream carrying only the
            // terminal frame — no token deltas at all. Say so, rather than
            // leaving an empty pane that looks like a bug in the SDK.
            error:
              s.tokens === 0
                ? 'The server returned no token frames for this run — only the final result. Run it again.'
                : s.error,
          }));
        } else if (event.type === 'error') {
          setStreaming((s) => ({
            ...s,
            running: false,
            error: event.message,
            completeMs: Date.now() - startedAt.current,
          }));
        }
      }
    } catch (err: any) {
      setStreaming((s) => ({
        ...s,
        running: false,
        error: err?.message ?? String(err),
      }));
    } finally {
      setStreaming((s) => (s.running ? { ...s, running: false } : s));
    }
  }

  function runBoth() {
    if (!ready || running) return;
    const payload = { [config.payloadKey]: config.prompt };
    startedAt.current = Date.now();
    setShowConfig(false);
    void runBlocking(payload);
    void runStreaming(payload);
  }

  function stop() {
    abortRef.current?.abort();
  }

  const now = Date.now();
  const liveBlocking = blocking.running ? now - startedAt.current : null;
  const liveStreaming = streaming.running ? now - startedAt.current : null;

  const speedup =
    blocking.firstTextMs && streaming.firstTextMs
      ? blocking.firstTextMs / streaming.firstTextMs
      : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50 to-red-100">
      <div className="max-w-6xl mx-auto p-6">
        {/* Header, matching the playground */}
        <div className="flex justify-between items-center mb-6 bg-white p-4 rounded-lg shadow-md">
          <a
            href="https://lamatic.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <Image src={Logo} alt="Lamatic Logo" className="h-12 w-12" />
            <h1 className="text-3xl font-bold text-red-600">Token Streaming</h1>
          </a>

          <div className="flex gap-4">
            <a
              href="/"
              className="text-sm font-medium text-gray-700 hover:text-red-600 transition-colors"
            >
              Playground
            </a>
            <a
              href="https://lamatic.ai/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-gray-700 hover:text-red-600 transition-colors"
            >
              Docs
            </a>
          </div>
        </div>

        {/* Configuration */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6 border-t-4 border-red-600">
          <button
            onClick={() => setShowConfig((v) => !v)}
            className="w-full flex items-center justify-between"
          >
            <h2 className="text-xl font-semibold text-gray-700">
              Configuration
            </h2>
            <span className="text-gray-400 text-sm">
              {showConfig ? '▲' : '▼'}
            </span>
          </button>

          {showConfig && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {(
                [
                  ['endpoint', 'Endpoint (pod /graphql URL)'],
                  ['projectId', 'Project ID'],
                  ['apiKey', 'API Key'],
                  ['flowId', 'Flow ID'],
                  ['payloadKey', 'Payload Field Name'],
                ] as [keyof Config, string][]
              ).map(([key, label]) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {label}
                  </label>
                  <input
                    type={key === 'apiKey' ? 'password' : 'text'}
                    value={config[key]}
                    onChange={(e) =>
                      setConfig({ ...config, [key]: e.target.value })
                    }
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-red-500 focus:border-red-500 text-sm font-mono"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Prompt + run */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6 border-t-4 border-red-600">
          <h2 className="text-xl font-semibold mb-4 text-gray-700">Prompt</h2>
          <textarea
            value={config.prompt}
            onChange={(e) => setConfig({ ...config, prompt: e.target.value })}
            rows={2}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-red-500 focus:border-red-500 text-sm"
          />
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={runBoth}
              disabled={!ready || running}
              className="bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 transition-colors disabled:bg-red-400"
            >
              {running ? 'Running…' : 'Run Both'}
            </button>
            {running && (
              <button
                onClick={stop}
                className="border border-gray-300 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-50 transition-colors"
              >
                Stop
              </button>
            )}
            {!ready && (
              <span className="text-sm text-gray-500">
                Fill in the configuration above.
              </span>
            )}
            {speedup && (
              <span className="ml-auto bg-red-100 text-red-700 text-sm font-medium px-3 py-1 rounded-md">
                First text {speedup.toFixed(1)}× sooner
              </span>
            )}
          </div>
        </div>

        {/* Side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Pane
            title="executeFlow()"
            subtitle="Waits for the whole answer"
            accentClass="border-gray-300"
            state={blocking}
            live={liveBlocking}
          />
          <Pane
            title="executeFlowTokenStream()"
            subtitle="Renders each token as it arrives"
            accentClass="border-red-600"
            state={streaming}
            live={liveStreaming}
            bodyRef={streamBodyRef}
            showTokens
            highlight
          />
        </div>
      </div>
    </div>
  );
}

function Pane({
  title,
  subtitle,
  accentClass,
  state,
  live,
  bodyRef,
  showTokens = false,
  highlight = false,
}: {
  title: string;
  subtitle: string;
  accentClass: string;
  state: PaneState;
  live: number | null;
  bodyRef?: React.RefObject<HTMLDivElement | null>;
  showTokens?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={`bg-white rounded-lg shadow-md p-6 border-t-4 ${accentClass}`}
    >
      <h2
        className={`text-lg font-semibold font-mono ${
          highlight ? 'text-red-600' : 'text-gray-700'
        }`}
      >
        {title}
      </h2>
      <p className="text-sm text-gray-500 mb-4">{subtitle}</p>

      <div className="flex gap-6 mb-4 pb-3 border-b border-gray-200 text-sm">
        <Stat label="First text" value={fmt(state.firstTextMs)} />
        <Stat
          label="Complete"
          value={state.running ? fmt(live) : fmt(state.completeMs)}
        />
        {showTokens && <Stat label="Tokens" value={String(state.tokens)} />}
      </div>

      <div
        ref={bodyRef}
        className="bg-gray-50 border border-gray-200 rounded-md p-4 h-80 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-gray-800"
      >
        {state.error ? (
          <span className="text-red-600">{state.error}</span>
        ) : state.text ? (
          <>
            {state.text}
            {state.running && (
              <span className="inline-block w-2 h-4 -mb-0.5 ml-0.5 bg-red-600 animate-pulse" />
            )}
          </>
        ) : state.running ? (
          <span className="text-gray-400">Waiting…</span>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-gray-500">{label} </span>
      <span className="text-gray-800 font-mono font-medium">{value}</span>
    </span>
  );
}
